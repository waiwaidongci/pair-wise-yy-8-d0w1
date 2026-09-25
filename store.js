// 文件存储：data/paper-pulp-fermentation.json 的读写。
// 旧数据是“一口缸一条记录”（item.vat 为单个字符串），首次加载时迁移成“一批多缸”。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPEN_STAGES } from "./batch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const dbPath = join(__dirname, "data", "paper-pulp-fermentation.json");

const seed = {
  items: [
    {
      id: "PF-SEED-001",
      code: "PF-001",
      source: "构树皮",
      owner: "林素",
      days: 6,
      status: "发酵中",
      finished: false,
      waterChangePaused: false,
      pauseReason: "",
      vats: [
        {
          name: "三号缸",
          waterLevel: 72,
          temperature: 25.1,
          lastWaterChange: "2026-09-24T08:00:00.000Z",
          mold: false,
        },
        {
          name: "五号缸",
          waterLevel: 28,
          temperature: 26.4,
          lastWaterChange: "2026-09-23T08:00:00.000Z",
          mold: false,
        },
      ],
      pendingWaterChanges: [],
      logs: [
        {
          at: "2026-09-20",
          step: "建档",
          note: "创建纸浆批次，共 2 口缸：三号缸、五号缸",
          abnormal: false,
        },
        {
          at: "2026-09-24",
          step: "观察",
          note: "三号缸：温度25.1，水位72%，气味微酸，纤维开始松散",
          abnormal: false,
        },
      ],
      observations: [],
      vatObservations: [],
      createdAt: "2026-09-20T00:00:00.000Z",
    },
  ],
};

function newLegacyId(index) {
  return "PF-LEGACY-" + index + "-" + Math.random().toString(36).slice(2, 6);
}

// 旧记录 → 批次：一条旧记录包成一批一口缸
function migrateVatItem(item) {
  const name = String(item.vat ?? "").trim() || "未编号缸";
  const lastObs = [...(item.observations || [])].reverse().find((o) => /是|有|true/i.test(String(o.changedWater ?? "")));
  const mold = (item.observations || []).some((o) => /霉/.test(String(o.abnormal ?? "")) || /霉/.test(String(o.note ?? "")));
  const last = item.observations?.[item.observations.length - 1] || {};
  const waterLevel = last.waterLevel ?? null;
  const temperature = last.temperature == null ? null : Number(last.temperature);
  return {
    id: item.id || newLegacyId(Date.now()),
    code: item.code || item.id,
    source: item.source || "",
    owner: item.owner || "",
    days: Number(item.days) || 0,
    status: OPEN_STAGES.includes(item.status) ? item.status : "入缸",
    finished: false,
    waterChangePaused: item.status === "异常观察",
    pauseReason: item.status === "异常观察" ? "迁移自旧异常观察记录，请核实" : "",
    vats: [
      {
        name,
        waterLevel: waterLevel == null ? null : Number(waterLevel),
        temperature: Number.isNaN(temperature) ? null : temperature,
        lastWaterChange: lastObs?.at || null,
        mold,
      },
    ],
    pendingWaterChanges: [],
    logs: item.logs || [],
    observations: item.observations || [],
    vatObservations: (item.observations || []).map((o) => ({
      at: o.at,
      vat: name,
      waterLevel: o.waterLevel == null ? null : Number(o.waterLevel),
      temperature: o.temperature == null ? null : Number(o.temperature),
      mold: /霉/.test(String(o.abnormal ?? "")),
      note: o.note || [o.smell && `气味${o.smell}`, o.fiber && `纤维${o.fiber}`].filter(Boolean).join("，"),
      abnormal: Boolean(o.abnormal),
    })),
    createdAt: item.logs?.[0]?.at || new Date().toISOString(),
  };
}

// 迁移条件：还没有 vats 数组的旧记录
export function migrateDb(db) {
  if (!db || !Array.isArray(db.items)) return { items: [], migrated: 0 };
  let migrated = 0;
  db.items = db.items.map((item) => {
    if (Array.isArray(item.vats)) {
      item.finished ??= item.status === "已结束";
      item.waterChangePaused ??= false;
      item.pauseReason ??= "";
      item.pendingWaterChanges ??= [];
      item.vatObservations ??= [];
      return item;
    }
    migrated += 1;
    return migrateVatItem(item);
  });
  return { ...db, migrated };
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return seed;
  }
  const raw = JSON.parse(await readFile(dbPath, "utf8"));
  const db = migrateDb(raw);
  if (db.migrated > 0) await saveDb(db);
  return db;
}

export async function saveDb(db) {
  const { migrated, ...rest } = db;
  await writeFile(dbPath, JSON.stringify(rest, null, 2));
}
