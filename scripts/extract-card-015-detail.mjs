import { readFile, writeFile } from "node:fs/promises";

const flightScriptsPath = new URL(
  "../tmp/card015-source/next-flight-scripts-complete.json",
  import.meta.url,
);
const outputPath = new URL("../app/data/card-015-detail.json", import.meta.url);

function extractBalanced(source, startIndex) {
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

const rawScripts = JSON.parse(await readFile(flightScriptsPath, "utf8"));
const flightPayload = rawScripts
  .map((script) => {
    const match = script.match(/^self\.__next_f\.push\((.*)\)$/s);
    return match ? JSON.parse(match[1])[1] ?? "" : "";
  })
  .join("");

const focusMarker = '"focusCard":';
const focusStart = flightPayload.indexOf("{", flightPayload.indexOf(focusMarker));
const focusCard = JSON.parse(extractBalanced(flightPayload, focusStart));

const staticMarker = '"staticProps":';
const staticStart = flightPayload.indexOf("{", flightPayload.indexOf(staticMarker));
const staticProps = JSON.parse(extractBalanced(flightPayload, staticStart));

const uniqueRecipes = new Map();
for (const [first, second] of staticProps.recipe) {
  const ids = [first.id, second.id].sort((a, b) => Number(a) - Number(b));
  uniqueRecipes.set(ids.join("+"), ids);
}

const fusions = [];
const equips = [];
for (const [ingredient, result] of staticProps.cardFusions) {
  if (ingredient.cardType === "EQUIP") {
    equips.push({ equip: ingredient.id, boost: ingredient.modificationValue ?? 0 });
  } else {
    fusions.push({ partner: ingredient.id, result: result.id });
  }
}

const detail = {
  source: "https://fusion.lukadevv.com/cards/flame-swordsman",
  extractedAt: "2026-07-22",
  cardId: focusCard.id,
  description: focusCard.description,
  field: {
    name: "MEADOW",
    gameName: "SOGEN",
    sprite: {
      image: "/game-assets/fusion/cards.webp",
      width: 48,
      height: 48,
      backgroundSize: "1248px 1344px",
      backgroundPosition: "-816px -288px",
    },
  },
  guardianStars: [
    { name: "MARS", strongAgainst: "JUPITER", weakAgainst: "NEPTUNE" },
    { name: "SUN", strongAgainst: "MOON", weakAgainst: "MERCURY" },
  ],
  video: {
    source: staticProps.videoAsset.path,
    localPath: "/game-assets/models/015.webm",
    width: staticProps.videoAsset.width,
    height: staticProps.videoAsset.height,
    objectPosition: "50% 48%",
  },
  counts: {
    recipes: uniqueRecipes.size,
    fusions: fusions.length,
    equips: equips.length,
  },
  recipes: [...uniqueRecipes.values()].map(([left, right]) => ({ left, right })),
  fusions,
  equips,
};

await writeFile(outputPath, `${JSON.stringify(detail, null, 2)}\n`, "utf8");
console.log(
  `Card ${detail.cardId}: ${detail.counts.recipes} recipes, ${detail.counts.fusions} fusions, ${detail.counts.equips} equips`,
);
