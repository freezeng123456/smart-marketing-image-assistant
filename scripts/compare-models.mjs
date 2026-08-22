import { mkdir, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createCloudflareProvider } from "../server/cloudflare-provider.mjs";
import { extensionForMime } from "../server/image-utils.mjs";
import { createImageSourceLoader } from "../server/source-loader.mjs";
import { loadEnvFile } from "./env.mjs";

await loadEnvFile();

const root = normalize(join(fileURLToPath(new URL("..", import.meta.url))));
const runtimeDir = join(root, ".runtime");
const outDir = "/workspace/model-compare";
await mkdir(runtimeDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const models = [
  { id: "klein-9b", model: "@cf/black-forest-labs/flux-2-klein-9b", img2img: true },
  { id: "flux-2-dev", model: "@cf/black-forest-labs/flux-2-dev", img2img: true },
  { id: "flux-1-schnell", model: "@cf/black-forest-labs/flux-1-schnell", img2img: false },
  { id: "phoenix", model: "@cf/leonardo/phoenix-1.0", img2img: false },
  { id: "lucid-origin", model: "@cf/leonardo/lucid-origin", img2img: false }
];

const loadImageSource = createImageSourceLoader({ projectRoot: root, runtimeDir });
const request = {
  prompt: "七夕情人节营销海报，9:16竖版，浪漫氛围，美团黄袋鼠吉祥物侧面手持玫瑰",
  brandAsset: "brand-kangaroo",
  generationType: "text-to-image",
  ratio: "9:16",
  size: "1080x1920",
  styles: ["品牌官方", "节日氛围"],
  referenceImages: [],
  sessionId: null
};

const summary = [];
for (const item of models) {
  process.env.CLOUDFLARE_TEXT_MODEL = item.model;
  process.env.CLOUDFLARE_EDIT_MODEL = item.model;
  const provider = createCloudflareProvider({
    loadImageSource,
    textModel: item.model,
    editModel: item.model,
    outputMaxDimension: Number(process.env.CLOUDFLARE_OUTPUT_MAX_DIMENSION || 768),
    referenceMaxDimension: Number(process.env.CLOUDFLARE_REFERENCE_MAX_DIMENSION || 768)
  });
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), 240_000);
    const result = await provider.generate(request, 0, { signal: controller.signal });
    clearTimeout(timer);
    const path = join(outDir, `${item.id}.${extensionForMime(result.mime)}`);
    await writeFile(path, result.buffer);
    const row = { id: item.id, model: item.model, img2img: item.img2img, ok: true, ms: Date.now() - started, path, bytes: result.buffer.length };
    summary.push(row);
    console.log(JSON.stringify(row));
  } catch (error) {
    const row = {
      id: item.id,
      model: item.model,
      img2img: item.img2img,
      ok: false,
      ms: Date.now() - started,
      status: error?.status || 0,
      message: String(error?.message || error).slice(0, 300)
    };
    summary.push(row);
    console.log(JSON.stringify(row));
  }
}
await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log("DONE", summary.filter((x) => x.ok).length, "/", summary.length);
