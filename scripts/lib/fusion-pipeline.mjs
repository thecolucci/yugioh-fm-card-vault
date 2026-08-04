import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FUSION_SOURCE_ROOT = resolve(ROOT, "assets", "sources", "fusion");
export const RAW_ROOT = resolve(FUSION_SOURCE_ROOT, "raw");
export const REPORT_ROOT = resolve(FUSION_SOURCE_ROOT, "reports");
export const STAGING_ROOT = resolve(ROOT, "assets", "data", "card-details");
export const PUBLIC_DETAIL_ROOT = resolve(ROOT, "public", "data", "card-details");
export const PUBLIC_MODEL_ROOT = resolve(ROOT, "public", "game-assets", "models");
export const ROUTES_PATH = resolve(FUSION_SOURCE_ROOT, "routes.json");
export const CAPTURE_MANIFEST_PATH = resolve(FUSION_SOURCE_ROOT, "capture-manifest.json");
export const CORE_CARDS_PATH = resolve(ROOT, "app", "data", "cards.json");
export const PARSER_VERSION = "2.0.0";
export const SCHEMA_VERSION = 2;
export const FUSION_ORIGIN = "https://fusion.lukadevv.com";
export const FALLBACK_MEDIA_PATH = "/game-assets/non-video-cards.gif";

export const FIELD_BY_DISPLAY_NAME = {
  forest: { cardId: "330", displayName: "FOREST", gameName: "FOREST" },
  wasteland: { cardId: "331", displayName: "WASTELAND", gameName: "WASTELAND" },
  mountain: { cardId: "332", displayName: "MOUNTAIN", gameName: "MOUNTAIN" },
  meadow: { cardId: "333", displayName: "MEADOW", gameName: "SOGEN" },
  sea: { cardId: "334", displayName: "SEA", gameName: "UMI" },
  dark: { cardId: "335", displayName: "DARK", gameName: "YAMI" },
};

export const GUARDIAN_RELATIONS = {
  SUN: { strongAgainst: "MOON", weakAgainst: "MERCURY" },
  MOON: { strongAgainst: "VENUS", weakAgainst: "SUN" },
  VENUS: { strongAgainst: "MERCURY", weakAgainst: "MOON" },
  MERCURY: { strongAgainst: "SUN", weakAgainst: "VENUS" },
  MARS: { strongAgainst: "JUPITER", weakAgainst: "NEPTUNE" },
  JUPITER: { strongAgainst: "SATURN", weakAgainst: "MARS" },
  SATURN: { strongAgainst: "URANUS", weakAgainst: "JUPITER" },
  URANUS: { strongAgainst: "PLUTO", weakAgainst: "SATURN" },
  PLUTO: { strongAgainst: "NEPTUNE", weakAgainst: "URANUS" },
  NEPTUNE: { strongAgainst: "MARS", weakAgainst: "PLUTO" },
};

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function parseIds(value) {
  if (!value) return [];
  return [...new Set(value.split(",").map((id) => id.trim().padStart(3, "0")))].sort();
}

export function getCliValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

export async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (fallback !== null && error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  await ensureParent(path);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeGzip(path, value) {
  await ensureParent(path);
  await writeFile(path, await gzipAsync(Buffer.from(value, "utf8"), { level: 9 }));
}

export async function readGzip(path) {
  return (await gunzipAsync(await readFile(path))).toString("utf8");
}

export async function loadCoreCards() {
  const payload = await readJson(CORE_CARDS_PATH);
  return payload.cards;
}

export function extractBalanced(source, startIndex) {
  const opening = source[startIndex];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  throw new Error(`Unbalanced payload at ${startIndex}`);
}

export function extractFlightPayload(html) {
  const chunks = [];
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const source = match[1].trim();
    const pushIndex = source.indexOf("self.__next_f.push(");
    if (pushIndex < 0) continue;
    const start = source.indexOf("(", pushIndex) + 1;
    const end = source.lastIndexOf(")");
    if (start <= 0 || end <= start) continue;
    try {
      const decoded = JSON.parse(source.slice(start, end));
      if (typeof decoded?.[1] === "string") chunks.push(decoded[1]);
    } catch {
      // Non-data Next scripts are intentionally ignored.
    }
  }
  if (!chunks.length) throw new Error("No Next Flight payload found");
  return chunks.join("");
}

