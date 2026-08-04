import {
  FUSION_ORIGIN,
  PARSER_VERSION,
  ROUTES_PATH,
  extractSitemapCardUrls,
  fetchWithRetry,
  loadCoreCards,
  normalizeText,
  writeJson,
} from "./lib/fusion-pipeline.mjs";

const coreCards = await loadCoreCards();
const response = await fetchWithRetry(`${FUSION_ORIGIN}/sitemap.xml`);
const xml = await response.text();
const urls = extractSitemapCardUrls(xml);
const routes = urls.map((url, index) => {
  const core = coreCards[index];
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  return { id: core.id, name: core.name, slug, path: `/cards/${slug}`, url };
});

if (urls.length !== 722) throw new Error(`Expected 722 routes, extracted ${urls.length}`);
const ids = new Set(routes.map((route) => route.id));
if (ids.size !== 722) throw new Error(`Expected 722 unique route IDs, extracted ${ids.size}`);

const warnings = routes
  .filter((route) => normalizeText(route.name) !== normalizeText(route.slug))
  .map((route) => ({ id: route.id, coreName: route.name, slug: route.slug }));

await writeJson(ROUTES_PATH, {
  schemaVersion: 1,
  parserVersion: PARSER_VERSION,
  generatedAt: new Date().toISOString(),
  source: `${FUSION_ORIGIN}/sitemap.xml`,
  count: routes.length,
  warnings,
  routes,
});

console.log(`Mapped ${routes.length} card routes (${warnings.length} normalized name warnings).`);
