import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import {
  GUARDIAN_RELATIONS,
  PUBLIC_DETAIL_ROOT,
  RAW_ROOT,
  STAGING_ROOT,
  loadCoreCards,
  readJson,
} from "./lib/fusion-pipeline.mjs";

const gunzipAsync = promisify(gunzip);
const validGuardians = new Set(Object.keys(GUARDIAN_RELATIONS));
const cards = await loadCoreCards();
const errors = [];
const distribution = Object.fromEntries([...validGuardians].map((name) => [name, 0]));

for (const [name, relation] of Object.entries(GUARDIAN_RELATIONS)) {
  if (GUARDIAN_RELATIONS[relation.strongAgainst]?.weakAgainst !== name) {
    errors.push(`${name}: strong/weak relation is not reciprocal`);
  }
  if (GUARDIAN_RELATIONS[relation.weakAgainst]?.strongAgainst !== name) {
    errors.push(`${name}: weak/strong relation is not reciprocal`);
  }
}

for (const card of cards) {
  const staged = await readJson(resolve(STAGING_ROOT, `${card.id}.json`));
  const published = await readJson(resolve(PUBLIC_DETAIL_ROOT, `${card.id}.json`));
  const stagedGuardians = staged.guardianStars ?? [];
  const publishedGuardians = published.guardianStars ?? [];

  if (JSON.stringify(stagedGuardians) !== JSON.stringify(publishedGuardians)) {
    errors.push(`${card.id}: staged and published Guardian Stars differ`);
  }

  if (card.cardType !== "Monster") {
    if (stagedGuardians.length) errors.push(`${card.id}: non-monster card has Guardian Stars`);
    continue;
  }

  const raw = (await gunzipAsync(await readFile(resolve(RAW_ROOT, `${card.id}.html.gz`)))).toString("utf8");
  const rawMatch = raw.match(/\\"guardians\\":\[(.*?)\]/);
  const rawGuardians = rawMatch ? [...rawMatch[1].matchAll(/\\"([A-Z]+)\\"/g)].map((match) => match[1]) : [];

  if (JSON.stringify(rawGuardians) !== JSON.stringify(stagedGuardians)) {
    errors.push(`${card.id}: raw ${rawGuardians.join("/")} differs from normalized ${stagedGuardians.join("/")}`);
  }
  if (stagedGuardians.length !== 2) errors.push(`${card.id}: expected two Guardian Stars`);
  if (new Set(stagedGuardians).size !== stagedGuardians.length) errors.push(`${card.id}: duplicated Guardian Star`);
  for (const guardian of stagedGuardians) {
    if (!validGuardians.has(guardian)) errors.push(`${card.id}: unknown Guardian Star ${guardian}`);
    else distribution[guardian] += 1;
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ auditedCards: cards.length, errors: 0, distribution }, null, 2));
}
