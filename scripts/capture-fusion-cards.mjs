import { access } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CAPTURE_MANIFEST_PATH,
  PARSER_VERSION,
  RAW_ROOT,
  ROUTES_PATH,
  fetchWithRetry,
  getCliValue,
  parseCardPage,
  parseIds,
  readJson,
  sha256,
  writeGzip,
  writeJson,
} from "./lib/fusion-pipeline.mjs";

const routesPayload = await readJson(ROUTES_PATH);
const routesById = new Map(routesPayload.routes.map((route) => [route.id, route]));
const requestedIds = parseIds(getCliValue("--ids"));
const from = getCliValue("--from");
const to = getCliValue("--to");
const concurrency = Math.max(1, Math.min(24, Number(getCliValue("--concurrency", "6")) || 6));
const force = process.argv.includes("--force");
const selected = requestedIds.length
  ? requestedIds
  : routesPayload.routes
      .map((route) => route.id)
      .filter((id) => (!from || Number(id) >= Number(from)) && (!to || Number(id) <= Number(to)));
const manifest = await readJson(CAPTURE_MANIFEST_PATH, {
  schemaVersion: 1,
  parserVersion: PARSER_VERSION,
  updatedAt: null,
  records: {},
});

async function captureCard(id, index) {
  const route = routesById.get(id);
  if (!route) throw new Error(`Route not found for card ${id}`);
  const rawPath = resolve(RAW_ROOT, `${id}.html.gz`);
  if (!force && manifest.records[id]?.status === "captured") {
    try {
      await access(rawPath);
      console.log(`[${index + 1}/${selected.length}] ${id} cached`);
      return;
    } catch {
      // Missing cached files are recaptured.
    }
  }

  try {
    const response = await fetchWithRetry(route.url, { retries: 2, timeoutMs: 20_000 });
    const html = await response.text();
    const parsed = parseCardPage(html);
    if (parsed.focusCard.id !== id) throw new Error(`Expected ${id}, page contains ${parsed.focusCard.id}`);
    const capturedAt = new Date().toISOString();
    const contentHash = sha256(html);
    await writeGzip(rawPath, html);
    manifest.records[id] = {
      id,
      url: route.url,
      status: "captured",
      capturedAt,
      contentHash,
      compressedPath: `raw/${id}.html.gz`,
      bytes: Buffer.byteLength(html),
    };
    console.log(`[${index + 1}/${selected.length}] ${id} captured`);
  } catch (error) {
    manifest.records[id] = {
      id,
      url: route.url,
      status: "failed",
      capturedAt: new Date().toISOString(),
      error: String(error),
    };
    console.error(`[${index + 1}/${selected.length}] ${id} FAILED: ${error}`);
  }
}

for (let offset = 0; offset < selected.length; offset += concurrency) {
  const batch = selected.slice(offset, offset + concurrency);
  await Promise.all(batch.map((id, batchIndex) => captureCard(id, offset + batchIndex)));
  manifest.updatedAt = new Date().toISOString();
  await writeJson(CAPTURE_MANIFEST_PATH, manifest);
}

manifest.updatedAt = new Date().toISOString();
await writeJson(CAPTURE_MANIFEST_PATH, manifest);
const failures = selected.filter((id) => manifest.records[id]?.status !== "captured");
if (failures.length) throw new Error(`${failures.length} captures failed: ${failures.join(", ")}`);
console.log(`Captured ${selected.length} card pages.`);
