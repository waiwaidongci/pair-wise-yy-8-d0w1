// 批次判定：缸位占用、换水间隔、霉点/水位过低整批暂停、待处理换水等纯业务规则

export const STAGES = ["入缸", "发酵中", "可抄纸", "异常观察", "已结束"];
export const ENDED = "已结束";
// 换水最小间隔：不足则申请停在“待处理”
export const MIN_WATER_CHANGE_HOURS = 48;
// 水位低于该厘米数判为“水位过低”
export const LOW_WATER_CM = 10;
const HOUR_MS = 3600 * 1000;

export function nowIso() {
  return new Date().toISOString();
}
export function uid(prefix) {
  return prefix + Date.now() + Math.floor(100 + Math.random() * 900);
}
function fail(code, message) {
  const error = new Error(message);
  error.domain = true;
  error.code = code;
  return error;
}
function str(value) {
  return String(value ?? "").trim();
}
function numOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function asBool(value) {
  return value === true || value === 1 || value === "1" || value === "on" || value === "true" || value === "是";
}

export function isActive(batch) {
  return batch.status !== ENDED;
}
export function findVat(batch, name) {
  return (batch.vats || []).find((v) => v.name === name);
}
// 同一口缸不能留在两个未结束批次
export function vatBusyIn(batches, name, excludeId = null) {
  return batches.find((b) => b.id !== excludeId && isActive(b) && findVat(b, name));
}

// 以每口缸最新一条观察回算当前状态
export function recomputeVat(vat) {
  const last = (vat.observations || []).at(-1);
  if (last) {
    if (last.temperature !== null && last.temperature !== undefined) vat.temperature = last.temperature;
    if (last.waterLevel !== null && last.waterLevel !== undefined) vat.waterLevel = last.waterLevel;
    vat.mold = !!last.mold;
    vat.lowWater = last.waterLevel !== null && last.waterLevel < LOW_WATER_CM;
  }
  return vat;
}
// 任一缸霉点或水位过低，整批暂停换水
export function recomputeBatch(batch) {
  (batch.vats || []).forEach(recomputeVat);
  const reasons = [];
  for (const vat of batch.vats || []) {
    if (vat.mold) reasons.push(vat.name + " 出现霉点");
    if (vat.lowWater) reasons.push(vat.name + " 水位过低");
  }
  batch.waterChangePaused = reasons.length > 0;
  batch.pauseReasons = reasons;
  return batch;
}

function normalizeVat(row) {
  const name = str(row?.name);
  const waterLevel = numOrNull(row?.waterLevel);
  return {
    name,
    waterLevel,
    temperature: numOrNull(row?.temperature),
    lastWaterChange: str(row?.lastWaterChange) || null,
    mold: false,
    lowWater: waterLevel !== null && waterLevel < LOW_WATER_CM,
    observations: []
  };
}

export function createBatch(input, batches, at = nowIso()) {
  const code = str(input.code);
  if (!code) throw fail("code_required", "批次编号必填");
  if (batches.some((b) => b.code === code)) throw fail("code_duplicate", "批次编号 " + code + " 已存在");
  const status = STAGES.includes(input.status) ? input.status : "入缸";

  const vats = [];
  const names = [];
  for (const row of Array.isArray(input.vats) ? input.vats : []) {
    const name = str(row?.name);
    if (!name) continue;
    if (names.includes(name)) throw fail("vat_duplicate", "同批内缸号重复：" + name);
    const busy = vatBusyIn(batches, name);
    if (busy) throw fail("vat_busy", name + " 仍在未结束批次 " + busy.code + " 中，不能重复建档");
    names.push(name);
    vats.push(normalizeVat(row));
  }
  if (!vats.length) throw fail("vat_required", "一批至少要登记一口缸");

  const batch = {
    id: str(input.id) || uid("PF-"),
    code,
    source: str(input.source),
    owner: str(input.owner),
    days: Number(input.days) || 0,
    status,
    createdAt: at,
    waterChangePaused: false,
    pauseReasons: [],
    vats,
    pendingWaterChanges: [],
    logs: [{ at, step: "建档", note: "建档，共 " + vats.length + " 口缸：" + names.join("、") }]
  };
  recomputeBatch(batch);
  if (batch.waterChangePaused) batch.status = "异常观察";
  return batch;
}

function applyWaterChange(batch, vat, at, step) {
  vat.lastWaterChange = at;
  batch.logs.push({ at, step, note: vat.name + " 完成换水，上次换水时间已更新" });
}

// 换水申请：整批暂停则拦下；间隔不足先停在待处理；否则直接换水
function requestWaterChange(batch, vat, at) {
  if (batch.waterChangePaused) {
    return { result: "paused", reasons: batch.pauseReasons.slice() };
  }
  const minGap = MIN_WATER_CHANGE_HOURS * HOUR_MS;
  const elapsed = vat.lastWaterChange ? Date.parse(at) - Date.parse(vat.lastWaterChange) : Infinity;
  if (elapsed < minGap) {
    const pending = {
      id: uid("PW-"),
      vat: vat.name,
      requestedAt: at,
      reason: "距上次换水不足" + MIN_WATER_CHANGE_HOURS / 24 + " 天"
    };
    batch.pendingWaterChanges.push(pending);
    batch.logs.push({ at, step: "待处理", note: vat.name + " 换水申请进入待处理（" + pending.reason + "）" });
    return { result: "pending", pending };
  }
  applyWaterChange(batch, vat, at, "换水");
  return { result: "done" };
}

