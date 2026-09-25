// 文件存储：批次数据落盘 data/paper-pulp-fermentation.json，并把旧版“一条一口缸”记录迁移成批次

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso, recomputeBatch, uid } from "./batch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "paper-pulp-fermentation.json");

const seed = {
  batches: [
    {
      id: "PF-SEED01",
      code: "PF-2026-01",
      source: "构树皮",
      owner: "林素",
      days: 3,
      status: "发酵中",
      createdAt: "2026-09-20T08:00:00.000Z",
      waterChangePaused: false,
      pauseReasons: [],
      vats: [
        {
          name: "三号缸",
          waterLevel: 22,
          temperature: 24.6,
          lastWaterChange: "2026-09-23T08:00:00.000Z",
          mold: false,
          lowWater: false,
          observations: [
            { at: "2026-09-23T08:00:00.000Z", temperature: 24.6, waterLevel: 22, mold: false, note: "气味微酸，纤维开始松散" }
          ]
        },
        {
          name: "五号缸",
          waterLevel: 8,
          temperature: 26.1,
          lastWaterChange: "2026-09-22T08:00:00.000Z",
          mold: false,
          lowWater: true,
          observations: [
            { at: "2026-09-24T08:00:00.000Z", temperature: 26.1, waterLevel: 8, mold: false, note: "蒸发较快，需要关注水位" }
          ]
        }
      ],
      pendingWaterChanges: [],
      logs: [{ at: "2026-09-20T08:00:00.000Z", step: "建档", note: "建档，共 2 口缸：三号缸、五号缸" }]
    }
  ]
};

// 旧版单缸记录 -> 一个批次带一口缸
function migrateLegacyItem(item) {
  const at = nowIso();
  const observations = (item.observations || []).map((o) => ({
    at: o.at || at,
    temperature: Number(o.temperature) || null,
    waterLevel: null,
    mold: !!o.abnormal,
    note: [o.smell, o.fiber].filter(Boolean).join("，"),
    changedWater: o.changedWater || ""
  }));
  const last = observations.at(-1);
  const lastChanged = [...observations].reverse().find((o) => String(o.changedWater).includes("是"));
  const batch = {
    id: item.id || uid("PF-"),
    code: item.code || uid("PF-"),
    source: item.source || "",
    owner: item.owner || "",
    days: Number(item.days) || 0,
    status: item.status || "入缸",
    createdAt: at,
    waterChangePaused: false,
    pauseReasons: [],
    vats: [
      {
        name: item.vat || "未命名缸",
        waterLevel: null,
        temperature: last?.temperature ?? null,
        lastWaterChange: lastChanged ? lastChanged.at : null,
        mold: false,
        lowWater: false,
        observations: observations.map(({ changedWater, ...rest }) => rest)
      }
    ],
    pendingWaterChanges: [],
    logs: (item.logs || []).map((l) => ({ at: l.at || at, step: l.step || "记录", note: l.note || "" }))
  };
  batch.logs.unshift({ at, step: "迁移", note: "旧版单缸记录迁移为批次（一口缸）" });
  return recomputeBatch(batch);
}

function normalizeDb(raw) {
  if (Array.isArray(raw.batches)) {
    raw.batches.forEach(recomputeBatch);
    return raw;
  }
  // v0：{ items: [...] }
  const batches = Array.isArray(raw.items) ? raw.items.map(migrateLegacyItem) : [];
  return { batches };
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return seed;
  }
  const raw = JSON.parse(await readFile(dbPath, "utf8"));
  const db = normalizeDb(raw);
  return db;
}

export async function saveDb(db) {
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export async function withDb(fn) {
  const db = await loadDb();
  const result = await fn(db);
  await saveDb(db);
  return result;
}
