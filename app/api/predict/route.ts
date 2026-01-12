import { NextResponse } from "next/server";
import { z } from "zod";
import { getModelId, getReplicate } from "@/lib/replicate";
import { buildDirectorPrompt, type CameraMove, type VisualStyle } from "@/lib/prompt";
import { resolveInputKeys } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FormSchema = z.object({
  prompt: z.string().min(3, "Please describe what should happen in the video."),
  camera: z.string().min(1),
  durationSec: z.coerce.number().min(2).max(6),
  style: z.string().min(1),
  motionIntensity: z.enum(["subtle", "medium", "strong"]),
  seed: z.string().optional(),
});

function toIntOrUndefined(x?: string) {
  if (!x) return undefined;
  const n = Number.parseInt(x, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const image = form.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    const raw = {
      prompt: String(form.get("prompt") ?? ""),
      camera: String(form.get("camera") ?? "static"),
      durationSec: String(form.get("durationSec") ?? "6"),
      style: String(form.get("style") ?? "cinematic"),
      motionIntensity: String(form.get("motionIntensity") ?? "medium"),
      seed: form.get("seed") ? String(form.get("seed")) : undefined,
    };

    const parsed = FormSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    
    let replicate;
    try {
      replicate = getReplicate();
    } catch (e: any) {
      return NextResponse.json(
        {
          error:
            e?.message ??
            "Missing REPLICATE_API_TOKEN. This endpoint requires Replicate credentials.",
        },
        { status: 400 }
      );
    }

    const { owner, name } = getModelId();

    // Fetch model info
    const model = await replicate.models.get(owner, name);

    const version =
      process.env.REPLICATE_MODEL_VERSION ?? model.latest_version?.id;

    if (!version) {
      return NextResponse.json(
        {
          error:
            "Replicate model version not found (latest_version missing). " +
            "Set REPLICATE_MODEL_VERSION in env or choose a model that exposes latest_version.",
        },
        { status: 500 }
      );
    }

    // Try to read the model schema to map correct input keys.
    // If openapi_schema is missing, fall back to common keys.
    const openapi = model.latest_version?.openapi_schema ?? null;

    const resolved = openapi
      ? resolveInputKeys(openapi)
      : {
          // Fallback mapping (best-effort)
          promptKey: "prompt",
          imageKey: "image",
          seedKey: "seed",
          durationKey: undefined as string | undefined,
          extraDefaults: {} as Record<string, unknown>,
        };

    const seed = toIntOrUndefined(parsed.data.seed);

    const directorPrompt = buildDirectorPrompt({
      userPrompt: parsed.data.prompt,
      camera: parsed.data.camera as CameraMove,
      durationSec: parsed.data.durationSec,
      style: parsed.data.style as VisualStyle,
      motionIntensity: parsed.data.motionIntensity,
    });

    const imageBuffer = Buffer.from(await image.arrayBuffer());

    const input: Record<string, unknown> = {
      ...resolved.extraDefaults,
      [resolved.promptKey]: directorPrompt,
    };

    // If the model has a dedicated duration input, pass it.
    if (resolved.durationKey) input[resolved.durationKey] = parsed.data.durationSec;

    if (resolved.seedKey && typeof seed === "number") input[resolved.seedKey] = seed;

    if (resolved.imageKey) {
      // Replicate client will upload Buffer and provide a file URL internally.
      input[resolved.imageKey] = imageBuffer;
    } else {
      return NextResponse.json(
        {
          error:
            "This model schema did not expose an image input. Pick a model that supports image-to-video.",
        },
        { status: 400 }
      );
    }

    const prediction = await replicate.predictions.create({
      version,
      input,
    });

    return NextResponse.json({
      id: prediction.id,
      status: prediction.status,
      created_at: prediction.created_at,
      model: `${owner}/${name}`,
      used_schema: Boolean(openapi),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
