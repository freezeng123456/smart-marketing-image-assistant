import { normalize, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarketingServer } from "../server/app-server.mjs";
import { loadEnvFile } from "./env.mjs";

await loadEnvFile();

const root = normalize(join(fileURLToPath(new URL("..", import.meta.url))));
const port = Number(process.env.PORT || 4173);
const app = await createMarketingServer({ projectRoot: root, port });
const address = await app.listen();
const hasRealBackend = Boolean(app.provider);

console.log(`\nSmart Marketing Image Assistant is running:`);
console.log(`  Mock preview:      http://localhost:${address.port}/?api=mock`);
console.log(`  Function adapter:  http://localhost:${address.port}/?api=functions`);
console.log(`  Function health:   http://localhost:${address.port}/functions/health`);
console.log(
  hasRealBackend
    ? `\nReal image backend is enabled (${app.provider.name || app.provider.textModel || "router"}).\n`
    : "\nReal backend is disabled because server-side Cloudflare credentials are missing. Mock mode remains available.\n"
);

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
