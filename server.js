import http from "node:http";
import { withDb } from "./store.js";
import { page } from "./page.js";
import {
  addObservation,
  computeStats,
  createBatch,
  decidePending,
  findVat,
  patchBatch,
  summarizeBatch
} from "./batch.js";

const port = Number(process.env.PORT || 3039);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
// 业务规则错误返回 422，其余 500
function handleError(res, error) {
  if (error && error.domain) return send(res, 422, { error: error.code, message: error.message });
  send(res, 500, { error: "internal_error", message: error.message });
}
function findBatch(db, key) {
  return db.batches.find((b) => b.id === key || b.code === key);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") return html(res, page());

    if (req.method === "GET" && url.pathname === "/api/batches") {
      return withDb(async (db) => send(res, 200, db.batches.map(summarizeBatch)));
    }

    if (req.method === "POST" && url.pathname === "/api/batches") {
      return withDb(async (db) => {
        const batch = createBatch(await body(req), db.batches);
        db.batches.unshift(batch);
        return send(res, 201, summarizeBatch(batch));
      }).catch((e) => handleError(res, e));
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      return withDb(async (db) => send(res, 200, computeStats(db.batches)));
    }

    const batchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
    if (batchMatch && req.method === "PATCH") {
      return withDb(async (db) => {
        const batch = findBatch(db, decodeURIComponent(batchMatch[1]));
        if (!batch) return send(res, 404, { error: "batch_not_found", message: "批次不存在" });
        patchBatch(batch, await body(req));
        return send(res, 200, summarizeBatch(batch));
      }).catch((e) => handleError(res, e));
    }

    const obsMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/vats\/([^/]+)\/observations$/);
    if (obsMatch && req.method === "POST") {
      return withDb(async (db) => {
        const batch = findBatch(db, decodeURIComponent(obsMatch[1]));
        if (!batch) return send(res, 404, { error: "batch_not_found", message: "批次不存在" });
        const vatName = decodeURIComponent(obsMatch[2]);
        if (!findVat(batch, vatName)) return send(res, 404, { error: "vat_not_found", message: "本批没有这口缸：" + vatName });
        const out = addObservation(batch, vatName, await body(req));
        return send(res, 201, { ...out, batchId: batch.id, vatName, batch: summarizeBatch(batch) });
      }).catch((e) => handleError(res, e));
    }

    const pendingMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/pending\/([^/]+)$/);
    if (pendingMatch && req.method === "POST") {
      return withDb(async (db) => {
        const batch = findBatch(db, decodeURIComponent(pendingMatch[1]));
        if (!batch) return send(res, 404, { error: "batch_not_found", message: "批次不存在" });
        const input = await body(req);
        decidePending(batch, decodeURIComponent(pendingMatch[2]), input.decision);
        return send(res, 200, summarizeBatch(batch));
      }).catch((e) => handleError(res, e));
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    handleError(res, error);
  }
});

server.listen(port, () => console.log("古法纸浆发酵批次管理 listening on http://localhost:" + port));
