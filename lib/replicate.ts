import Replicate from "replicate";

let replicate: Replicate | null = null;

export function getReplicate(): Replicate {
  if (replicate) return replicate;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error("Missing REPLICATE_API_TOKEN. Put it in your .env.local.");
  }

  replicate = new Replicate({ auth: token });

  // Next.js App Router can cache fetch responses; Replicate recommends disabling caching.
  // (See replicate-javascript troubleshooting for Next.js.)
  replicate.fetch = (url: any, options: any) => fetch(url, { ...options, cache: "no-store" });

  return replicate;
}

export function getModelId() {
  return {
    owner: process.env.REPLICATE_MODEL_OWNER || "minimax",
    name: process.env.REPLICATE_MODEL_NAME || "video-01-director",
  };
}
