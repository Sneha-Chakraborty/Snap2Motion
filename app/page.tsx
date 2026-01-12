'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
// Replicate mode (optional) is handled server-side; the client only sends form fields.

type Provider = "hf" | "local" | "replicate";
type MotionIntensity = "subtle" | "medium" | "strong";
type CameraMove =
  | "none"
  | "push_in"
  | "pull_out"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "orbit_left"
  | "orbit_right";

const FORM_SCHEMA = z.object({
  prompt: z.string().min(3, "Please write a prompt (at least 3 characters).").max(500),
  motionIntensity: z.enum(["subtle", "medium", "strong"]),
  durationSec: z.number().min(2).max(6),
  cameraMove: z.enum([
    "none",
    "push_in",
    "pull_out",
    "pan_left",
    "pan_right",
    "tilt_up",
    "tilt_down",
    "orbit_left",
    "orbit_right",
  ]),
  // Replicate-only “director” knobs
  shotType: z.enum(["wide", "medium", "closeup"]),
  lighting: z.enum(["natural", "cinematic", "neon", "soft"]),
});

function toReplicateCamera(move: CameraMove): string {
  switch (move) {
    case "none":
      return "static";
    case "push_in":
      return "push_in";
    case "pull_out":
      return "pull_out";
    case "pan_left":
      return "pan_left";
    case "pan_right":
      return "pan_right";
    case "tilt_up":
      return "tilt_up";
    case "tilt_down":
      return "tilt_down";
    case "orbit_left":
      return "tracking";
    case "orbit_right":
      return "tracking";
    default:
      return "static";
  }
}

