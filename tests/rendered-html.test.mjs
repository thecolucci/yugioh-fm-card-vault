import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("server-renders the Forbidden Memories Card Book", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const output = await response.text();
  const packageJson = await readJson("../package.json");
  assert.match(output, /<title>Yu-Gi-Oh! FM — Card Vault<\/title>/i);
  assert.ok(output.includes(`v${packageJson.version}`));
  assert.match(output, /CARD BOOK/);
  assert.match(output, /Blue Eyes White Dragon/);
  assert.match(output, /89631139/);
  assert.match(output, /icon_starchip\.png/);
  assert.match(output, /icon_password\.png/);
  assert.match(output, /VANTAGEM EM CAMPO/);
  assert.match(output, /aria-label="Ataque m/);
  assert.match(output, /aria-label="Defesa m/);
  assert.match(output, /placeholder="ATK máx\."/);
  assert.match(output, /placeholder="Custo máximo"/);
  assert.doesNotMatch(output, /MINI CARD DATABASE|YFM \/\/ VISUAL INDEX|catalog-topline|archive-footer/);
});

test("publishes an audited schema-v2 archive across every card class", async () => {
  const archive = await readJson("../app/data/cards.json");
  const manifest = await readJson("../app/data/card-details-manifest.json");
  const pilotIds = ["001", "002", "015", "016", "301", "320", "330", "665", "681", "701", "722"];

  assert.equal(archive.cards.length, 722);
  assert.equal(new Set(archive.cards.map((card) => card.id)).size, 722);
  assert.deepEqual(manifest.ids, archive.cards.map((card) => card.id));
  const publishedFiles = (await readdir(new URL("../public/data/card-details/", import.meta.url)))
    .filter((name) => /^\d{3}\.json$/.test(name))
    .sort();
  assert.equal(publishedFiles.length, 722);
  assert.deepEqual(publishedFiles, manifest.ids.map((id) => `${id}.json`));
  assert.equal(manifest.cards["015"].fieldGameName, "SOGEN");
  assert.equal(manifest.cards["301"].fieldGameName, null);
  const fieldAdvantageCounts = Object.values(manifest.cards).reduce((counts, card) => {
    if (card.fieldGameName) counts[card.fieldGameName] = (counts[card.fieldGameName] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(fieldAdvantageCounts, {
    MOUNTAIN: 69,
    YAMI: 151,
    FOREST: 113,
    WASTELAND: 67,
    SOGEN: 73,
    UMI: 136,
  });

  const knownIds = new Set(archive.cards.map((card) => card.id));
  const details = new Map();
  for (const id of pilotIds) {
    const detail = await readJson(`../public/data/card-details/${id}.json`);
    details.set(id, detail);
    assert.equal(detail.schemaVersion, 2);
    assert.equal(detail.cardId, id);
    assert.equal(detail.counts.recipes, detail.recipes.length);
    assert.equal(detail.counts.fusions, detail.fusions.length);
    assert.equal(detail.counts.equips, detail.equips.length);
    for (const recipe of detail.recipes) assert.ok(knownIds.has(recipe.left) && knownIds.has(recipe.right));
    for (const fusion of detail.fusions) assert.ok(knownIds.has(fusion.partner) && knownIds.has(fusion.result));
    for (const equip of detail.equips) assert.ok(knownIds.has(equip.partner) && knownIds.has(equip.result));
  }

  const blueEyes = details.get("001");
  assert.deepEqual(blueEyes.counts, { recipes: 0, fusions: 0, equips: 3 });
  assert.equal(blueEyes.inGameMedia.kind, "model-video");

  const flameSwordsman = details.get("015");
  assert.deepEqual(flameSwordsman.counts, { recipes: 767, fusions: 131, equips: 7 });
  assert.deepEqual(flameSwordsman.guardianStars, ["MARS", "SUN"]);
  assert.deepEqual(flameSwordsman.field, { cardId: "333", name: "MEADOW", gameName: "SOGEN" });
  assert.equal(new Set(flameSwordsman.recipes.map(({ left, right }) => [left, right].sort().join("+"))).size, 767);

  const timeWizard = details.get("016");
  assert.deepEqual(timeWizard.counts, { recipes: 0, fusions: 71, equips: 5 });
  assert.deepEqual(timeWizard.guardianStars, ["VENUS", "SUN"]);
  assert.equal(timeWizard.field.cardId, "335");

  const legendarySword = details.get("301");
  assert.equal(legendarySword.cardType, "Equip");
  assert.equal(legendarySword.counts.equips, 63);
  assert.equal(legendarySword.field, null);
  assert.equal(legendarySword.inGameMedia.kind, "animated-fallback");

  for (const id of ["301", "320", "330", "665", "681"]) {
    assert.equal(details.get(id).inGameMedia.localPath, "/game-assets/non-video-cards.gif");
  }
  assert.deepEqual(details.get("701").guardianStars, ["SUN", "SATURN"]);
  assert.equal(details.get("722").cardId, "722");
  const reptile = await readJson("../public/data/card-details/051.json");
  assert.equal(reptile.cardType, "Monster");
  assert.equal(reptile.field, null);
  assert.equal(reptile.guardianStars.length, 2);
  const ritual = await readJson("../public/data/card-details/721.json");
  assert.equal(ritual.inGameMedia.kind, "animated-fallback");
});

test("Card Book loads details lazily and supports both local media modes", async () => {
  const stylesheet = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../app/components/CardDetailOverlay.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const sourceCards = await readdir(new URL("../assets/cards/", import.meta.url));
  const publicCards = await readdir(new URL("../public/cards/", import.meta.url));
  const publishedDetails = await readdir(new URL("../public/data/card-details/", import.meta.url));
  const publishedModels = await readdir(new URL("../public/game-assets/models/", import.meta.url));

  assert.equal(sourceCards.filter((name) => name.endsWith(".webp")).length, 722);
  assert.equal(publicCards.filter((name) => name.endsWith(".webp")).length, 722);
  assert.equal(publishedDetails.filter((name) => /^\d{3}\.json$/.test(name)).length, 722);
  assert.equal(publishedModels.filter((name) => /^\d{3}\.webm$/.test(name)).length, 621);
  assert.match(page, /card-details-manifest\.json/);
  assert.match(page, /fetch\(entry\.path/);
  assert.match(page, /detailCacheRef/);
  assert.match(page, /function FieldFilterSprite/);
  assert.match(page, /fieldAdvantage === "all"/);
  assert.match(page, /card\.attack >= minimumAttack/);
  assert.match(page, /card\.defense >= minimumDefense/);
  assert.match(page, /setDetailView\(\{ card, data \}\)/);
  assert.doesNotMatch(page, /DETAIL_CARD_IDS/);
  assert.doesNotMatch(overlay, /card-015-detail|card-016-detail|detailDataByCardId/);
  assert.match(overlay, /detailData\.inGameMedia\.kind === "model-video"/);
  assert.match(overlay, /className="detail-fallback-media"/);
  assert.match(overlay, /NonMonsterSideData/);
  assert.match(overlay, /function FieldSpriteIcon/);
  assert.match(overlay, /SATURN:\s*\{ x: 136, y: 170 \}/);
  assert.match(overlay, /URANUS:\s*\{ x: 34, y: 187 \}/);
  assert.match(overlay, /URANUS: "⛢"/);
  assert.match(overlay, /FIELD_BACKGROUND_BY_NAME/);
  assert.match(overlay, /--detail-field-background/);
  assert.doesNotMatch(overlay, /game-assets\/backgrounds\/meadow_shrine/);
  assert.match(overlay, /event\.key === "ArrowLeft"/);
  assert.match(overlay, /event\.key === "ArrowRight"/);
  assert.match(overlay, /const relationsPerPage = isMobileDetail \? 4 : RELATIONS_PER_PAGE/);
  assert.match(stylesheet, /detail-card-image-shine-cycle 7\.7s linear 3s infinite/);
  assert.match(stylesheet, /\.detail-video-panel video\s*\{[\s\S]*?width:\s*112%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*contain;[\s\S]*?transform:\s*translate\(-50%, -50%\);/);
  assert.match(stylesheet, /\.detail-video-panel \.detail-fallback-media/);
  assert.match(stylesheet, /\.detail-non-monster-data/);
  assert.match(stylesheet, /\.detail-field-sprite/);
  assert.match(stylesheet, /\.field-advantage-grid/);
  assert.match(stylesheet, /\.field-advantage-grid button\.active\s*\{[\s\S]*?field-advantage-selected-pulse 2\.15s ease-in-out infinite/);
  assert.match(stylesheet, /@keyframes field-advantage-selected-pulse/);
  assert.match(stylesheet, /\.stat-range-stack/);
  assert.match(stylesheet, /var\(--detail-field-background/);
  assert.match(stylesheet, /\/\* Mobile application review \*\//);
  assert.match(stylesheet, /\.mobile-card-pagination/);

  await Promise.all([
    access(new URL("../public/game-assets/non-video-cards.gif", import.meta.url)),
    access(new URL("../public/game-assets/models/001.webm", import.meta.url)),
    access(new URL("../public/game-assets/models/002.webm", import.meta.url)),
    access(new URL("../public/game-assets/models/015.webm", import.meta.url)),
    access(new URL("../public/game-assets/models/016.webm", import.meta.url)),
    access(new URL("../public/game-assets/models/701.webm", import.meta.url)),
    access(new URL("../public/game-assets/models/722.webm", import.meta.url)),
    access(new URL("../public/game-assets/web-background-desktop.png", import.meta.url)),
    access(new URL("../public/game-assets/web-background-mobile.png", import.meta.url)),
    access(new URL("../public/game-assets/fusion/cards.webp", import.meta.url)),
    access(new URL("../public/game-assets/fusion/frames.webp", import.meta.url)),
    access(new URL("../public/game-assets/fusion/main.png", import.meta.url)),
    access(new URL("../public/game-assets/fields/mountain_shrine.webp", import.meta.url)),
    access(new URL("../public/game-assets/fields/dark_shrine_hall.webp", import.meta.url)),
    access(new URL("../public/game-assets/fields/forest_shrine.webp", import.meta.url)),
    access(new URL("../public/game-assets/fields/desert_shrine.webp", import.meta.url)),
    access(new URL("../public/game-assets/fields/meadow_shrine.webp", import.meta.url)),
    access(new URL("../public/game-assets/fields/chamber.webp", import.meta.url)),
  ]);
});

test("My List favorites are local, filterable, and available from card details", async () => {
  const response = await render();
  const output = await response.text();
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../app/components/CardDetailOverlay.tsx", import.meta.url), "utf8");
  const stylesheet = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(output, /role="tablist"/);
  assert.match(output, /CARD BOOK/);
  assert.match(output, /MY LIST/);
  assert.match(page, /yfm-card-book:my-list:v1/);
  assert.match(page, /window\.localStorage\.getItem\(MY_LIST_STORAGE_KEY\)/);
  assert.match(page, /window\.localStorage\.setItem\(MY_LIST_STORAGE_KEY/);
  assert.match(page, /activeLibraryTab === "my-list" \? favoriteCards : cards/);
  assert.match(page, /isFavorite=\{favoriteIdSet\.has\(detailView\.card\.id\)\}/);
  assert.match(overlay, /ADICIONAR À MY LIST/);
  assert.match(overlay, /ADICIONADO À MY LIST/);
  assert.match(overlay, /aria-pressed=\{active\}/);
  assert.match(stylesheet, /\.pixel-heart::before/);
  assert.match(stylesheet, /\.detail-favorite-button\.is-active/);
});