export function extractMarkedObject(payload, marker) {
  const markerIndex = payload.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Marker not found: ${marker}`);
  const start = payload.indexOf("{", markerIndex + marker.length);
  if (start < 0) throw new Error(`Object not found after marker: ${marker}`);
  return JSON.parse(extractBalanced(payload, start));
}

export function parseCardPage(html) {
  const payload = extractFlightPayload(html);
  const focusCard = extractMarkedObject(payload, '"focusCard":');
  const staticProps = extractMarkedObject(payload, '"staticProps":');
  const fieldMatch = html.match(
    />\s*field\s*<\/p>[\s\S]{0,1200}?<p[^>]*>\s*(forest|wasteland|mountain|meadow|sea|dark)\s*<\/p>/i,
  );
  return {
    focusCard,
    staticProps,
    fieldDisplayName: fieldMatch?.[1]?.toLowerCase() ?? null,
  };
}

export function extractCardRoutes(html) {
  const payload = extractFlightPayload(html);
  const routes = new Map();
  const pattern = /"text":"#(\d{3})\s+([^"]+)","url":"(\/cards\/[^"]+)"/g;
  for (const match of payload.matchAll(pattern)) {
    routes.set(match[1], {
      id: match[1],
      name: match[2],
      slug: match[3].split("/").filter(Boolean).at(-1),
      path: match[3],
      url: new URL(match[3], FUSION_ORIGIN).href,
    });
  }
  return [...routes.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

export function extractSitemapCardUrls(xml) {
  return [...xml.matchAll(/<loc>(https:\/\/fusion\.lukadevv\.com\/cards\/[^<]+)<\/loc>/g)]
    .map((match) => match[1]);
}

export async function fetchWithRetry(url, { retries = 3, timeoutMs = 45_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "YuGiOh-FM-Card-Archive/2.0 (local fan project)",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 900));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Could not fetch ${url}: ${lastError}`);
}

export function isWebm(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0x1a
    && buffer[1] === 0x45
    && buffer[2] === 0xdf
    && buffer[3] === 0xa3;
}

export function cardTypeFromUpstream(value) {
  const types = { MONSTER: "Monster", EQUIP: "Equip", MAGIC: "Magic", FIELD: "Field", RITUAL: "Ritual", TRAP: "Trap" };
  return types[value] ?? value;
}

export function relationKey(relation) {
  return `${relation.partner}->${relation.result}`;
}

export function recipeKey(recipe) {
  return [recipe.left, recipe.right].sort().join("+");
}

export function buildDetailV2({ html, route, coreCard, capturedAt, contentHash }) {
  const { focusCard, staticProps, fieldDisplayName } = parseCardPage(html);
  const recipesByKey = new Map();
  for (const pair of staticProps.recipe ?? []) {
    const ids = [pair?.[0]?.id, pair?.[1]?.id].filter(Boolean).sort();
    if (ids.length === 2) recipesByKey.set(ids.join("+"), { left: ids[0], right: ids[1] });
  }

  const fusionsByKey = new Map();
  for (const pair of focusCard.fusions ?? []) {
    if (!pair?.[0] || !pair?.[1]) continue;
    const relation = { partner: pair[0], result: pair[1] };
    fusionsByKey.set(relationKey(relation), relation);
  }

  const equipsByKey = new Map();
  for (const pair of staticProps.cardFusions ?? []) {
    const ingredient = pair?.[0];
    const result = pair?.[1];
    if (!ingredient?.id || !result?.id) continue;

    if (focusCard.cardType === "MONSTER" && ingredient.cardType === "EQUIP" && result.id === focusCard.id) {
      const relation = { partner: ingredient.id, result: focusCard.id, boost: ingredient.modificationValue ?? 0 };
      equipsByKey.set(`${relation.partner}->${relation.result}`, relation);
    } else if (
      focusCard.cardType === "EQUIP"
      && ingredient.cardType === "MONSTER"
      && ingredient.id === result.id
    ) {
      const relation = {
        partner: ingredient.id,
        result: result.id,
        boost: focusCard.modificationValue ?? 0,
      };
      equipsByKey.set(`${relation.partner}->${relation.result}`, relation);
    }
  }

  const field = fieldDisplayName ? FIELD_BY_DISPLAY_NAME[fieldDisplayName] ?? null : null;
  const guardians = Array.isArray(focusCard.guardians)
    ? focusCard.guardians.filter((name) => typeof name === "string" && name !== "$undefined")
    : [];
  const videoAsset = staticProps.videoAsset && staticProps.videoAsset !== "$undefined"
    ? staticProps.videoAsset
    : null;
  const recipes = [...recipesByKey.values()];
  const fusions = [...fusionsByKey.values()];
  const equips = [...equipsByKey.values()];

  return {
    schemaVersion: SCHEMA_VERSION,
    parserVersion: PARSER_VERSION,
    source: {
      url: route.url,
      capturedAt,
      contentHash,
      upstreamName: focusCard.name,
      upstreamCardType: focusCard.cardType,
    },
    cardId: focusCard.id,
    cardType: coreCard.cardType,
    description: focusCard.description ?? "",
    field: field ? { cardId: field.cardId, name: field.displayName, gameName: field.gameName } : null,
    guardianStars: guardians,
    inGameMedia: videoAsset?.path
      ? {
          kind: "model-video",
          status: "available",
          sourcePath: videoAsset.path,
          localPath: `/game-assets/models/${focusCard.id}.webm`,
          width: videoAsset.width ?? null,
          height: videoAsset.height ?? null,
          objectPosition: focusCard.id === "015" ? "50% 48%" : "50% 50%",
        }
      : {
          kind: "animated-fallback",
          status: "temporary",
          sourcePath: null,
          localPath: FALLBACK_MEDIA_PATH,
          width: 512,
          height: 512,
          objectPosition: "50% 50%",
        },
    counts: { recipes: recipes.length, fusions: fusions.length, equips: equips.length },
    recipes,
    fusions,
    equips,
  };
}
