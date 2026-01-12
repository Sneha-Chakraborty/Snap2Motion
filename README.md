# Snap2Motion — Image → Video Agent (Option 1)

A simple **Image → Video** “agent” MVP for your internship assignment.

- Upload an image
- Write a prompt describing what should happen
- Choose motion intensity + duration + (best-effort) camera movement
- Generate a short video (MP4/WebM)

## ✅ Free modes

This repo ships with **two free options**:

1) **Local lite (always works)** — prompt-driven camera motion clip generated in your browser (good fallback when ZeroGPU is overloaded)
2) **Hugging Face ZeroGPU (AI)** — image + prompt → video (best for the assignment)


### 1) Free AI mode (recommended): Hugging Face ZeroGPU backend

This project defaults to **Free (Hugging Face ZeroGPU)**.  
It uses a **public Hugging Face Space** that generates video from an **image + text prompt**.

**Pros**
- 100% free (no token needed)
- Works in local dev and in deployment (Vercel)

**Cons**
- It may queue / sleep / rate-limit sometimes (because it’s a public shared Space)

### Run locally (free mode)

```bash
npm install
npm run dev
```

Open: http://localhost:3000

### Optional: choose a different Space

You can override it:

```bash
# .env.local
NEXT_PUBLIC_HF_SPACE_ID=multimodalart/stable-video-diffusion
```

> Note: because this is a public shared Space, it can queue, sleep, or fail occasionally. If that happens, retry, reduce duration to 2–4 seconds, or switch to another Space in the UI.

### 2) Free fallback (always works): Local lite

Select **Provider → “Free (Local lite — always works)”**.

- Runs fully in the browser (no API keys)
- Uses prompt + camera controls to generate a short motion clip
- Output is **WebM**

---

## Optional backend: Replicate

Replicate gives better “director-like” camera control if you use a director model, but **many video models require credits**.

### Setup (Replicate mode)

1) Create a Replicate account  
2) Create an API token  
3) Create `.env.local`:

```env
REPLICATE_API_TOKEN=YOUR_TOKEN_HERE
REPLICATE_MODEL_OWNER=minimax
REPLICATE_MODEL_NAME=video-01-director
```

> If you get “402 Insufficient credit”, switch back to **Free (Hugging Face ZeroGPU)** in the UI.

Run:

```bash
npm run dev
```

---

## Deploy (Vercel)

1) Push to GitHub
2) Import the repo in Vercel
3) If you use **Replicate**, add `REPLICATE_API_TOKEN` in Vercel environment variables
4) Deploy

---

## Repo structure

- `app/page.tsx` — UI + free HF + local lite + (optional) Replicate mode
- `app/api/predict` — starts Replicate prediction
- `app/api/predict/[id]` — polls Replicate prediction
- `lib/prompt.ts` — prompt “agent” helper (server-side for Replicate)

---

## Troubleshooting

### “GPU task aborted” (Hugging Face)

This is a **Hugging Face ZeroGPU** overload/quota/runtime issue. Fixes:

- Try again (it’s intermittent)
- Keep **Duration = 2–4s** and **Motion = Subtle**
- Turn on **“Resize image before sending”**
- Switch Space (dropdown in the UI)
- If you need a guaranteed output right now, use **Local lite**

---

## Notes

- The Hugging Face backend is *prompt-based* (image + prompt).
- Camera control in free mode is best-effort (encoded into prompt).
- For production reliability, you’d normally host your own model (GPU) or pay for an inference provider.