// 对某一口缸追加观察；观察始终允许，换水部分按批次规则判定
export function addObservation(batch, vatName, input, at = nowIso()) {
  if (!isActive(batch)) throw fail("batch_ended", "批次已结束，不能再追加观察");
  const vat = findVat(batch, vatName);
  if (!vat) throw fail("vat_not_found", "本批没有这口缸：" + vatName);

  const waterLevel = numOrNull(input.waterLevel);
  const temperature = numOrNull(input.temperature);
  const mold = asBool(input.mold);
  const observation = { at, temperature, waterLevel, mold, note: str(input.note) };
  vat.observations.push(observation);
  recomputeBatch(batch);

  const flags = [];
  if (mold) flags.push("霉点");
  if (vat.lowWater) flags.push("水位过低");
  batch.logs.push({
    at,
    step: "观察",
    note:
      vat.name +
      " 水位" +
      (waterLevel === null ? "未填" : waterLevel + "cm") +
      "，温度" +
      (temperature === null ? "未填" : temperature + "℃") +
      (flags.length ? "，" + flags.join("、") : "")
  });

  batch.days = (Number(batch.days) || 0) + 1;
  if (batch.waterChangePaused) batch.status = "异常观察";
  else if (batch.days >= 7) batch.status = "可抄纸";
  else if (batch.status === "入缸") batch.status = "发酵中";

  let waterChange = { result: "skipped" };
  if (asBool(input.changeWater)) waterChange = requestWaterChange(batch, vat, at);
  return { observation, waterChange };
}

// 处理待处理换水：execute 时仍要重新过暂停与间隔判定
export function decidePending(batch, pendingId, decision, at = nowIso()) {
  const idx = (batch.pendingWaterChanges || []).findIndex((p) => p.id === pendingId);
  if (idx < 0) throw fail("pending_not_found", "待处理记录不存在或已处理");
  const pending = batch.pendingWaterChanges[idx];

  if (decision === "cancel") {
    batch.pendingWaterChanges.splice(idx, 1);
    batch.logs.push({ at, step: "待处理", note: pending.vat + " 的换水申请已取消" });
    return { result: "cancelled" };
  }
  if (decision !== "execute") throw fail("bad_decision", "操作只能是 execute 或 cancel");
  if (!isActive(batch)) throw fail("batch_ended", "批次已结束，不能再换水");

  recomputeBatch(batch);
  if (batch.waterChangePaused) {
    throw fail("paused", "整批暂停换水：" + batch.pauseReasons.join("、"));
  }
  const vat = findVat(batch, pending.vat);
  if (!vat) throw fail("vat_not_found", "本批没有这口缸：" + pending.vat);

  const minGap = MIN_WATER_CHANGE_HOURS * HOUR_MS;
  const elapsed = vat.lastWaterChange ? Date.parse(at) - Date.parse(vat.lastWaterChange) : Infinity;
  if (elapsed < minGap) {
    batch.logs.push({ at, step: "待处理", note: pending.vat + " 换水间隔仍不足，继续停在待处理" });
    throw fail("interval_short", pending.vat + pending.reason + "，继续停在待处理");
  }
  applyWaterChange(batch, vat, at, "待处理换水");
  batch.pendingWaterChanges.splice(idx, 1);
  return { result: "done" };
}

export function endBatch(batch, at = nowIso()) {
  if (!isActive(batch)) return batch;
  batch.status = ENDED;
  for (const pending of batch.pendingWaterChanges.splice(0)) {
    batch.logs.push({ at, step: "待处理", note: pending.vat + " 的换水申请随批次结束作废" });
  }
  batch.logs.push({ at, step: "结束", note: "批次结束，缸位释放" });
  return batch;
}

export function patchBatch(batch, patch = {}, at = nowIso()) {
  if (patch.status !== undefined) {
    if (!STAGES.includes(patch.status)) throw fail("bad_status", "未知状态：" + patch.status);
    if (patch.status === ENDED) return endBatch(batch, at);
    if (batch.status !== patch.status) {
      batch.status = patch.status;
      batch.logs.push({ at, step: "状态", note: "更新为 " + patch.status });
    }
  }
  for (const key of ["source", "owner"]) {
    if (patch[key] !== undefined) batch[key] = str(patch[key]);
  }
  if (patch.days !== undefined && Number.isFinite(Number(patch.days))) batch.days = Number(patch.days);
  return batch;
}

export function summarizeBatch(batch) {
  recomputeBatch(batch);
  return {
    ...batch,
    vatCount: (batch.vats || []).length,
    pendingCount: (batch.pendingWaterChanges || []).length,
    alertVatCount: (batch.vats || []).filter((v) => v.mold || v.lowWater).length
  };
}

export function computeStats(batches) {
  const stats = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let activeVats = 0;
  let pausedBatches = 0;
  let pendingChanges = 0;
  let alertVats = 0;
  for (const batch of batches) {
    if (stats[batch.status] !== undefined) stats[batch.status] += 1;
    if (isActive(batch)) {
      activeVats += (batch.vats || []).length;
      if (batch.waterChangePaused) pausedBatches += 1;
      pendingChanges += (batch.pendingWaterChanges || []).length;
    }
    alertVats += (batch.vats || []).filter((v) => v.mold || v.lowWater).length;
  }
  return { ...stats, 在管缸位: activeVats, 暂停换水批次: pausedBatches, 待处理换水: pendingChanges, 异常缸位: alertVats };
}
