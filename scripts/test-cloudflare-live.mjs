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
const outputDir = join(root, "debug-output");
await Promise.all([
  mkdir(runtimeDir, { recursive: true }),
  mkdir(outputDir, { recursive: true })
]);

if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in the server environment.");
  process.exit(2);
}

const loadImageSource = createImageSourceLoader({ projectRoot: root, runtimeDir });
const provider = createCloudflareProvider({ loadImageSource });

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("live-test-timeout")), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

try {
  console.log("1/3 Verifying Cloudflare API token...");
  const verifyTimeout = timeoutSignal(30_000);
  const verification = await provider.verifyToken({ signal: verifyTimeout.controller.signal });
  verifyTimeout.clear();
  console.log(`    Token status: ${verification?.result?.status || "active"}`);

  const baseRequest = {
    prompt:
      "生成一张七夕主题的品牌袋鼠活动海报，竖版 9:16，温暖粉色和橙色，袋鼠手持玫瑰，背景有星河和爱心，预留活动标题和优惠信息区域。",
    brandAsset: "brand-kangaroo",
    generationType: "text-to-image",
    ratio: "9:16",
    size: "1080x1920",
    styles: ["品牌官方", "节日氛围"],
    imageCount: 1,
    referenceImages: [],
    sessionId: null
  };

  console.log(`2/3 Generating V1 with ${provider.textModel}...`);
  const firstTimeout = timeoutSignal(180_000);
  const first = await provider.generate(baseRequest, 0, { signal: firstTimeout.controller.signal });
  firstTimeout.clear();
  const firstPath = join(outputDir, `cloudflare-v1.${extensionForMime(first.mime)}`);
  await writeFile(firstPath, first.buffer);
  console.log(`    V1 saved: ${firstPath}`);

  console.log(`3/3 Editing V1 with ${provider.editModel} while keeping the same session context...`);
  const editRequest = {
    ...baseRequest,
    prompt: "请保持当前海报主题、品牌袋鼠和整体风格不变，只把袋鼠调整为双手比心，并让画面更明亮。",
    generationType: "image-edit",
    sessionId: "live-debug-session",
    contextImageUrl: firstPath,
    parentVersion: 1,
    context: { currentImageUrl: firstPath, version: 1 }
  };
  const editTimeout = timeoutSignal(180_000);
  const second = await provider.generate(editRequest, 0, { signal: editTimeout.controller.signal });
  editTimeout.clear();
  const secondPath = join(outputDir, `cloudflare-v2.${extensionForMime(second.mime)}`);
  await writeFile(secondPath, second.buffer);
  console.log(`    V2 saved: ${secondPath}`);
  console.log("\nLIVE TEST PASSED: token verification, real image generation, and context-based second-round editing all completed.");
} catch (error) {
  const cause = error?.cause?.message || "";
  console.error("\nLIVE TEST FAILED");
  console.error(`Name: ${error?.name || "Error"}`);
  console.error(`Status: ${error?.status || "n/a"}`);
  console.error(`Code: ${error?.code || "n/a"}`);
  console.error(`Message: ${error?.message || error}`);
  if (cause) console.error(`Cause: ${cause}`);
  if (/EAI_AGAIN|ENOTFOUND|ENETUNREACH|ECONNREFUSED|network/i.test(`${error?.message || ""} ${cause}`)) {
    console.error("Classification: NETWORK_EGRESS_FAILURE");
    console.error("Credential status was not evaluated because no Cloudflare HTTP response was received.");
  }
  console.error("The token value was not printed or written to disk.");
  process.exit(1);
}
