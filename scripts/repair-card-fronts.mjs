import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_SOURCES_PATH = path.join(ROOT, "assets", "data", "image-sources.json");
const CARD_DATA_PATH = path.join(ROOT, "app", "data", "cards.json");
const ASSET_CARD_DIR = path.join(ROOT, "assets", "cards");
const PUBLIC_CARD_DIR = path.join(ROOT, "public", "cards");
const STAGING_DIR = path.join(ROOT, "tmp", "card-front-replacement");
const AUDIT_PATH = path.join(ROOT, "assets", "data", "card-front-replacement-audit.json");
const FUSION_CARD_ROOT = "https://fusion.lukadevv.com/assets/cards/full";
const BACK_MARKER = "/Back-FMR-";
const CONCURRENCY = 10;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function webpDimensions(buffer) {
  if (
    buffer.length < 30
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("Arquivo recebido não é um WebP RIFF válido.");
  }

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) throw new Error("Cabeçalho VP8L inválido.");
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8 ") {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
      throw new Error("Cabeçalho VP8 inválido.");
    }
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  throw new Error(`Codec WebP não reconhecido: ${chunk}`);
}

function isReplacementEntry(entry) {
  return entry.source.includes(BACK_MARKER) || entry.originalSource?.includes(BACK_MARKER);
}

async function downloadCard(card, previousSource) {
  const source = `${FUSION_CARD_ROOT}/${card.id}.webp`;
  const response = await fetch(source, {
    headers: {
      accept: "image/webp,image/*;q=0.8,*/*;q=0.5",
      "user-agent": "YuGiOh-FM-Card-Archive/1.0 (local restoration audit)",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${card.id}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("image/webp")) {
    throw new Error(`MIME inesperado para ${card.id}: ${contentType || "ausente"}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const dimensions = webpDimensions(buffer);
  const ratio = dimensions.width / dimensions.height;
  if (buffer.length < 4_000) throw new Error(`Arquivo muito pequeno para ${card.id}: ${buffer.length} bytes.`);
  if (dimensions.width < 120 || dimensions.height < 170 || ratio < 0.65 || ratio > 0.78) {
    throw new Error(`Dimensões suspeitas para ${card.id}: ${dimensions.width}x${dimensions.height}.`);
  }

  const destination = path.join(STAGING_DIR, `${card.id}.webp`);
  await writeFile(destination, buffer);
  return {
    id: card.id,
    name: card.name,
    source,
    originalSource: previousSource,
    bytes: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    sha256: sha256(buffer),
    stagingPath: destination,
  };
}

async function concurrentMap(items, worker, limit) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  const publish = process.argv.includes("--publish");
  const imageSources = JSON.parse(await readFile(IMAGE_SOURCES_PATH, "utf8"));
  const cardArchive = JSON.parse(await readFile(CARD_DATA_PATH, "utf8"));
  const cardById = new Map(cardArchive.cards.map((card) => [card.id, card]));
  const targets = Object.entries(imageSources)
    .filter(([, entry]) => isReplacementEntry(entry))
    .map(([id, entry]) => ({
      card: cardById.get(id),
      entry,
    }))
    .sort((first, second) => first.card.id.localeCompare(second.card.id));

  if (targets.some(({ card }) => !card)) throw new Error("Há IDs de imagem sem carta correspondente.");
  if (targets.length !== 104) {
    throw new Error(`Auditoria esperava 104 substituições e encontrou ${targets.length}.`);
  }

  await mkdir(STAGING_DIR, { recursive: true });
  const replacements = await concurrentMap(
    targets,
    ({ card, entry }) => downloadCard(card, entry.originalSource ?? entry.source),
    CONCURRENCY,
  );

  const hashes = new Set(replacements.map((item) => item.sha256));
  if (hashes.size !== replacements.length) {
    throw new Error(`Foram detectadas imagens duplicadas: ${replacements.length - hashes.size}.`);
  }

  if (publish) {
    await mkdir(ASSET_CARD_DIR, { recursive: true });
    await mkdir(PUBLIC_CARD_DIR, { recursive: true });
    for (const replacement of replacements) {
      const filename = `${replacement.id}.webp`;
      await copyFile(replacement.stagingPath, path.join(ASSET_CARD_DIR, filename));
      await copyFile(replacement.stagingPath, path.join(PUBLIC_CARD_DIR, filename));
      imageSources[replacement.id] = {
        source: replacement.source,
        local: `/cards/${filename}`,
        originalSource: replacement.originalSource,
        replacementReason: "fandom-gallery-returned-card-back",
      };
    }
    await writeFile(IMAGE_SOURCES_PATH, `${JSON.stringify(imageSources, null, 2)}\n`, "utf8");
  }

  const audit = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    published: publish,
    expected: 104,
    downloaded: replacements.length,
    uniqueHashes: hashes.size,
    source: FUSION_CARD_ROOT,
    replacements: replacements.map((replacement) => {
      const item = { ...replacement };
      delete item.stagingPath;
      return item;
    }),
  };
  await writeFile(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(`Validated ${replacements.length} unique card fronts.${publish ? " Published to assets and public." : " Staging only."}`);
  console.log(`Audit: ${path.relative(ROOT, AUDIT_PATH)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
