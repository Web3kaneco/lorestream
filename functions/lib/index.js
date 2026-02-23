"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateLoreGraph = exports.generateProductConcept = exports.process3DExtrusion = exports.enqueue3DTask = void 0;
const https_1 = require("firebase-functions/v2/https");
const tasks_1 = require("firebase-functions/v2/tasks");
const functions_1 = require("firebase-admin/functions");
const admin = __importStar(require("firebase-admin"));
const genai_1 = require("@google/genai");
const alchemy_sdk_1 = require("alchemy-sdk");
// Initialize Firebase Admin so we can securely write to the database and storage
admin.initializeApp();
const TRIPO_API_KEY = process.env.TRIPO_API_KEY || "";
// ============================================================================
// 1. INGESTION & FAST AI (Triggered by the Frontend DropZone)
// ============================================================================
exports.enqueue3DTask = (0, https_1.onCall)({ enforceAppCheck: false }, // Set to true before final submission
async (request) => {
    const { imageBase64, contract, tokenId, agentId } = request.data;
    const userId = request.auth?.uid;
    if (!userId)
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
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
    const queue = (0, functions_1.getFunctions)().taskQueue("process3DExtrusion");
    await queue.enqueue({
        userId,
        agentId,
        imageStoragePath, // <--- Send the tiny text path instead!
        contract,
        tokenId
    }, { dispatchDeadlineSeconds: 60 * 10 });
    // Run Fast AI / Alchemy asynchronously (does not block the frontend)
    (async () => {
        try {
            if (contract && tokenId) {
                // The Web3 Path: Pull canonical traits directly from the blockchain
                const alchemy = new alchemy_sdk_1.Alchemy({ apiKey: process.env.ALCHEMY_API_KEY, network: alchemy_sdk_1.Network.ETH_MAINNET });
                const nftMetadata = await alchemy.nft.getNftMetadata(contract, tokenId);
                const attributes = nftMetadata.raw?.metadata?.attributes || [];
                const traits = attributes.map((attr) => `${attr.trait_type}: ${attr.value}`);
                await db.doc(`users/${userId}/agents/${agentId}`).set({
                    traits: traits.length > 0 ? traits : ["Unknown Origins"],
                    archetype: "Web3 Native",
                    funFact: `Forged from smart contract ${contract.slice(0, 6)}...`
                }, { merge: true });
            }
            else if (imageBase64) {
                // The Fast AI Path: Use Gemini Vision to hallucinate traits
                const ai = new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
        }
        catch (error) {
            console.error("Fast analysis failed", error);
        }
    })();
    return { success: true };
});
// ============================================================================
// 2. THE 3D EXTRUSION WORKER (Cloud Tasks Queue)
// ============================================================================
exports.process3DExtrusion = (0, tasks_1.onTaskDispatched)({
    retryConfig: { maxAttempts: 1, minBackoffSeconds: 60 }, // Built-in shock absorber
    rateLimits: { maxConcurrentDispatches: 5 }, // Stops Tripo3D API rate limits
    timeoutSeconds: 480,
    memory: "1GiB"
}, async (req) => {
    const { userId, agentId, imageStoragePath, contract, tokenId } = req.data;
    let imageBuffer = null; // Store the raw file, not a string!
    try {
        const db = admin.firestore();
        const bucket = admin.storage().bucket();
        // --- THE STORAGE LOCKER RETRIEVAL ---
        if (imageStoragePath) {
            // Download the raw file from Firebase Storage
            const file = bucket.file(imageStoragePath);
            const [downloaded] = await file.download();
            imageBuffer = downloaded;
        }
        // ------------------------------------
        // If Web3, fetch the high-res gateway image from Alchemy first
        if (contract && tokenId && !imageBuffer) {
            const alchemy = new alchemy_sdk_1.Alchemy({ apiKey: process.env.ALCHEMY_API_KEY, network: alchemy_sdk_1.Network.ETH_MAINNET });
            const nftMetadata = await alchemy.nft.getNftMetadata(contract, tokenId);
            const imageUrl = nftMetadata.media[0]?.gateway;
            if (!imageUrl)
                throw new Error("No image found on NFT contract.");
            // Convert URL to a raw Buffer
            const imgRes = await fetch(imageUrl);
            const arrayBuffer = await imgRes.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
        }
        if (!imageBuffer)
            throw new Error("No image buffer found.");
        // Step A: Upload to Tripo3D (Using Multipart FormData!)
        const formData = new FormData();
        // Wrap the imageBuffer in a Uint8Array to make TypeScript happy!
        formData.append("file", new Blob([new Uint8Array(imageBuffer)], { type: "image/png" }), "upload.png");
        const uploadRes = await fetch("https://api.tripo3d.ai/v2/openapi/upload", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${TRIPO_API_KEY}`
                // ⚠️ DO NOT manually set Content-Type here! Fetch sets it automatically with the secret boundary for FormData.
            },
            body: formData
        });
        const uploadData = await uploadRes.json();
        console.log("=== TRIPO UPLOAD RESPONSE ===", JSON.stringify(uploadData));
        const image_token = uploadData.image_token || uploadData.data?.image_token;
        if (!image_token) {
            throw new Error(`Tripo3D Upload Failed. No token received.`);
        }
        // Step B: Trigger Extrusion
        const taskRes = await fetch("https://api.tripo3d.ai/v2/openapi/task", {
            method: "POST",
            headers: { "Authorization": `Bearer ${TRIPO_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ type: "image_to_model", file: { type: "png", file_token: image_token } })
        });
        const taskData = await taskRes.json();
        console.log("=== TRIPO TASK RESPONSE ===", JSON.stringify(taskData));
        if (!taskData.data || !taskData.data.task_id) {
            throw new Error(`Tripo3D Extrusion Failed.`);
        }
        // Fix 1: Make sure this is camelCase (taskId) so the fetch below can find it!
        const taskId = taskData.data.task_id;
        // Step C: Poll for Completion
        let isComplete = false;
        let glbUrl = "";
        while (!isComplete) {
            // Wait 5 seconds between checks
            await new Promise((resolve) => setTimeout(resolve, 5000));
            // Now this successfully uses the ${taskId} we declared above
            const statusRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` }
            });
            // --- NEW SHIELD: If Tripo3D hiccups and returns an HTML error page, ignore it and try again! ---
            if (!statusRes.ok) {
                console.warn(`Tripo API hiccup (Status ${statusRes.status}). Retrying...`);
                continue; // Skips the rest of the loop and starts over!
            }
            // If we get here, the response is safe to parse!
            const statusData = await statusRes.json();
            if (statusData.data.status === "success") {
                isComplete = true;
                console.log("=== TRIPO SUCCESS OUTPUT ===", JSON.stringify(statusData.data.output));
                // 1. Get the temporary URL from Tripo3D
                const temporaryTripoUrl = statusData.data.output.model || statusData.data.output.pbr_model || statusData.data.output.base_model;
                if (!temporaryTripoUrl) {
                    throw new Error(`Tripo3D succeeded, but no URL was found! Output: ${JSON.stringify(statusData.data.output)}`);
                }
                // 2. Download the GLB file into the Cloud Worker's memory
                console.log("Downloading GLB from Tripo3D to Firebase Storage...");
                const glbRes = await fetch(temporaryTripoUrl);
                if (!glbRes.ok) {
                    throw new Error(`Tripo CDN Failed to deliver file! Status: ${glbRes.status}`);
                }
                const glbArrayBuffer = await glbRes.arrayBuffer();
                // 3. Save it permanently to your Firebase Storage Locker
                const storagePath = `users/${userId}/agents/${agentId}/model.glb`;
                const bucket = admin.storage().bucket(); // Explicitly tell Cursor what the bucket is!
                const file = bucket.file(storagePath);
                // Wrap it in a Uint8Array to make TypeScript happy!
                await file.save(Buffer.from(new Uint8Array(glbArrayBuffer)), {
                    metadata: { contentType: "model/gltf-binary" }
                });
                // --- FIX 2: Added the missing URL signing and loop closing! ---
                // 4. Generate a permanent Firebase URL (valid until the year 2100!)
                const [permanentUrl] = await file.getSignedUrl({
                    action: "read",
                    expires: "01-01-2100"
                });
                // 5. Hand the safe, permanent URL to the database
                glbUrl = permanentUrl;
            }
            else if (statusData.data.status === "failed") {
                throw new Error("Tripo3D Generation Failed");
            }
        } // <--- Added the missing bracket to close the while loop!
        // Step D: Unlock the UI
        await admin.firestore().doc(`users/${userId}/agents/${agentId}`).set({
            extrusionStatus: "complete", model3dUrl: glbUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    catch (error) {
        console.error("Worker failed:", error);
        await admin.firestore().doc(`users/${userId}/agents/${agentId}`).set({ extrusionStatus: "failed" }, { merge: true });
        throw error;
    }
});
// ============================================================================
// 3. THE IP VAULT FORGE (Vertex AI Imagen 3)
// ============================================================================
exports.generateProductConcept = (0, https_1.onCall)({ timeoutSeconds: 60, memory: "1GiB" }, async (request) => {
    const userId = request.auth?.uid;
    if (!userId)
        throw new https_1.HttpsError("unauthenticated", "Unauthorized.");
    const { product_type, aesthetic, primary_color_hex } = request.data;
    const vertexAi = new genai_1.GoogleGenAI({ vertexai: true, project: process.env.GCLOUD_PROJECT, location: "us-central1" });
    try {
        const prompt = `Commercial product photography of a ${product_type}. Aesthetic: ${aesthetic}. Dominant color: ${primary_color_hex}. Hyper-realistic texture, studio lighting.`;
        const response = await vertexAi.models.generateImages({
            model: 'imagen-3.0-generate-002',
            prompt: prompt,
            config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "16:9" }
        });
        const base64Image = response.generatedImages?.[0]?.image?.imageBytes;
        if (!base64Image)
            throw new Error("No image returned");
        const bucket = admin.storage().bucket();
        const file = bucket.file(`vault/${userId}/concept_${Date.now()}.jpg`);
        await file.save(Buffer.from(base64Image, 'base64'), { metadata: { contentType: 'image/jpeg' } });
        const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: '01-01-2099' });
        return { imageUrl: signedUrl };
    }
    catch (error) {
        console.error("Imagen Failed:", error);
        throw new https_1.HttpsError("internal", "Forge Failed");
    }
});
// ============================================================================
// 4. THE LOREGRAPH MEMORY SYSTEM (Triggered by Gemini Tool)
// ============================================================================
exports.updateLoreGraph = (0, https_1.onCall)(async (request) => {
    const userId = request.auth?.uid;
    if (!userId)
        throw new https_1.HttpsError("unauthenticated", "Unauthorized.");
    const { new_fact, agentId } = request.data;
    const db = admin.firestore();
    // Natively appends to the array without reading the document first
    await db.doc(`users/${userId}/agents/${agentId}/lore/core_memory`).set({
        key_facts: admin.firestore.FieldValue.arrayUnion(new_fact),
        last_updated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { success: true, message: "Memory logged." };
});
