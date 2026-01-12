type OpenAPISchema = any;

export type ResolvedInputKeys = {
  promptKey: string;
  imageKey?: string;
  durationKey?: string;
  seedKey?: string;
  extraDefaults: Record<string, unknown>;
};

function lc(x: unknown): string {
  return String(x ?? "").toLowerCase();
}

export function resolveInputKeys(openapi: OpenAPISchema): ResolvedInputKeys {
  const inputSchema =
    openapi?.components?.schemas?.Input ??
    openapi?.components?.schemas?.["Input"] ??
    null;

  const props: Record<string, any> = inputSchema?.properties ?? {};
  const required: string[] = inputSchema?.required ?? [];

  const keys = Object.keys(props);

  const findKey = (pred: (k: string, p: any) => boolean) => {
    for (const k of keys) {
      const p = props[k];
      if (pred(k, p)) return k;
    }
    return undefined;
  };

  const promptKey =
    findKey((k, p) => lc(k).includes("prompt") || lc(p?.title).includes("prompt")) ?? "prompt";

  // Heuristic: pick a property that looks like an image/file input.
  const imageKey =
    findKey((k, p) => {
      const kL = lc(k);
      const title = lc(p?.title);
      const desc = lc(p?.description);
      const looksLikeImage = kL.includes("image") || title.includes("image") || desc.includes("image");
      if (!looksLikeImage) return false;

      // Many Replicate file inputs are `string` with `format: uri`.
      const t = lc(p?.type);
      const f = lc(p?.format);
      return t === "string" || f === "uri";
    }) ??
    // Fallback: any required field with uri format
    findKey((k, p) => required.includes(k) && lc(p?.format) === "uri");

  const durationKey =
    findKey((k, p) => lc(k).includes("duration") || lc(p?.title).includes("duration") || lc(k).includes("seconds")) ??
    findKey((k, p) => lc(k).includes("video_length") || lc(k).includes("length"));

  const seedKey =
    findKey((k, p) => lc(k) === "seed" || lc(p?.title) === "seed");

  const extraDefaults: Record<string, unknown> = {};

  // Some models have a mode switch (e.g., "mode": "i2v" / "t2v").
  // If it's required and has an enum with something that looks like image-to-video, pick it.
  for (const k of required) {
    if (k === promptKey || k === imageKey || k === durationKey || k === seedKey) continue;
    const p = props[k];
    const enumVals: unknown[] = p?.enum ?? [];
    const candidates = enumVals.map(String);
    const i2v = candidates.find(v => lc(v).includes("image") || lc(v).includes("i2v"));
    if (i2v) extraDefaults[k] = i2v;
  }

  return { promptKey, imageKey, durationKey, seedKey, extraDefaults };
}
