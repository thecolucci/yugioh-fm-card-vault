import { resolve } from "node:path";
import {
  CAPTURE_MANIFEST_PATH,
  RAW_ROOT,
  ROUTES_PATH,
  STAGING_ROOT,
  buildDetailV2,
  getCliValue,
  loadCoreCards,
  parseIds,
  readGzip,
  readJson,
  writeJson,
} from "./lib/fusion-pipeline.mjs";

const routePayload = await readJson(ROUTES_PATH);
const captureManifest = await readJson(CAPTURE_MANIFEST_PATH);
const coreCards = await loadCoreCards();
const routeById = new Map(routePayload.routes.map((route) => [route.id, route]));
const coreById = new Map(coreCards.map((card) => [card.id, card]));
const requestedIds = parseIds(getCliValue("--ids"));
const selected = requestedIds.length
  ? requestedIds
  : Object.values(captureManifest.records)
      .filter((record) => record.status === "captured")
      .map((record) => record.id)
      .sort();

for (const [index, id] of selected.entries()) {
  const record = captureManifest.records[id];
  if (!record || record.status !== "captured") throw new Error(`Card ${id} has no valid capture`);
  const route = routeById.get(id);
  const coreCard = coreById.get(id);
  if (!route || !coreCard) throw new Error(`Missing route/core data for ${id}`);
  const html = await readGzip(resolve(RAW_ROOT, `${id}.html.gz`));
  const detail = buildDetailV2({
    html,
    route,
    coreCard,
    capturedAt: record.capturedAt,
    contentHash: record.contentHash,
  });
  await writeJson(resolve(STAGING_ROOT, `${id}.json`), detail);
  console.log(
    `[${index + 1}/${selected.length}] ${id}: ${detail.counts.recipes} recipes, ${detail.counts.fusions} fusions, ${detail.counts.equips} equips, ${detail.inGameMedia.kind}`,
  );
}

console.log(`Normalized ${selected.length} card details.`);
