import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GUARDIAN_RELATIONS,
  REPORT_ROOT,
  SCHEMA_VERSION,
  STAGING_ROOT,
  getCliValue,
  loadCoreCards,
  normalizeText,
  parseIds,
  readJson,
  recipeKey,
  relationKey,
  writeJson,
} from "./lib/fusion-pipeline.mjs";

const coreCards = await loadCoreCards();
const coreById = new Map(coreCards.map((card) => [card.id, card]));
const requestedIds = parseIds(getCliValue("--ids"));
if (process.argv.includes("--all")) requestedIds.push(...coreCards.map((card) => card.id));
if (!requestedIds.length) throw new Error("Use --ids or --all with the cards that must be audited");
const published = process.argv.includes("--published");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: requestedIds,
  publishedAssetAudit: published,
  globalRecipeGraphStatus: requestedIds.length === 722 ? "complete" : "deferred-until-full-capture",
  summary: { requested: requestedIds.length, approved: 0, quarantined: 0, warnings: 0, errors: 0 },
  cards: {},
  globalGraph: null,
};
const detailById = new Map();

function addIssue(cardReport, level, code, message, context = null) {
  cardReport[level].push({ code, message, context });
  report.summary[level] += 1;
}

for (const id of requestedIds) {
  const cardReport = { id, status: "approved", errors: [], warnings: [], metrics: null };
  report.cards[id] = cardReport;
  const core = coreById.get(id);
  if (!core) {
    addIssue(cardReport, "errors", "CORE_CARD_MISSING", `Card ${id} is missing from cards.json`);
    cardReport.status = "quarantined";
    continue;
  }

  let detail;
  try {
    detail = await readJson(resolve(STAGING_ROOT, `${id}.json`));
  } catch (error) {
    addIssue(cardReport, "errors", "DETAIL_MISSING", String(error));
    cardReport.status = "quarantined";
    continue;
  }
  detailById.set(id, detail);

  if (detail.schemaVersion !== SCHEMA_VERSION) {
    addIssue(cardReport, "errors", "SCHEMA_VERSION", `Expected ${SCHEMA_VERSION}, got ${detail.schemaVersion}`);
  }
  if (detail.cardId !== id) addIssue(cardReport, "errors", "CARD_ID", `Expected ${id}, got ${detail.cardId}`);
  if (detail.cardType !== core.cardType) {
    addIssue(cardReport, "errors", "CARD_TYPE", `Expected ${core.cardType}, got ${detail.cardType}`);
  }
  if (!detail.description?.trim()) addIssue(cardReport, "errors", "DESCRIPTION_EMPTY", "Description is empty");
  if (normalizeText(detail.source?.upstreamName) !== normalizeText(core.name)) {
    addIssue(cardReport, "warnings", "NAME_DRIFT", "Core and upstream names differ after normalization", {
      core: core.name,
      upstream: detail.source?.upstreamName,
    });
  }

  const isMonster = core.cardType === "Monster";
  if (isMonster && detail.guardianStars.length !== 2) {
    addIssue(cardReport, "errors", "GUARDIAN_COUNT", `Monster must have 2 Guardian Stars, got ${detail.guardianStars.length}`);
  }
  if (!isMonster && detail.guardianStars.length !== 0) {
    addIssue(cardReport, "errors", "GUARDIAN_NOT_APPLICABLE", "Non-monster card must not have Guardian Stars");
  }
  if (isMonster && new Set(detail.guardianStars).size !== detail.guardianStars.length) {
    addIssue(cardReport, "errors", "GUARDIAN_DUPLICATE", "Monster Guardian Stars must be distinct");
  }
  for (const guardian of detail.guardianStars) {
    if (!GUARDIAN_RELATIONS[guardian]) addIssue(cardReport, "errors", "GUARDIAN_UNKNOWN", `Unknown Guardian Star ${guardian}`);
  }
  if (isMonster && !detail.field) {
    if (core.type === "Reptile") {
      addIssue(cardReport, "warnings", "FIELD_NOT_APPLICABLE", "Reptile has no favorable Field in Forbidden Memories");
    } else {
      addIssue(cardReport, "errors", "FIELD_MISSING", "Monster field affinity is missing");
    }
  }
  if (detail.field && !coreById.has(detail.field.cardId)) {
    addIssue(cardReport, "errors", "FIELD_CARD_MISSING", `Field card ${detail.field.cardId} does not exist`);
  }

  const media = detail.inGameMedia;
  if (!media || !["model-video", "animated-fallback"].includes(media.kind)) {
    addIssue(cardReport, "errors", "MEDIA_KIND", "Invalid in-game media descriptor");
  } else if (media.kind === "model-video" && media.status !== "available") {
    addIssue(cardReport, "errors", "VIDEO_STATUS", `Model video status must be available, got ${media.status}`);
  } else if (media.kind === "animated-fallback" && media.status !== "temporary") {
    addIssue(cardReport, "errors", "FALLBACK_STATUS", `Fallback status must be temporary, got ${media.status}`);
  }

  for (const mode of ["recipes", "fusions", "equips"]) {
    if (!Array.isArray(detail[mode])) addIssue(cardReport, "errors", "RELATION_ARRAY", `${mode} is not an array`);
    if (detail.counts?.[mode] !== detail[mode]?.length) {
      addIssue(cardReport, "errors", "COUNT_MISMATCH", `${mode}: count ${detail.counts?.[mode]} != ${detail[mode]?.length}`);
    }
  }

  const recipeKeys = new Set();
  for (const recipe of detail.recipes ?? []) {
    if (!coreById.has(recipe.left) || !coreById.has(recipe.right)) {
      addIssue(cardReport, "errors", "RECIPE_DANGLING", `Invalid recipe ${recipe.left}+${recipe.right}`);
    }
    if (Number(recipe.left) > Number(recipe.right)) {
      addIssue(cardReport, "errors", "RECIPE_NOT_CANONICAL", `Recipe ${recipe.left}+${recipe.right} is not ordered`);
    }
    const key = recipeKey(recipe);
    if (recipeKeys.has(key)) addIssue(cardReport, "errors", "RECIPE_DUPLICATE", `Duplicate recipe ${key}`);
    recipeKeys.add(key);
  }

  const fusionKeys = new Set();
  for (const fusion of detail.fusions ?? []) {
    if (!coreById.has(fusion.partner) || !coreById.has(fusion.result)) {
      addIssue(cardReport, "errors", "FUSION_DANGLING", `Invalid fusion ${id}+${fusion.partner}=${fusion.result}`);
    }
    const key = relationKey(fusion);
    if (fusionKeys.has(key)) addIssue(cardReport, "errors", "FUSION_DUPLICATE", `Duplicate fusion ${key}`);
    fusionKeys.add(key);
  }

  const equipKeys = new Set();
  for (const equip of detail.equips ?? []) {
    const partner = coreById.get(equip.partner);
    const result = coreById.get(equip.result);
    if (!partner || !result) {
      addIssue(cardReport, "errors", "EQUIP_DANGLING", `Invalid equip relation ${equip.partner}->${equip.result}`);
    }
    if (!Number.isFinite(equip.boost) || equip.boost <= 0) {
      addIssue(cardReport, "errors", "EQUIP_BOOST", `Invalid equip boost ${equip.boost}`);
    }
    if (isMonster && partner?.cardType !== "Equip") {
      addIssue(cardReport, "errors", "EQUIP_PARTNER_TYPE", `Monster equip partner ${equip.partner} is not Equip`);
    }
    if (core.cardType === "Equip" && partner?.cardType !== "Monster") {
      addIssue(cardReport, "errors", "EQUIP_TARGET_TYPE", `Equip target ${equip.partner} is not Monster`);
    }
    const key = relationKey(equip);
    if (equipKeys.has(key)) addIssue(cardReport, "errors", "EQUIP_DUPLICATE", `Duplicate equip relation ${key}`);
    equipKeys.add(key);
  }

  if (published) {
    try {
      const publicDetail = resolve("public", "data", "card-details", `${id}.json`);
      await access(publicDetail);
      const publishedDetail = await readJson(publicDetail);
      if (JSON.stringify(publishedDetail) !== JSON.stringify(detail)) {
        addIssue(cardReport, "errors", "PUBLISHED_DETAIL_DRIFT", `Published JSON differs from staging for ${id}`);
      }
      if (media.kind === "model-video") {
        const model = await readFile(resolve("public", media.localPath.replace(/^\//, "")));
        if (model.length < 4 || !model.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
          addIssue(cardReport, "errors", "WEBM_INVALID", `${media.localPath} is not a valid WebM container`);
        }
      } else {
        const gif = await readFile(resolve("public", media.localPath.replace(/^\//, "")));
        if (!gif.subarray(0, 6).toString("ascii").startsWith("GIF8")) {
          addIssue(cardReport, "errors", "GIF_INVALID", `${media.localPath} is not a valid GIF`);
        }
      }
    } catch (error) {
      addIssue(cardReport, "errors", "PUBLISHED_ASSET_MISSING", String(error));
    }
  }

  cardReport.metrics = {
    recipes: detail.recipes.length,
    fusions: detail.fusions.length,
    equips: detail.equips.length,
    media: detail.inGameMedia.kind,
  };
  if (cardReport.errors.length) cardReport.status = "quarantined";
  if (cardReport.status === "approved") report.summary.approved += 1;
  else report.summary.quarantined += 1;
}

if (requestedIds.length === coreCards.length && detailById.size === coreCards.length) {
  const graph = {
    recipesChecked: 0,
    outgoingFusionsChecked: 0,
    missingOutgoingFromRecipe: 0,
    missingRecipeFromOutgoing: 0,
  };
  const sampledIssues = new Map();
  const addGraphIssue = (id, code, message) => {
    const cardReport = report.cards[id];
    cardReport.status = "quarantined";
    const sampleKey = `${id}:${code}`;
    const sampleCount = sampledIssues.get(sampleKey) ?? 0;
    if (sampleCount < 5) addIssue(cardReport, "errors", code, message);
    sampledIssues.set(sampleKey, sampleCount + 1);
  };

  for (const [resultId, detail] of detailById) {
    for (const recipe of detail.recipes) {
      graph.recipesChecked += 1;
      for (const [sourceId, partnerId] of [[recipe.left, recipe.right], [recipe.right, recipe.left]]) {
        const source = detailById.get(sourceId);
        const found = source?.fusions.some((fusion) => fusion.partner === partnerId && fusion.result === resultId);
        if (!found) {
          graph.missingOutgoingFromRecipe += 1;
          addGraphIssue(
            resultId,
            "GRAPH_OUTGOING_MISSING",
            `Recipe ${recipe.left}+${recipe.right}=${resultId} is missing from card ${sourceId} outgoing fusions`,
          );
        }
        if (recipe.left === recipe.right) break;
      }
    }
  }

  for (const [sourceId, detail] of detailById) {
    for (const fusion of detail.fusions) {
      graph.outgoingFusionsChecked += 1;
      const result = detailById.get(fusion.result);
      const expectedRecipe = [sourceId, fusion.partner].sort().join("+");
      const found = result?.recipes.some((recipe) => recipeKey(recipe) === expectedRecipe);
      if (!found) {
        graph.missingRecipeFromOutgoing += 1;
        addGraphIssue(
          sourceId,
          "GRAPH_RECIPE_MISSING",
          `Fusion ${sourceId}+${fusion.partner}=${fusion.result} is missing from result recipes`,
        );
      }
    }
  }

  report.globalGraph = graph;
  report.globalRecipeGraphStatus = graph.missingOutgoingFromRecipe || graph.missingRecipeFromOutgoing
    ? "complete-inconsistent"
    : "complete-consistent";
  report.summary.approved = Object.values(report.cards).filter((card) => card.status === "approved").length;
  report.summary.quarantined = report.summary.requested - report.summary.approved;
}

const reportPrefix = requestedIds.length === coreCards.length ? "full" : "pilot";
const reportPath = resolve(REPORT_ROOT, published ? `${reportPrefix}-published-audit.json` : `${reportPrefix}-data-audit.json`);
await writeJson(reportPath, report);
console.log(
  `Audit: ${report.summary.approved}/${report.summary.requested} approved, ${report.summary.errors} errors, ${report.summary.warnings} warnings.`,
);
if (report.summary.errors) process.exitCode = 1;
