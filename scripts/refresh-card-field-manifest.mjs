import { resolve } from "node:path";
import { PUBLIC_DETAIL_ROOT, ROOT, readJson, writeJson } from "./lib/fusion-pipeline.mjs";

const manifestPath = resolve(ROOT, "app", "data", "card-details-manifest.json");
const manifest = await readJson(manifestPath);
const cards = {};

for (const id of manifest.ids) {
  const detail = await readJson(resolve(PUBLIC_DETAIL_ROOT, `${id}.json`));
  cards[id] = {
    ...manifest.cards[id],
    fieldGameName: detail.field?.gameName ?? null,
  };
}

const refreshedManifest = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  cards,
};

await writeJson(manifestPath, refreshedManifest);
await writeJson(resolve(PUBLIC_DETAIL_ROOT, "manifest.json"), refreshedManifest);
console.log(`Field affinity indexed for ${manifest.ids.length} cards.`);
