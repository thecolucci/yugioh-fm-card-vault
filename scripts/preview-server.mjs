import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 3000);
const clientRoot = fileURLToPath(new URL("../dist/client/", import.meta.url)).replace(/[\\/]+$/, "");
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("preview", String(Date.now()));
let workerPromise;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function localAsset(request) {
  const url = new URL(request.url);
  const decodedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const filePath = resolve(clientRoot, decodedPath);
  if (filePath !== clientRoot && !filePath.startsWith(`${clientRoot}${sep}`)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const information = await stat(filePath);
    if (!information.isFile()) return new Response("Not found", { status: 404 });
    const content = await readFile(filePath);
    return new Response(content, {
      headers: {
        "cache-control": "no-cache",
        "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const requestUrl = new URL(incoming.url || "/", `http://${incoming.headers.host || `localhost:${port}`}`);
    const request = new Request(requestUrl, {
      method: incoming.method,
      headers: incoming.headers,
    });
    const assetResponse = await localAsset(request);
    let response = assetResponse;
    if (assetResponse.status === 404) {
      workerPromise ??= import(workerUrl.href).then((module) => module.default);
      const worker = await workerPromise;
      response = await worker.fetch(
        request,
        { ASSETS: { fetch: localAsset } },
        { waitUntil() {}, passThroughOnException() {} },
      );
    }

    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.statusCode = 500;
    outgoing.end("Preview server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Card Book preview: http://localhost:${port}/`);
});