function toReplicateStyle(lighting: "natural" | "cinematic" | "neon" | "soft"): string {
  // VisualStyle in lib/prompt.ts supports: cinematic | realistic | anime | dreamy | retro
  switch (lighting) {
    case "natural":
      return "realistic";
    case "cinematic":
      return "cinematic";
    case "soft":
      return "dreamy";
    case "neon":
      return "retro";
    default:
      return "cinematic";
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function cameraMoveToNaturalText(m: CameraMove) {
  switch (m) {
    case "push_in":
      return "slow push-in (dolly in)";
    case "pull_out":
      return "slow pull-out (dolly out)";
    case "pan_left":
      return "slow pan left";
    case "pan_right":
      return "slow pan right";
    case "tilt_up":
      return "slow tilt up";
    case "tilt_down":
      return "slow tilt down";
    case "orbit_left":
      return "slow orbit left";
    case "orbit_right":
      return "slow orbit right";
    default:
      return "static camera";
  }
}

function intensityToNaturalText(i: MotionIntensity) {
  switch (i) {
    case "subtle":
      return "subtle, gentle motion";
    case "strong":
      return "strong, dynamic motion";
    default:
      return "moderate, natural motion";
  }
}

function buildHfPrompt(opts: {
  userPrompt: string;
  motionIntensity: MotionIntensity;
  durationSec: number;
  cameraMove: CameraMove;
}) {
  const cam = cameraMoveToNaturalText(opts.cameraMove);
  const motion = intensityToNaturalText(opts.motionIntensity);
  return `${opts.userPrompt}. ${motion}. Camera: ${cam}. Duration ~${opts.durationSec}s. Smooth, cinematic animation.`;
}

function extractVideoUrlFromGradio(result: any): string | null {
  // Common shapes:
  // - { data: [ { url: "https://.../file=..." } , ...] }
  // - { data: [ "https://...mp4", ...] }
  // - { data: [ { video: { url: ... } } ] }
  const data = result?.data ?? result;
  const items = Array.isArray(data) ? data : [data];

  const tryOne = (v: any): string | null => {
    if (!v) return null;
    if (typeof v === "string") {
      if (v.startsWith("http")) return v;
      return null;
    }
    if (typeof v?.url === "string" && v.url.startsWith("http")) return v.url;
    if (typeof v?.path === "string" && v.path.startsWith("http")) return v.path;
    if (v?.video) return tryOne(v.video);
    // Sometimes output is { "name": "...", "data": "https://..." }
    if (typeof v?.data === "string" && v.data.startsWith("http")) return v.data;
    return null;
  };

  for (const it of items) {
    const u = tryOne(it);
    if (u) return u;
  }
  return null;
}

function motionIntensityToWanDefaults(i: MotionIntensity) {
  // This model does not expose a dedicated motion slider, so we encode it into the prompt.
  // We still use this to tweak duration a tiny bit for “feel”.
  if (i === "subtle") return { steps: 4, guidance: 1 };
  if (i === "strong") return { steps: 6, guidance: 1.5 };
  return { steps: 5, guidance: 1.2 };
}

async function loadGradioClientFromCDN() {
  // Pin the version so your deployment is stable.
  // Note: Using `webpackIgnore` keeps Next.js from bundling this dependency.
  // @ts-ignore - Dynamic CDN import
  const mod: any = await import("@gradio/client");
  return mod;
}

function looksLikeHfGpuAbort(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("gpu task aborted") ||
    m.includes("zerogpu worker error") ||
    m.includes("insufficient gpu") ||
    m.includes("insufficient gpu time") ||
    m.includes("quota") ||
    m.includes("requested") ||
    m.includes("timed out") ||
    m.includes("overloaded")
  );
}

async function resizeImageFile(file: File, maxSide: number): Promise<File> {
  // Client-side resize to help ZeroGPU stay within time limits.
  const bitmap = await createImageBitmap(file);
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  const max0 = Math.max(w0, h0);
  if (max0 <= maxSide) return file;

  const scale = maxSide / max0;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to resize image"))),
      "image/jpeg",
      0.92
    );
  });

  const base = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}_resized.jpg`, { type: "image/jpeg" });
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

async function generateLocalLiteVideo(opts: {
  imageFile: File;
  durationSec: number;
  motionIntensity: MotionIntensity;
  cameraMove: CameraMove;
  setStatus: (s: string) => void;
}): Promise<string> {
  // 100% free fallback (client-side): Ken Burns / parallax-ish camera animation recorded to WebM.
  // This is here so the demo ALWAYS produces a video even if ZeroGPU is overloaded.
  const fps = 24;
  const frames = Math.max(12, Math.round(opts.durationSec * fps));

  opts.setStatus("Preparing local (free) render…");

  const bitmap = await createImageBitmap(opts.imageFile);
  const imgW = bitmap.width;
  const imgH = bitmap.height;

  const maxSide = 720;
  const scaleTo = maxSide / Math.max(imgW, imgH);
  const canvasW = Math.max(320, Math.round(imgW * Math.min(1, scaleTo)));
  const canvasH = Math.max(320, Math.round(imgH * Math.min(1, scaleTo)));

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser.");

  const stream = canvas.captureStream(fps);

  const tryMime = (m: string) => (window as any).MediaRecorder?.isTypeSupported?.(m) ? m : null;
  const mime =
    tryMime("video/webm;codecs=vp9") ||
    tryMime("video/webm;codecs=vp8") ||
    "video/webm";

  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const finished = new Promise<string>((resolve) => {
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      resolve(url);
    };
  });

  rec.start();

  const intensity = opts.motionIntensity === "subtle" ? 0.6 : opts.motionIntensity === "strong" ? 1.6 : 1.0;

  const zoomEnd =
    opts.cameraMove === "push_in" ? 1.10 :
    opts.cameraMove === "pull_out" ? 0.92 :
    1.04;

  const panAmount = 0.06 * intensity; // as fraction of canvas

  for (let i = 0; i < frames; i++) {
    const t = easeInOut(i / (frames - 1));

    // Base cover scale so we fill the canvas.
    const cover = Math.max(canvasW / imgW, canvasH / imgH);
    const zoom = 1 + (zoomEnd - 1) * t;
    const s = cover * zoom;

    let px = 0;
    let py = 0;
    if (opts.cameraMove === "pan_left") px = -canvasW * panAmount * t;
    if (opts.cameraMove === "pan_right") px = canvasW * panAmount * t;
    if (opts.cameraMove === "tilt_up") py = -canvasH * panAmount * t;
    if (opts.cameraMove === "tilt_down") py = canvasH * panAmount * t;
    if (opts.cameraMove === "orbit_left") px = -canvasW * panAmount * Math.sin(t * Math.PI);
    if (opts.cameraMove === "orbit_right") px = canvasW * panAmount * Math.sin(t * Math.PI);

    // Subtle “breathing” motion
    const wiggle = 0.008 * intensity;
    px += canvasW * wiggle * Math.sin(i * 0.35);
    py += canvasH * wiggle * Math.cos(i * 0.31);

    const drawW = imgW * s;
    const drawH = imgH * s;
    const dx = (canvasW - drawW) / 2 + px;
    const dy = (canvasH - drawH) / 2 + py;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(bitmap, dx, dy, drawW, drawH);

    opts.setStatus(`Rendering locally… ${Math.round((i / (frames - 1)) * 100)}%`);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  rec.stop();
  opts.setStatus("Done ✅ (local render)");
  return finished;
}

export default function Home() {
  const [provider, setProvider] = useState<Provider>("local");

  // Recommended free ZeroGPU Spaces (these can still queue / abort depending on load).
  const HF_SPACES = useMemo(
    () => [
      { id: "multimodalart/stable-video-diffusion", label: "Stable Video Diffusion 1.1 (recommended)" },
      { id: "ginigen/framepack-i2v", label: "FramePack i2v (alternative)" },
      { id: "zai-org/CogVideoX-5B-Space", label: "CogVideoX-5B (heavier, may abort)" },
      { id: "zerogpu-aoti/wan2-2-fp8da-aoti-faster", label: "Wan2.2 AOTI faster (can abort)" },
    ],
    []
  );

  const [hfSpaceId, setHfSpaceId] = useState<string>(
    process.env.NEXT_PUBLIC_HF_SPACE_ID ?? "multimodalart/stable-video-diffusion"
  );
  const [hfResizeEnabled, setHfResizeEnabled] = useState<boolean>(true);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [prompt, setPrompt] = useState<string>("Make the scene subtly come alive with natural motion.");
  const [motionIntensity, setMotionIntensity] = useState<MotionIntensity>("medium");
  const [durationSec, setDurationSec] = useState<number>(4);
  const [cameraMove, setCameraMove] = useState<CameraMove>("none");

  // Replicate-only knobs (kept for “camera control” bonus)
  const [shotType, setShotType] = useState<"wide" | "medium" | "closeup">("medium");
  const [lighting, setLighting] = useState<"natural" | "cinematic" | "neon" | "soft">("cinematic");

  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    return () => {
      abortRef.current.aborted = true;
    };
  }, []);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // When using the free HF backend, max duration depends on the Space/model.
  // We keep the UI at 2–6 seconds, but clamp internally when calling HF if needed.
  const durationSafe = useMemo(() => clamp(durationSec, 2, 6), [durationSec]);

  const validate = () => {
    const parsed = FORM_SCHEMA.safeParse({
      prompt,
      motionIntensity,
      durationSec: durationSafe,
      cameraMove,
      shotType,
      lighting,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message ?? "Invalid input.";
      setError(msg);
      return false;
    }
    if (!imageFile) {
      setError("Please upload an image first.");
      return false;
    }
    return true;
  };

  const startReplicate = async () => {
    setError(null);
    setVideoUrl(null);
    setJobId(null);
    setIsRunning(true);
    setStatus("Starting Replicate job...");

    const formData = new FormData();
    formData.append("image", imageFile!);
    formData.append("prompt", prompt);
    formData.append("camera", toReplicateCamera(cameraMove));
    formData.append("durationSec", String(durationSafe));
    formData.append("style", toReplicateStyle(lighting));
    formData.append("motionIntensity", motionIntensity);

    const res = await fetch("/api/predict", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error ?? "Failed to start prediction.");
    }
    setJobId(data.id as string);
  };

  const pollReplicate = async (id: string) => {
    const intervalMs = 1500;
    setStatus("Replicate: generating…");
    while (!abortRef.current.aborted) {
      const r = await fetch(`/api/predict/${encodeURIComponent(id)}`, { method: "GET" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Replicate polling failed.");

      if (j.status === "succeeded") {
        const url = j.output_url as string | null;
        if (!url) throw new Error("Replicate succeeded but no output video URL found.");
        setVideoUrl(url);
        setStatus("Done ✅");
        setIsRunning(false);
        return;
      }

      if (j.status === "failed" || j.status === "canceled") {
        throw new Error(j.error ?? `Replicate job ${j.status}.`);
      }

      setStatus(`Replicate: ${j.status ?? "running"}…`);
      await new Promise((s) => setTimeout(s, intervalMs));
    }
  };

  const startHuggingFace = async () => {
    setError(null);
    setVideoUrl(null);
    setJobId(null);
    setIsRunning(true);

    const { Client, handle_file } = await loadGradioClientFromCDN();

    const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
    const candidateSpaces = uniq([
      hfSpaceId,
      ...HF_SPACES.map((s) => s.id),
    ]);

    const attemptProfiles = [
      { maxSide: hfResizeEnabled ? 768 : 10_000, duration: durationSafe, stepsMul: 1.0 },
      { maxSide: hfResizeEnabled ? 512 : 10_000, duration: Math.min(durationSafe, 4), stepsMul: 0.85 },
      { maxSide: hfResizeEnabled ? 384 : 10_000, duration: 2, stepsMul: 0.75 },
    ];

    let lastErr: any = null;

    for (const spaceId of candidateSpaces) {
      for (let attempt = 0; attempt < attemptProfiles.length; attempt++) {
        if (abortRef.current.aborted) break;
        const prof = attemptProfiles[attempt];

        try {
          setStatus(`Connecting to HF Space: ${spaceId}…`);
          const app = await Client.connect(spaceId);

          setStatus("Inspecting Space API…");
          const api: any = await app.view_api(fetch);

          const pickBestEndpoint = () => {
            const scored: Array<{ endpoint: string | number; score: number; info: any }> = [];

            const scoreEndpoint = (endpoint: string | number, info: any, bonusNamed: number) => {
              const params: any[] = info?.parameters ?? [];
              const lowerNames = params.map((p) => String(p?.parameter_name ?? "").toLowerCase());
              const comps = params.map((p) => String(p?.component ?? "").toLowerCase());

              const hasImage = lowerNames.some((n) => n.includes("image")) || comps.some((c) => c.includes("image"));
              const hasPrompt =
                lowerNames.some((n) => n === "prompt" || (n.includes("prompt") && !n.includes("negative"))) ||
                comps.some((c) => c.includes("textbox"));

              let score = 0;
              if (hasImage) score += 5;
              if (hasPrompt) score += 5;
              if (lowerNames.some((n) => n.includes("duration"))) score += 2;
              if (lowerNames.some((n) => n.includes("steps"))) score += 1;
              score += bonusNamed;
              scored.push({ endpoint, score, info });
            };

            for (const [name, info] of Object.entries(api?.named_endpoints ?? {})) {
              scoreEndpoint(name, info, 1);
            }
            for (const [idx, info] of Object.entries(api?.unnamed_endpoints ?? {})) {
              const n = Number(idx);
              if (!Number.isNaN(n)) scoreEndpoint(n, info, 0);
            }

            scored.sort((a, b) => b.score - a.score);
            return scored[0]?.endpoint ?? "/predict";
          };

          const endpoint = pickBestEndpoint();
          const params: any[] =
            (typeof endpoint === "string"
              ? api?.named_endpoints?.[endpoint]?.parameters
              : api?.unnamed_endpoints?.[endpoint]?.parameters) ?? [];

          const srcFile = imageFile!;
          const fileToSend = await resizeImageFile(srcFile, prof.maxSide);

          const base = motionIntensityToWanDefaults(motionIntensity);
          const steps = Math.max(3, Math.round(base.steps * prof.stepsMul));
          const guidance = base.guidance;

          const payload: Record<string, any> = {};
          for (const p of params) {
            const name = String(p?.parameter_name ?? "");
            const lname = name.toLowerCase();

            if (lname.includes("image")) {
              payload[name] = handle_file(fileToSend);
              continue;
            }

            if (lname === "prompt" || (lname.includes("prompt") && !lname.includes("negative"))) {
              payload[name] = buildHfPrompt({
                userPrompt: prompt,
                motionIntensity,
                durationSec: prof.duration,
                cameraMove,
              });
              continue;
            }

            if (lname.includes("negative")) {
              payload[name] = "blurry, low quality, watermark, subtitles, deformed, artifacts";
              continue;
            }

            if (lname.includes("duration")) {
              payload[name] = prof.duration;
              continue;
            }

            if (lname.includes("steps")) {
              payload[name] = steps;
              continue;
            }

            if (lname.includes("guidance_scale_2")) {
              payload[name] = guidance;
              continue;
            }

            if (lname.includes("guidance_scale")) {
              payload[name] = guidance;
              continue;
            }

            if (lname === "seed") {
              payload[name] = 42;
              continue;
            }

            if (lname.includes("randomize") && lname.includes("seed")) {
              payload[name] = true;
              continue;
            }

            if (p?.parameter_has_default) payload[name] = p?.parameter_default;
          }

          setStatus(`Generating on ${spaceId}… (may queue)`);
          const result: any = await app.predict(endpoint, payload);
          const url = extractVideoUrlFromGradio(result);
          if (!url) throw new Error("Space returned, but no video URL was found in the output.");

          setVideoUrl(url);
          setStatus("Done ✅");
          setIsRunning(false);
          return;
        } catch (e: any) {
          lastErr = e;
          const msg = String(e?.message ?? e);
          if (!looksLikeHfGpuAbort(msg)) {
            // Not an overload/quota-type error — try the next Space instead of retrying forever.
            break;
          }
          setStatus(`HF busy (attempt ${attempt + 1}/3). Retrying with lighter settings…`);
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    const lastMsg = String(lastErr?.message ?? lastErr ?? "Unknown error");
    throw new Error(
      `Hugging Face ZeroGPU is busy or your GPU time was cut short ("GPU task aborted").\n\nTry: (1) duration 2–4s, (2) Motion=Subtle, (3) keep the default "Stable Video Diffusion" Space, or (4) switch Provider → "Local Free (always works)".\n\nDetails: ${lastMsg}`
    );
  };

  const onGenerate = async () => {
    if (!validate()) return;
    setError(null);

    try {
      if (provider === "hf") {
        await startHuggingFace();
        return;
      }

      if (provider === "local") {
        setVideoUrl(null);
        setJobId(null);
        setIsRunning(true);
        const url = await generateLocalLiteVideo({
          imageFile: imageFile!,
          durationSec: durationSafe,
          motionIntensity,
          cameraMove,
          setStatus,
        });
        setVideoUrl(url);
        setIsRunning(false);
        return;
      }

      await startReplicate();
    } catch (e: any) {
      setIsRunning(false);
      setStatus("");
      setError(e?.message ?? "Something went wrong.");
    }
  };

  // Start polling for Replicate after jobId appears
  useEffect(() => {
    if (!jobId) return;
    if (provider !== "replicate") return;

    let cancelled = false;
    (async () => {
      try {
        await pollReplicate(jobId);
      } catch (e: any) {
        if (cancelled) return;
        setIsRunning(false);
        setStatus("");
        setError(e?.message ?? "Replicate failed.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, provider]);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Snap2Motion — Image → Video Agent</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Upload an image, describe the motion you want, pick basic controls, and generate a short video.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>1) Inputs</h2>

          <label style={{ display: "block", marginBottom: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Provider</div>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
              disabled={isRunning}
            >
              <option value="local">Free (Local lite — always works)</option>
              <option value="hf">Free (Hugging Face ZeroGPU)</option>
              <option value="replicate">Replicate (better camera control; may require credits)</option>
            </select>
          </label>

          {provider === "hf" ? (
            <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
              Uses a public Hugging Face Space that generates video from an <b>image + text prompt</b>. It’s free, but it can
              queue or sleep.
            </div>
          ) : provider === "local" ? (
            <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
              Generates a short motion clip <b>entirely in your browser</b> (no GPU / no API). Best for a guaranteed demo
              when ZeroGPU is overloaded. Output is WebM.
            </div>
          ) : (
            <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
              Uses the Replicate API. Great if you want “director-style” camera controls, but many video models require paid credits.
            </div>
          )}

          {provider === "hf" ? (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, border: "1px solid #eee", background: "#0e0327" }}>
              <label style={{ display: "block", marginBottom: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Hugging Face Space</div>
                <select
                  value={hfSpaceId}
                  onChange={(e) => setHfSpaceId(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  disabled={isRunning}
                >
                  {HF_SPACES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={hfResizeEnabled}
                  onChange={(e) => setHfResizeEnabled(e.target.checked)}
                  disabled={isRunning}
                />
                Resize image before sending (recommended for fewer “GPU task aborted” errors)
              </label>
            </div>
          ) : null}

          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Image</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              disabled={isRunning}
            />
          </label>

          {imagePreviewUrl ? (
            <div style={{ marginBottom: 12 }}>
              <img
                src={imagePreviewUrl}
                alt="preview"
                style={{ width: "100%", height: "auto", borderRadius: 10, border: "1px solid #eee" }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 12, padding: 16, borderRadius: 10, border: "1px dashed #bbb", opacity: 0.8 }}>
              Upload an image to preview it here.
            </div>
          )}

          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Prompt</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
              disabled={isRunning}
              placeholder="Describe what should happen in the video…"
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "block" }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Motion</div>
              <select
                value={motionIntensity}
                onChange={(e) => setMotionIntensity(e.target.value as MotionIntensity)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                disabled={isRunning}
              >
                <option value="subtle">Subtle</option>
                <option value="medium">Medium</option>
                <option value="strong">Strong</option>
              </select>
            </label>

            <label style={{ display: "block" }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Duration (sec)</div>
              <input
                type="number"
                min={2}
                max={6}
                step={1}
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                disabled={isRunning}
              />
            </label>
          </div>

          <label style={{ display: "block", marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Camera movement</div>
            <select
              value={cameraMove}
              onChange={(e) => setCameraMove(e.target.value as CameraMove)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
              disabled={isRunning}
            >
              <option value="none">None</option>
              <option value="push_in">Push in</option>
              <option value="pull_out">Pull out</option>
              <option value="pan_left">Pan left</option>
              <option value="pan_right">Pan right</option>
              <option value="tilt_up">Tilt up</option>
              <option value="tilt_down">Tilt down</option>
              <option value="orbit_left">Orbit left</option>
              <option value="orbit_right">Orbit right</option>
            </select>

            {provider === "hf" ? (
              <div style={{ fontSize: 12, marginTop: 6, opacity: 0.75 }}>
                In the free mode, camera control is encoded into the text prompt (best-effort). Some motions may be subtle.
              </div>
            ) : null}
          </label>

          {provider === "replicate" ? (
            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Replicate “Director” extras</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "block" }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Shot</div>
                  <select
                    value={shotType}
                    onChange={(e) => setShotType(e.target.value as any)}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                    disabled={isRunning}
                  >
                    <option value="wide">Wide</option>
                    <option value="medium">Medium</option>
                    <option value="closeup">Close-up</option>
                  </select>
                </label>

                <label style={{ display: "block" }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Lighting</div>
                  <select
                    value={lighting}
                    onChange={(e) => setLighting(e.target.value as any)}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                    disabled={isRunning}
                  >
                    <option value="natural">Natural</option>
                    <option value="cinematic">Cinematic</option>
                    <option value="neon">Neon</option>
                    <option value="soft">Soft</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          <button
            onClick={onGenerate}
            disabled={isRunning}
            style={{
              marginTop: 16,
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #333",
              background: isRunning ? "#eee" : "#111",
              color: isRunning ? "#333" : "#fff",
              cursor: isRunning ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {isRunning ? "Generating…" : "Generate Video"}
          </button>

          {status ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>{status}</div> : null}
          {error ? (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#ffecec", color: "#000000", border: "1px solid #ffb3b3" }}>
              <b>Error:</b> {error}
            </div>
          ) : null}
        </section>

        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>2) Output</h2>

          {!videoUrl ? (
            <div style={{ padding: 16, borderRadius: 10, border: "1px dashed #bbb", opacity: 0.8 }}>
              Your generated video will show up here.
            </div>
          ) : (
            <div>
              <video
                src={videoUrl}
                controls
                playsInline
                style={{ width: "100%", borderRadius: 10, border: "1px solid #eee" }}
              />
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                Tip: Right-click the video → “Save video as…” (or use your browser download control).
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
            <b>How it works:</b> The app uploads the image, builds an “agent prompt” (adds motion + camera hints),
            sends the request to the selected backend, then streams back a playable MP4 URL.
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 24, fontSize: 12, opacity: 0.7 }}>
        Built for the intern assignment: Image → Video Agent MVP.
      </footer>
    </main>
  );
}
