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
    const bucket = admin.storage().bucket(); // Access your Firebase Storage

    // Set initial loading state so the UI transitions
    await db.doc(`users/${userId}/agents/${agentId}`).set({ 
      extrusionStatus: "generating", traits: [], archetype: "", funFact: "" 
    }, { merge: true });

    // --- THE STORAGE LOCKER FIX ---
    let imageStoragePath = null;
    if (imageBase64) {
      // 1. Strip the "data:image/png;base64," header if the frontend sent it
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      // 2. Define the locker path and save the file to Firebase Storage
      imageStoragePath = `users/${userId}/agents/${agentId}/source_image.png`;
      const file = bucket.file(imageStoragePath);
      await file.save(buffer, { metadata: { contentType: 'image/png' } });
    }
    // ------------------------------

    // Queue the heavy 3D task safely (passing the path, NOT the giant image!)
    console.log("=== THE STORAGE LOCKER FIX IS ACTIVE ===");
    const queue = getFunctions().taskQueue("process3DExtrusion");
    await queue.enqueue(
      { 
        userId, 
        agentId, 
        imageStoragePath, // <--- Send the tiny text path instead!
        contract, 
        tokenId 
      }, 
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
            
            // --- NEW: Strip the prefix so Gemini doesn't choke! ---
            const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            
            const response = await ai.models.generateContent({
              model: 'gemini-2.5-pro',
              contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }] }], // <-- Use cleanBase64 here
              config: { responseMimeType: "application/json" }
            });
           const data = JSON.parse(response.text);
           
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
// HELPER: Poll a Tripo3D task until it succeeds or fails
// ============================================================================
async function pollTripoTask(taskId: string, label: string): Promise<any> {
  console.log(`=== Polling Tripo task ${taskId} (${label}) ===`);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const statusRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TRIPO_API_KEY}` }
    });

    if (!statusRes.ok) {
      console.warn(`Tripo API hiccup on ${label} (Status ${statusRes.status}). Retrying...`);
      continue;
    }

    const statusData = await statusRes.json();
    const status = statusData.data.status;

    if (status === "success") {
      console.log(`=== TRIPO ${label} SUCCESS ===`, JSON.stringify(statusData.data.output));
      return statusData.data;
    } else if (status === "failed") {
      throw new Error(`Tripo3D ${label} Failed. Response: ${JSON.stringify(statusData.data)}`);
    }
    // Otherwise still running — loop again
  }
}

// ============================================================================
// HELPER: Download a GLB from a URL and save to Firebase Storage, return signed URL
// ============================================================================
async function downloadAndStoreGlb(
  sourceUrl: string,
  storagePath: string,
  label: string
): Promise<string> {
  console.log(`Downloading ${label} GLB to Firebase Storage...`);
  const glbRes = await fetch(sourceUrl);
  if (!glbRes.ok) {
    throw new Error(`Tripo CDN Failed to deliver ${label} file! Status: ${glbRes.status}`);
  }

  const glbArrayBuffer = await glbRes.arrayBuffer();
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);

  await file.save(Buffer.from(new Uint8Array(glbArrayBuffer)), {
    metadata: { contentType: "model/gltf-binary" }
  });

  const [permanentUrl] = await file.getSignedUrl({
    action: "read",
    expires: "01-01-2100"
  });

  return permanentUrl;
}

// ============================================================================
// 2. THE 3D EXTRUSION WORKER (Cloud Tasks Queue)
//    Pipeline: Upload → image_to_model → animate_rig (Mixamo) → Store
// ============================================================================
export const process3DExtrusion = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 1, minBackoffSeconds: 60 },
    rateLimits: { maxConcurrentDispatches: 5 },
    timeoutSeconds: 540, // Increased: image_to_model (~2-3min) + animate_rig (~1-2min)
    memory: "1GiB"
  },
  async (req) => {
    const { userId, agentId, imageStoragePath, contract, tokenId } = req.data;
    let imageBuffer: Buffer | null = null;

    try {
      const db = admin.firestore();
      const bucket = admin.storage().bucket();

      // --- THE STORAGE LOCKER RETRIEVAL ---
      if (imageStoragePath) {
        const file = bucket.file(imageStoragePath);
        const [downloaded] = await file.download();
        imageBuffer = downloaded;
      }

      // If Web3, fetch the high-res gateway image from Alchemy first
      if (contract && tokenId && !imageBuffer) {
        const alchemy = new Alchemy({ apiKey: process.env.ALCHEMY_API_KEY, network: Network.ETH_MAINNET });
        const nftMetadata = await alchemy.nft.getNftMetadata(contract, tokenId);
        const imageUrl = (nftMetadata as any).media[0]?.gateway;
        if (!imageUrl) throw new Error("No image found on NFT contract.");
        const imgRes = await fetch(imageUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }

      if (!imageBuffer) throw new Error("No image buffer found.");

      // ================================================================
      // Step A: Upload image to Tripo3D
      // ================================================================
      const formData = new FormData();
      formData.append("file", new Blob([new Uint8Array(imageBuffer)], { type: "image/png" }), "upload.png");

      const uploadRes = await fetch("https://api.tripo3d.ai/v2/openapi/upload", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TRIPO_API_KEY}` },
        body: formData
      });

      const uploadData = await uploadRes.json();
      console.log("=== TRIPO UPLOAD RESPONSE ===", JSON.stringify(uploadData));

      const image_token = uploadData.image_token || uploadData.data?.image_token;
      if (!image_token) {
        throw new Error(`Tripo3D Upload Failed. No token received.`);
      }

      // ================================================================
      // Step B: Trigger image_to_model (produces unrigged 3D mesh)
      // ================================================================
      const modelTaskRes = await fetch("https://api.tripo3d.ai/v2/openapi/task", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TRIPO_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "image_to_model", file: { type: "png", file_token: image_token } })
      });

      const modelTaskData = await modelTaskRes.json();
      console.log("=== TRIPO image_to_model TASK ===", JSON.stringify(modelTaskData));

      if (!modelTaskData.data?.task_id) {
        throw new Error(`Tripo3D image_to_model failed to start.`);
      }

      const modelTaskId = modelTaskData.data.task_id;

      // ================================================================
      // Step C: Poll image_to_model until complete
      // ================================================================
      const modelResult = await pollTripoTask(modelTaskId, "image_to_model");

      const unriggedUrl = modelResult.output.model || modelResult.output.pbr_model || modelResult.output.base_model;
      if (!unriggedUrl) {
        throw new Error(`image_to_model succeeded but no model URL found! Output: ${JSON.stringify(modelResult.output)}`);
      }

      // Save the unrigged model as a backup
      const unriggedPermanentUrl = await downloadAndStoreGlb(
        unriggedUrl,
        `users/${userId}/agents/${agentId}/model_unrigged.glb`,
        "unrigged"
      );

      // Update Firestore: model is built, now rigging
      await db.doc(`users/${userId}/agents/${agentId}`).set({
        extrusionStatus: "rigging",
        model3dUnriggedUrl: unriggedPermanentUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // ================================================================
      // Step D: Trigger animate_rig (adds Mixamo skeleton to the mesh)
      // ================================================================
      console.log("=== Starting Tripo animate_rig (Mixamo skeleton) ===");

      const rigTaskRes = await fetch("https://api.tripo3d.ai/v2/openapi/task", {
        method: "POST",
        headers: { "Authorization": `Bearer ${TRIPO_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "animate_rig",
          original_model_task_id: modelTaskId,
          out_format: "glb",
          spec: "mixamo"
        })
      });

      const rigTaskData = await rigTaskRes.json();
      console.log("=== TRIPO animate_rig TASK ===", JSON.stringify(rigTaskData));

      if (!rigTaskData.data?.task_id) {
        // Rigging failed to start — fall back to unrigged model
        console.warn("animate_rig failed to start. Falling back to unrigged model.");
        await db.doc(`users/${userId}/agents/${agentId}`).set({
          extrusionStatus: "complete",
          model3dUrl: unriggedPermanentUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }

      const rigTaskId = rigTaskData.data.task_id;

      // ================================================================
      // Step E: Poll animate_rig until complete
      // ================================================================
      let riggedPermanentUrl = "";
      try {
        const rigResult = await pollTripoTask(rigTaskId, "animate_rig");

        const riggedUrl = rigResult.output.model || rigResult.output.pbr_model || rigResult.output.base_model;
        if (!riggedUrl) {
          throw new Error(`animate_rig succeeded but no model URL found! Output: ${JSON.stringify(rigResult.output)}`);
        }

        // Download and store the rigged model
        riggedPermanentUrl = await downloadAndStoreGlb(
          riggedUrl,
          `users/${userId}/agents/${agentId}/model.glb`,
          "rigged"
        );
      } catch (rigError) {
        // Rigging failed — fall back to unrigged model
        console.warn("animate_rig failed. Falling back to unrigged model:", rigError);
        riggedPermanentUrl = unriggedPermanentUrl;
      }

      // ================================================================
      // Step F: Unlock the UI with the best available model
      // ================================================================
      await db.doc(`users/${userId}/agents/${agentId}`).set({
        extrusionStatus: "complete",
        model3dUrl: riggedPermanentUrl,
        model3dUnriggedUrl: unriggedPermanentUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
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