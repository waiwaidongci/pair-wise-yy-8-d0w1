import http from "node:http";
import { loadDb, saveDb } from "./store.js";
import { renderPage } from "./page.js";
import {
  appendLog,
  appendObservation,
  computeStats,
  createBatch,
  DomainError,
  finishBatch,
  recordLegacyAction,
  requestWaterChange,
  resumeWaterChanges,
  retryPendingWaterChange,
  summarize,
  updateBatch,
} from "./batch.js";

const port = Number(process.env.PORT || 3039);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
// 业务错误码 → HTTP 状态
const errorStatus = {
  code_required: 400,
  vat_required: 400,
  vat_duplicated: 400,
  vat_occupied: 409,
  vat_not_found: 404,
  not_found: 404,
  batch_finished: 409,
  water_change_paused: 409,
  issue_unresolved: 409,
  invalid_status: 400,
  not_paused: 409,
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage());
    }

    // ---------- 批次管理接口 ----------
    if (req.method === "GET" && url.pathname === "/api/batches") {
      return send(res, 200, db.items.map(summarize));
    }
    if (req.method === "POST" && url.pathname === "/api/batches") {
      const batch = createBatch(db, await body(req));
      await saveDb(db);
      return send(res, 201, summarize(batch));
    }

    const obs = url.pathname.match(/^\/api\/batches\/([^/]+)\/vats\/observation$/);
    if (obs && req.method === "POST") {
      const result = appendObservation(db, decodeURIComponent(obs[1]), await body(req));
      await saveDb(db);
      return send(res, 201, { ...result, batch: summarize(result.batch) });
    }
    const water = url.pathname.match(/^\/api\/batches\/([^/]+)\/vats\/water-change$/);
    if (water && req.method === "POST") {
      const result = requestWaterChange(db, decodeURIComponent(water[1]), await body(req));
      await saveDb(db);
      return send(res, 201, { ...result, batch: summarize(result.batch) });
    }
    const retry = url.pathname.match(/^\/api\/batches\/([^/]+)\/vats\/retry$/);
    if (retry && req.method === "POST") {
      const result = retryPendingWaterChange(db, decodeURIComponent(retry[1]), await body(req));
      await saveDb(db);
      return send(res, 200, { ...result, batch: summarize(result.batch) });
    }
    const resume = url.pathname.match(/^\/api\/batches\/([^/]+)\/resume$/);
    if (resume && req.method === "POST") {
      const result = resumeWaterChanges(db, decodeURIComponent(resume[1]), await body(req));
      await saveDb(db);
      return send(res, 200, { ...result, batch: summarize(result.batch) });
    }
    const finish = url.pathname.match(/^\/api\/batches\/([^/]+)\/finish$/);
    if (finish && req.method === "POST") {
      const result = finishBatch(db, decodeURIComponent(finish[1]));
      await saveDb(db);
      return send(res, 200, { ...result, batch: summarize(result.batch) });
    }

    // ---------- 原有接口（建档、筛选/列表、统计、改状态、备注、每日观察）继续可用 ----------
    if (req.method === "GET" && url.pathname === "/api/items") {
      return send(res, 200, db.items.map(summarize));
    }
    if (req.method === "POST" && url.pathname === "/api/items") {
      const batch = createBatch(db, await body(req));
      await saveDb(db);
      return send(res, 201, batch);
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const batch = updateBatch(db, decodeURIComponent(patch[1]), await body(req));
      await saveDb(db);
      return send(res, 200, batch);
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const batch = appendLog(db, decodeURIComponent(log[1]), await body(req));
      await saveDb(db);
      return send(res, 201, batch);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const result = recordLegacyAction(db, decodeURIComponent(action[1]), await body(req));
      await saveDb(db);
      return send(res, 201, { ...result, batch: summarize(result.batch) });
    }
    if (req.method === "GET" && url.pathname === "/api/stats") {
      return send(res, 200, computeStats(db.items));
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof DomainError) {
      return send(res, errorStatus[error.code] || 400, { error: error.code, message: error.message, details: error.details });
    }
    return send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log("古法纸浆发酵批次管理 listening on http://localhost:" + port));
