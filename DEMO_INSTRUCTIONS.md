# LXXI Demo Instructions

## Hackathon Demo Guide

**Live URL**: [https://lxxi.com](https://lxxi.com)
**Alt URL**: [https://lorestream-3325c.web.app](https://lorestream-3325c.web.app)

---

## What is LXXI?

LXXI is an AI avatar platform where users create characters with souls, voices, and 3D bodies through natural conversation. Every character has:

- A **soul** — built through voice interview with The Architect AI
- A **body** — generated from any image into an animated 3D avatar via Tripo3D + Mixamo
- A **voice** — real-time conversation powered by Gemini 2.5 Flash native audio
- A **memory** — semantic vector memory via Pinecone that persists across sessions
- A **creative studio** — AI image generation, document creation, and artifact management

The platform also includes **Leo's Learning Lab** — an AI-powered tutor with 3D avatar, chalkboard, and adaptive learning profiles.

---

## Quick Demo Walkthrough (5 minutes)

### 1. The Forge — Character Creation

1. Go to [https://lxxi.com](https://lxxi.com)
2. **Sign in** with Google (top right) — required for full access
3. You'll see the landing page with two demo avatars (**KANE** the lion, **WOW** the female avatar)
4. Click **"Start Conversation"** to begin talking to **The Architect**
5. The Architect will:
   - Ask for your name
   - Ask what character you want to create
   - Interview you about the character's personality, backstory, traits, voice
   - Build a "soul file" (archetype + traits + lore + personality)
6. While talking, **upload a full-body image** using the upload panel on the right
   - PNG/JPG of any character (can be AI-generated, drawn, or real)
   - Full body works best for 3D generation
7. Watch the pipeline:
   - **"Synthesizing 3D DNA..."** — Tripo3D converts image to 3D model (~1 min)
   - **"Rigging Skeleton..."** — Mixamo skeleton attached (~40s)
   - **"Animating Idle Pose..."** — Idle breathing animation baked (~40s)
8. The Architect will tell you when both the soul AND 3D model are complete
9. Click **"Enter Workspace"** to meet your character

### 2. The Workspace — Voice Conversations

1. Your 3D avatar appears full-screen with real-time lip sync
2. Click **"Start Conversation"** to begin talking
3. **Talk naturally** — the AI responds in character using the soul file you built
4. During conversation, the AI can:
   - **Generate images** — ask it to create concept art, portraits, scenes
   - **Create documents** — ask for stories, code, analysis
   - Generated artifacts appear as **floating glass cards** you can drag around
5. Click the **VAULT** button (top right) to:
   - See all your created characters
   - Toggle **MALE/FEMALE** voice per character
   - Switch between characters (click **AWAKEN**)

### 3. Leo's Learning Lab (Spark)

1. From the landing page, click **"Spark"** or go to [https://lxxi.com/spark](https://lxxi.com/spark)
2. Choose a subject: **Math**, **Science**, **Spanish**, or **General**
3. Leo the lion tutor will:
   - Teach concepts through natural conversation
   - Display problems on the **chalkboard card**
   - Generate **learning visuals** (diagrams, illustrations)
   - Track your progress and adapt difficulty
4. Switch subjects anytime using the subject buttons

---

## Key Features to Demonstrate

| Feature | How to Show | Where |
|---------|-------------|-------|
| **Voice conversation** | Just talk — real-time two-way audio | Forge, Workspace, Spark |
| **3D avatar lip sync** | Watch mouth move while AI speaks | All pages |
| **Character creation** | Go through Architect interview | Forge |
| **Image-to-3D pipeline** | Upload any character image | Forge |
| **AI image generation** | Ask "create an image of..." in workspace | Workspace |
| **Floating artifacts** | Generate images/docs, drag them around | Workspace |
| **Voice selection** | Toggle MALE/FEMALE in VAULT | Workspace |
| **Agent switching** | Click VAULT, pick a different soul | Workspace |
| **Adaptive tutoring** | Use Leo, answer questions, watch it adapt | Spark |
| **Subject switching** | Change subjects mid-session in Spark | Spark |
| **Memory persistence** | Talk about something, come back later — it remembers | Workspace |

---

## Architecture Overview

```
Frontend (Next.js 14 + React Three Fiber)
  |
  |-- Gemini 2.5 Flash (Native Audio WebSocket)
  |     Real-time voice + vision + tool calling
  |
  |-- Gemini Imagen 4
  |     AI image generation (ultra/standard/fast tiers)
  |
  |-- Firebase Auth (Google Sign-In)
  |-- Cloud Firestore (agent profiles, lore, vault artifacts)
  |-- Cloud Storage (GLB models, images)
  |
  |-- Cloud Functions (Node.js 20)
  |     |-- enqueue3DTask (image upload + fast AI analysis)
  |     |-- process3DExtrusion (Tripo3D pipeline)
  |
  |-- Tripo3D API
  |     image_to_model -> animate_rig (Mixamo) -> animate_retarget (idle)
  |
  |-- Pinecone Vector DB
  |     Semantic memory per agent (text + image embeddings)
  |
  |-- React Three Fiber + Three.js
        3D avatar rendering, bone-based lip sync, procedural animation
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 14 (App Router) |
| **3D Engine** | Three.js + React Three Fiber + drei |
| **Voice AI** | Gemini 2.5 Flash Native Audio (WebSocket) |
| **Image AI** | Gemini Imagen 4 (ultra/standard/fast) |
| **3D Generation** | Tripo3D API (image-to-model + Mixamo rigging) |
| **Auth** | Firebase Authentication (Google Sign-In) |
| **Database** | Cloud Firestore |
| **Storage** | Firebase Cloud Storage |
| **Functions** | Cloud Functions for Firebase (Node.js 20) |
| **Vector Memory** | Pinecone (text-embedding-005 + multimodal) |
| **Styling** | Tailwind CSS |
| **Language** | TypeScript |

---

## Self-Hosting / Developer Setup

> **Note**: Full replication requires access to multiple paid APIs (Gemini, Tripo3D, Pinecone) and a Firebase project. The easiest way to demo is using the live URL above.

### Prerequisites

- Node.js 20+
- npm
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Firestore, Storage, Auth, and Cloud Functions enabled
- API keys for: Gemini, Pinecone, Tripo3D

### 1. Clone and Install

```bash
git clone https://github.com/Web3kaneco/lorestream.git
cd lorestream
npm install
cd functions && npm install && cd ..
```

### 2. Create Environment File

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

**`.env.local`** contents:

```env
# --- Firebase Client Config ---
# Get from: Firebase Console > Project Settings > General > Your Apps
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# --- Firebase Admin (Server-side) ---
# Get from: Firebase Console > Project Settings > Service Accounts > Generate New Private Key
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour Key Here\n-----END PRIVATE KEY-----\n"

# --- Gemini API Key ---
# Get from: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key

# --- Pinecone ---
# Get from: https://app.pinecone.io/ > API Keys
# Also create an index named "agent-memory" (dimension: 768, metric: cosine)
PINECONE_API_KEY=your_pinecone_api_key

# --- Admin Whitelist ---
# Your Google email for full access (comma-separated for multiple)
NEXT_PUBLIC_ADMIN_EMAILS=you@gmail.com
```

### 3. Cloud Functions Environment

Create `functions/.env`:

```env
TRIPO_API_KEY=your_tripo_api_key
ALCHEMY_API_KEY=your_alchemy_api_key
GEMINI_API_KEY=your_gemini_api_key
```

Get a Tripo3D API key from [https://www.tripo3d.ai/](https://www.tripo3d.ai/)

### 4. Firebase Setup

```bash
# Login to Firebase
firebase login

# Initialize (select your project)
firebase use your-project-id

# Deploy Firestore rules + Cloud Functions
firebase deploy --only firestore:rules,functions
```

### 5. Required Public Assets

The following files must exist in `/public/`:

```
public/
  leo.glb              # Leo tutor avatar (required for Spark + Forge KANE)
  WOW.glb              # Default female avatar (required for Forge + Workspace demo)
  lxxi-logo.png        # LXXI logo
  audio-processor.js   # AudioWorklet for voice capture
  hdri/
    potsdamer_platz_1k.hdr  # Environment lighting
  draco/
    draco_decoder.wasm      # GLTF decompression
    draco_decoder.js
    draco_wasm_wrapper.js
```

### 6. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 7. Deploy to Production

```bash
# Build Next.js
npm run build

# Deploy everything to Firebase
npm run deploy:all
```

---

## Firestore Data Model

```
users/{userId}/
  agents/{agentId}/
    archetype: "Shadow Alchemist"
    traits: ["Mysterious", "Resourceful", "Haunted"]
    funFact: "Born in the obsidian mines of..."
    characterName: "Kael"
    voiceName: "Fenrir"          # or "Aoede"
    extrusionStatus: "complete"  # pending | generating | rigging | animating | complete | error
    model3dUrl: "https://..."    # Signed Firebase Storage URL to animated GLB
    createdAt: Timestamp

    lore/core_memory/
      current_lore_summary: "Kael speaks in short, cryptic..."
      key_facts: ["Lost his left eye in...", "Carries a vial of..."]
      last_updated: Timestamp

    vault/{itemId}/
      type: "image" | "document" | "math_problem"
      url: "https://..."
      prompt: "A portrait of Kael in moonlight"
      createdAt: number
```

---

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/gemini-session` | GET | Rate-limited | Returns Gemini API key for WebSocket |
| `/api/generate-image` | POST | Firebase token | AI image generation |
| `/api/memory` | POST | Firebase token | Store conversation to vector memory |
| `/api/memory/search` | POST | Firebase token | Semantic search across memories |
| `/api/memory/ingest` | POST | Firebase token | Bulk file ingestion (PDF, images) |

---

## Access Tiers

| Feature | Demo (No Login) | Logged In (Non-Admin) | Admin |
|---------|-----------------|----------------------|-------|
| Landing page | Yes | Yes | Yes |
| Forge (Architect) | View only | Full access | Full access |
| Voice exchanges | 5 max | 5 max | Unlimited |
| Image generation | No | No | Unlimited |
| Document creation | No | No | Unlimited |
| Memory/vault | No | Limited | Full |
| Agent library (VAULT) | No | Yes | Yes |
| Leo's Learning Lab | Yes | Yes | Yes |

Admin emails are configured in `NEXT_PUBLIC_ADMIN_EMAILS` environment variable.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Microphone not working | Browser needs HTTPS or localhost. Check mic permissions. |
| Avatar not loading | Check browser console for CORS errors. GLB files need proper cache headers. |
| "Connection lost" on loading screen | Firebase Auth may not have initialized. Refresh the page. |
| 3D generation stuck | Check Cloud Functions logs in Firebase Console. Generation takes 2-3 minutes. |
| Voice not playing | Make sure you clicked "Start Conversation" and spoke first. Gemini needs audio input to respond. |
| CSP errors in console | Check `next.config.js` Content-Security-Policy headers. |
| "API key reported as leaked" | Rotate the Gemini API key at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

---

## Repository

**GitHub**: [https://github.com/Web3kaneco/lorestream](https://github.com/Web3kaneco/lorestream)
**Branch**: `feature/tutor-two-way-system`
