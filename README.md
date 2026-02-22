# 🦁 LoreStream (The Spark Engine) - Master Architecture & Build Plan

## 🧠 The Core Concept
LoreStream transforms static 2D IP (NFTs, sketches, toys) into autonomous, interactive 3D agents. Using the Gemini Multimodal Live API, the agent sees the user's world, speaks in real-time, remembers past interactions, and proactively co-creates commercial assets (product concepts, videos, lore) which are saved into a user-owned IP Vault.

---

## 🏗️ Technical Architecture

### 1. Ingestion & 3D Generation Layer
* **Input:** User holds a 2D image/NFT to the webcam.
* **Vision Analysis:** Gemini 1.5 Pro analyzes the image, extracting physical traits, archetype, and optimal voice persona. 
* **Web3 Check (Optional):** If an NFT, a Cloud Function calls the **Alchemy API** to verify exact metadata traits.
* **3D Extrusion:** A Cloud Function sends the isolated 2D image to a fast 2D-to-3D API (e.g., **Meshy API** or **Tripo3D**). The API returns a `.glb` or `.gltf` 3D model file within 30-60 seconds.

### 2. The Real-Time Brain (Gemini Live)
* **Connection:** The frontend establishes a bidirectional WebSocket connection via the **Google GenAI SDK**.
* **Inputs:** Webcam video frames (1 fps) and user microphone audio stream directly to the **Gemini Multimodal Live API**.
* **Outputs:** Real-time, low-latency audio responses. The system is naturally interruptible via Voice Activity Detection (VAD).

### 3. The 3D Rendering & Animation Layer (Frontend)
* **Engine:** The web app uses **Three.js / React Three Fiber** to render the generated `.glb` 3D model on screen.
* **Lip-Syncing:** The audio stream coming from Gemini is passed through a real-time audio-to-viseme library (like Rhubarb Lip Sync or an audio analyzer). The volume/frequencies drive the morph targets (mouth movements) of the 3D model, making it look like the avatar is speaking the AI's words.

### 4. Persistent Memory (The Relationship Engine)
* **Database:** **Google Firestore**.
* **Mechanism:** During the conversation, Gemini uses Function Calling (`update_lore_graph`) to extract new facts about the user and the IP.
* **Recall:** Upon the next login, the backend fetches the Firestore document and uses **Gemini Context Caching** to load the entire relationship history into the model instantly.

### 5. The IP Vault (Co-Creation Studio)
* **Asset Generation:** When the agent and user agree to "build" something (e.g., a Pompeii-style mug), the agent triggers background Cloud Functions.
* **Image Assets:** **Imagen 3** (via Vertex AI) generates high-fidelity product photography.
* **Video Assets:** **Veo 3.1** (via Vertex AI) generates short, 4-second looping dynamic action videos of the character or product.
* **Storage:** Assets are saved to a Google Cloud Storage bucket and displayed in the user's downloadable "Vault" dashboard.

---

## 🚀 Step-by-Step Build Plan

### Phase 1: The Core Brain & Memory (Days 1-3)
1.  Set up a Google Cloud Project with Billing and enable the Vertex AI and Gemini APIs.
2.  Deploy a Node.js/Express backend on **Google Cloud Run**.
3.  Set up **Firestore** and create the `LoreGraph` schema to store user IDs, agent IDs, and personality tags.
4.  Write the System Prompt that gives the AI its proactive, "co-creator" directive.

### Phase 2: The Real-Time WebSocket Connection (Days 4-7)
1.  Build a Next.js / React frontend.
2.  Implement the **Google GenAI SDK** to open a WebSocket connection to the Gemini Live API.
3.  Capture the user's microphone and webcam, chunk the data, and send it over the socket.
4.  Receive the audio buffer from Gemini and play it back in the browser. Test interruptions (barge-in).

### Phase 3: The 3D Avatar Rendering (Days 8-10)
1.  Integrate the **Meshy or Tripo3D API**. Send a test 2D image and retrieve a `.glb` file.
2.  Set up a **Three.js** canvas in the frontend. Load the generated `.glb` file.
3.  Map the incoming audio stream frequency data to the 3D model's scale/morph targets to create basic lip-syncing.

### Phase 4: Function Calling & The IP Vault (Days 11-14)
1.  Register the `generate_product_concept` tool within the Gemini Live setup.
2.  Write the backend handler to catch this tool call, build the prompt, and ping **Imagen 3**.
3.  Build the UI dashboard for the "IP Vault" that fetches the generated URLs from Cloud Storage and displays them cleanly.

### Phase 5: Demo Polish (Days 15+)
1.  Ensure the Alchemy API Web3 fallback is flawless.
2.  Record the 4-minute demo video showing the 2D image transforming into a 3D model, the real-time interaction, the memory recall, and the IP Vault generation.