import Replicate from "replicate";

const token = process.env.REPLICATE_API_TOKEN;
if (!token) {
  console.error("Missing REPLICATE_API_TOKEN");
  process.exit(1);
}

const owner = process.env.REPLICATE_MODEL_OWNER || "minimax";
const name = process.env.REPLICATE_MODEL_NAME || "video-01-director";

const replicate = new Replicate({ auth: token });
replicate.fetch = (url, options) => fetch(url, { ...options, cache: "no-store" });

const model = await replicate.models.get(owner, name);
const openapi = model?.latest_version?.openapi_schema;

console.log(JSON.stringify({
  model: `${owner}/${name}`,
  version: model?.latest_version?.id,
  input_schema: openapi?.components?.schemas?.Input ?? null
}, null, 2));
