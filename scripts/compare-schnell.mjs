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
await mkdir(runtimeDir, { recursive: true });
await mkdir("/workspace/model-compare", { recursive: true });
const loadImageSource = createImageSourceLoader({ projectRoot: root, runtimeDir });
const model = "@cf/black-forest-labs/flux-1-schnell";
const provider = createCloudflareProvider({ loadImageSource, textModel: model, editModel: model, outputMaxDimension: 768 });
const result = await provider.generate({
  prompt: "七夕情人节营销海报，9:16竖版，浪漫氛围，美团黄袋鼠吉祥物侧面手持玫瑰",
  brandAsset: "brand-kangaroo", generationType: "text-to-image", ratio: "9:16", size: "1080x1920",
  styles: ["品牌官方", "节日氛围"], referenceImages: [], sessionId: null
}, 0);
const path = `/workspace/model-compare/flux-1-schnell.${extensionForMime(result.mime)}`;
await writeFile(path, result.buffer);
console.log("saved", path, result.buffer.length);
