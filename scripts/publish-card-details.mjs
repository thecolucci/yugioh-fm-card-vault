import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FUSION_ORIGIN,
  PUBLIC_DETAIL_ROOT,
  PUBLIC_MODEL_ROOT,
  REPORT_ROOT,
  ROOT,
  STAGING_ROOT,
  fetchWithRetry,
  getCliValue,
  isWebm,
  parseIds,
  readJson,
  sha256,
  writeJson,
} from "./lib/fusion-pipeline.mjs";

const requestedIds = parseIds(getCliValue("--ids"));
if (process.argv.includes("--all")) {
  const allCards = await readJson(resolve(ROOT, "app", "data", "cards.json"));
  requestedIds.push(...allCards.cards.map((card) => card.id));
}
if (!requestedIds.length) throw new Error("Use --ids or --all with the approved cards to publish");
const reportPrefix = requestedIds.length === 722 ? "full" : "pilot";
const concurrency = Math.max(1, Math.min(24, Number(getCliValue("--concurrency", "6")) || 6));
const audit = await readJson(resolve(REPORT_ROOT, `${reportPrefix}-data-audit.json`));
const approved = requestedIds.filter((id) => audit.cards?.[id]?.status === "approved");
if (approved.length !== requestedIds.length) {
  const blocked = requestedIds.filter((id) => !approved.includes(id));
  throw new Error(`Publication blocked by audit for: ${blocked.join(", ")}`);
}

await mkdir(PUBLIC_DETAIL_ROOT, { recursive: true });
await mkdir(PUBLIC_MODEL_ROOT, { recursive: true });
const fallbackSource = resolve(ROOT, "assets", "non-video-cards.gif");
const fallbackTarget = resolve(ROOT, "public", "game-assets", "non-video-cards.gif");
await copyFile(fallbackSource, fallbackTarget);
const assets = {};

async function publishCard(id, index) {
  const sourcePath = resolve(STAGING_ROOT, `${id}.json`);
  const publicPath = resolve(PUBLIC_DETAIL_ROOT, `${id}.json`);
  const detail = await readJson(sourcePath);
  await copyFile(sourcePath, publicPath);

  if (detail.inGameMedia.kind === "model-video") {
    const modelPath = resolve(PUBLIC_MODEL_ROOT, `${id}.webm`);
    let model;
    try {
      model = await readFile(modelPath);
      if (!isWebm(model)) throw new Error("invalid cached WebM");
    } catch {
      const response = await fetchWithRetry(new URL(detail.inGameMedia.sourcePath, FUSION_ORIGIN).href);
      model = Buffer.from(await response.arrayBuffer());
      if (!isWebm(model)) throw new Error(`Downloaded model ${id} is not WebM`);
      await writeFile(modelPath, model);
    }
    assets[id] = { media: "model-video", bytes: model.length, sha256: sha256(model) };
  } else {
    const gif = await readFile(fallbackTarget);
    assets[id] = { media: "animated-fallback", bytes: gif.length, sha256: sha256(gif) };
  }
  console.log(`[${index + 1}/${approved.length}] ${id} published`);
}

for (let offset = 0; offset < approved.length; offset += concurrency) {
  const batch = approved.slice(offset, offset + concurrency);
  await Promise.all(batch.map((id, batchIndex) => publishCard(id, offset + batchIndex)));
}

const previousManifest = await readJson(resolve(ROOT, "app", "data", "card-details-manifest.json"), {
  schemaVersion: 2,
  generatedAt: null,
  ids: [],
  cards: {},
});
const cards = { ...previousManifest.cards };
for (const id of approved) {
  const detail = await readJson(resolve(STAGING_ROOT, `${id}.json`));
  cards[id] = {
    path: `/data/card-details/${id}.json`,
    cardType: detail.cardType,
    mediaKind: detail.inGameMedia.kind,
    fieldGameName: detail.field?.gameName ?? null,
  };
}
const ids = Object.keys(cards).sort((a, b) => Number(a) - Number(b));
const manifest = { schemaVersion: 2, generatedAt: new Date().toISOString(), ids, cards };
await writeJson(resolve(ROOT, "app", "data", "card-details-manifest.json"), manifest);
await writeJson(resolve(PUBLIC_DETAIL_ROOT, "manifest.json"), manifest);
await writeJson(resolve(REPORT_ROOT, `${reportPrefix}-publication.json`), {
  generatedAt: new Date().toISOString(),
  published: approved,
  assets,
  manifestCount: ids.length,
});

console.log(`Published ${approved.length} cards. Manifest now contains ${ids.length} cards.`);
