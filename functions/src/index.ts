import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFunctions } from "firebase-admin/functions";
import * as admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";
import { Alchemy, Network } from "alchemy-sdk";

// Initialize Firebase Admin so we can securely write to the database and storage
admin.initializeApp();

const TRIPO_API_KEY = process.env.TRIPO_API_KEY || "";

// ============================================================================
// 1. INGESTION & FAST AI (Triggered by the Frontend DropZone)
// ============================================================================
export const enqueue3DTask = onCall(
  { enforceAppCheck: false }, // Set to true before final submission
  async (request) => {
    const { imageBase64, contract, tokenId, agentId } = request.data;
    const userId = request.auth?.uid;
    if (!userId) throw new HttpsError("unauthenticated", "Must be logged in.");

    const db = admin.firestore();

    // Set initial loading state so the UI transitions
    await db.doc(`users/${userId}/agents/${agentId}`).set({ 
      extrusionStatus: "generating", traits: [], archetype: "", funFact: "" 
    }, { merge: true });

    // Queue the heavy 3D task to run safely in the background
    const queue = getFunctions().taskQueue("process3DExtrusion");
    await queue.enqueue(
      { userId, agentId, imageBase64, contract, tokenId }, 
      { dispatchDeadlineSeconds: 60 * 10 }
    );

    // Run Fast AI / Alchemy asynchronously (does not block the frontend)
    (async () => {
      try {
        if (contract && tokenId) {
           // The Web3 Path: Pull canonical traits directly from the blockchain
           const alchemy = new Alchemy({ apiKey: process.env.ALCHEMY_API_KEY, network: Network.ETH_MAINNET });
           const nftMetadata = await alchemy.nft.getNftMetadata(contract, tokenId);
           const attributes = nftMetadata.raw?.metadata?.attributes || [];
           const traits = attributes.map((attr: any) => `${attr.trait_type}: ${attr.value}`);
           
           await db.doc(`users/${userId}/agents/${agentId}`).set({
             traits: traits.length > 0 ? traits : ["Unknown Origins"], 
             archetype: "Web3 Native", 
             funFact: `Forged from smart contract ${contract.slice(0,6)}...`
           }, { merge: true });

        } else if (imageBase64) {
           // The Fast AI Path: Use Gemini Vision to hallucinate traits
           const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
           const prompt = `Analyze this character image. Return a strict JSON object with: 1. An array of 3 physical "traits". 2. A 2-word "archetype". 3. A 1-sentence "funFact" about their origin.`;
           
           const response = await ai.models.generateContent({
             model: 'gemini-3.1-pro',
             contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] }],
             config: { responseMimeType: "application/json" }
           });
           const data = JSON.parse(response.text());
           
           await db.doc(`users/${userId}/agents/${agentId}`).set({
             traits: data.traits, archetype: data.archetype, funFact: data.funFact
           }, { merge: true });
        }
      } catch (error) { 
        console.error("Fast analysis failed", error); 
      }
    })();

    return { success: true };
  }
);

// ============================================================================
// 2. THE 3D EXTRUSION WORKER (Cloud Tasks Queue)
// ============================================================================
export const process3DExtrusion = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 60 }, // Built-in shock absorber
    rateLimits: { maxConcurrentDispatches: 5 }, // Stops Tripo3D API rate limits
    timeoutSeconds: 480, 
    memory: "1GiB"
  },
  async (req) => {
    const { userId, agentId, imageBase64, contract, tokenId } = req.data;
    let finalImage = imageBase64;

    try {
      // If Web3, fetch the high-res gateway image from Alchemy first
      if (contract && tokenId && !finalImage) {
        const alchemy = new Alchemy({ apiKey: process.env.ALCHEMY_API_KEY, network: Network.ETH_MAINNET });
        const nftMetadata = await alchemy.nft.getNftMetadata(contract, tokenId);
        const imageUrl = nftMetadata.media[0]?.gateway;
        if (!imageUrl) throw new Error("No image found on NFT contract.");
        
        // Convert URL to Base64 for Tripo3D
        const imgRes = await fetch(imageUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        finalImage = Buffer.from(arrayBuffer).toString('base64');
      }

      // Step A: Upload to Tripo3D
      const uploadRes = await fetch("https://api.tripo3d.ai/v2/openapi/upload", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TRIPO_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image: finalImage })
      });
      const { image_token } = await uploadRes.json();

      // Step B: Trigger Extrusion
      const taskRes = await fetch("https://api.tripo3d.ai/v2/openapi/task", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TRIPO_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "image_to_model", file: { type: "jpg", file_token: image_token } })
      });
      const { data: { task_id } } = await taskRes.json();

      // Step C: Poll for Completion
      let isComplete = false;
      let glbUrl = "";
      while (!isComplete) {
        await new Promise(res => setTimeout(res, 5000)); 
        const statusRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${task_id}`, {
          headers: { "Authorization": `Bearer ${TRIPO_API_KEY}` }
        });
        const statusData = await statusRes.json();

        if (statusData.data.status === "success") {
          isComplete = true;
          glbUrl = statusData.data.model.url;
        } else if (statusData.data.status === "failed") {
          throw new Error("Tripo3D Generation Failed");
        }
      }

      // Step D: Unlock the UI
      await admin.firestore().doc(`users/${userId}/agents/${agentId}`).set({
        extrusionStatus: "complete", model3dUrl: glbUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    } catch (error) {
      console.error("Worker failed:", error);
      await admin.firestore().doc(`users/${userId}/agents/${agentId}`).set({ extrusionStatus: "failed" }, { merge: true });
      throw error; 
    }
  }
);

// ============================================================================
// 3. THE IP VAULT FORGE (Vertex AI Imagen 3)
// ============================================================================
export const generateProductConcept = onCall(
  { timeoutSeconds: 60, memory: "1GiB" },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) throw new HttpsError("unauthenticated", "Unauthorized.");

    const { product_type, aesthetic, primary_color_hex } = request.data;
    const vertexAi = new GoogleGenAI({ vertexai: true, project: process.env.GCLOUD_PROJECT, location: "us-central1" });

    try {
      const prompt = `Commercial product photography of a ${product_type}. Aesthetic: ${aesthetic}. Dominant color: ${primary_color_hex}. Hyper-realistic texture, studio lighting.`;
      
      const response = await vertexAi.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: prompt,
        config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "16:9" }
      });

      const base64Image = response.generatedImages?.[0]?.image?.imageBytes;
      if (!base64Image) throw new Error("No image returned");

      const bucket = admin.storage().bucket();
      const file = bucket.file(`vault/${userId}/concept_${Date.now()}.jpg`);
      await file.save(Buffer.from(base64Image, 'base64'), { metadata: { contentType: 'image/jpeg' } });
      const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: '01-01-2099' });

      return { imageUrl: signedUrl };
    } catch (error) {
      console.error("Imagen Failed:", error);
      throw new HttpsError("internal", "Forge Failed");
    }
  }
);

// ============================================================================
// 4. THE LOREGRAPH MEMORY SYSTEM (Triggered by Gemini Tool)
// ============================================================================
export const updateLoreGraph = onCall(async (request) => {
  const userId = request.auth?.uid;
  if (!userId) throw new HttpsError("unauthenticated", "Unauthorized.");
  
  const { new_fact, agentId } = request.data;
  const db = admin.firestore();
  
  // Natively appends to the array without reading the document first
  await db.doc(`users/${userId}/agents/${agentId}/lore/core_memory`).set({
    key_facts: admin.firestore.FieldValue.arrayUnion(new_fact),
    last_updated: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true, message: "Memory logged." };
});