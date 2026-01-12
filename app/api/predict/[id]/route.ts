import { NextResponse } from "next/server";
import { getReplicate } from "@/lib/replicate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickVideoUrl(output: any): string | null {
  if (!output) return null;

  // Replicate outputs vary: could be a string URL, an array of URLs, or FileOutput objects.
  if (typeof output === "string") return output;

  if (Array.isArray(output)) {
    const first = output[0];
    if (!first) return null;
    if (typeof first === "string") return first;
    if (typeof first?.url === "function") return String(first.url());
    if (typeof first?.url === "string") return first.url;
    return null;
  }

  if (typeof output?.url === "function") return String(output.url());
  if (typeof output?.url === "string") return output.url;

  return null;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const replicate = getReplicate();
    const prediction = await replicate.predictions.get(params.id);

    const lastLogLine =
      typeof prediction.logs === "string"
        ? prediction.logs.trim().split("\n").slice(-1)[0] ?? ""
        : "";

    return NextResponse.json({
      id: prediction.id,
      status: prediction.status,
      error: prediction.error ?? null,
      logs: lastLogLine,
      output_url: pickVideoUrl(prediction.output),
      output: prediction.output ?? null,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
