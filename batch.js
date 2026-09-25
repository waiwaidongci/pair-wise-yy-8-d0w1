// 批次判定：纸浆发酵批次的业务规则。
// 纯内存运算，不碰文件存储和 HTTP，server.js 只负责把请求转成这里的调用。

export const STAGES = ["入缸", "待处理", "发酵中", "异常观察", "可抄纸", "已结束"];
// 未结束批次才占用缸位；“已结束”后缸位释放，可以进新批次
export const OPEN_STAGES = ["入缸", "待处理", "发酵中", "异常观察", "可抄纸"];
export const MIN_WATER_CHANGE_HOURS = 24; // 距上次换水不足该间隔，先停在待处理
export const LOW_WATER_LEVEL = 30; // 水位（百分比）低于该值视为水位过低
export const READY_DAYS = 7; // 发酵天数达到后判定为可抄纸

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isUnfinished(batch) {
  return batch && !batch.finished && batch.status !== "已结束";
}

function nowIso() {
  return new Date().toISOString();
}

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function stageByDays(days) {
  return Number(days) >= READY_DAYS ? "可抄纸" : "发酵中";
}

function addLog(batch, step, note, abnormal = false) {
  (batch.logs ||= []).push({ at: nowIso(), step, note, abnormal });
}

function newId() {
  return "PF-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

function numOrKeep(value, current) {
  if (value === "" || value === null || value === undefined) return current;
  const n = Number(value);
  return Number.isNaN(n) ? current : n;
}

// 观察记录里“有霉点”的判定：只看显式选择/标志，不扫备注
// （备注常写“霉点已清理”之类，按字面匹配会误伤）
export function detectMold(input = {}) {
  const flag = String(input.mold ?? "").trim();
  if (!flag) return false;
  if (/^(无|没有|无霉|没霉|0|false|normal)$/i.test(flag)) return false;
  if (/^(有|是|1|true)$/i.test(flag)) return true;
  return /霉/.test(flag) && !/无霉|没霉|已清|清除|去除|没有/.test(flag);
}

export function findBatch(db, ref) {
  return (db.items || []).find((b) => b.id === ref || b.code === ref) || null;
}

export function getVat(batch, name) {
  return (batch.vats || []).find((v) => v.name === name) || null;
}

// 同一口缸不能留在两个未结束批次：返回 缸名 -> 占用批次编号
export function findVatConflicts(db, names, excludeId = null) {
  const occupied = new Map();
  for (const batch of db.items || []) {
    if (!isUnfinished(batch) || batch.id === excludeId) continue;
    for (const vat of batch.vats || []) {
      if (names.includes(vat.name) && !occupied.has(vat.name)) {
        occupied.set(vat.name, batch.code);
      }
    }
  }
  return occupied;
}

// 兼容旧表单：vats 数组，或单个 vat 字符串
export function normalizeVats(input, legacyVat) {
  let rows;
  if (Array.isArray(input)) rows = input;
  else if (typeof input === "string" && input.trim()) rows = [{ name: input }];
  else if (legacyVat) rows = [{ name: legacyVat }];
  else rows = [];
  return rows.map((v) => ({
    name: String(v.name ?? v.vat ?? "").trim(),
    waterLevel: v.waterLevel === "" || v.waterLevel == null ? null : Number(v.waterLevel),
    temperature: v.temperature === "" || v.temperature == null ? null : Number(v.temperature),
    lastWaterChange: v.lastWaterChange || null,
    mold: false,
  }));
}

// 建档：一批可带多口缸
export function createBatch(db, input = {}) {
  const code = String(input.code || "").trim();
  if (!code) throw new DomainError("code_required", "批次编号必填");
  const vats = normalizeVats(input.vats, input.vat);
  if (vats.length === 0) throw new DomainError("vat_required", "每批至少要有一口缸");
  const names = vats.map((v) => v.name);
  if (names.some((n) => !n)) throw new DomainError("vat_required", "缸号不能为空");
  const duplicated = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicated) throw new DomainError("vat_duplicated", `同一批里缸号重复：${duplicated}`, { vat: duplicated });

  const occupied = findVatConflicts(db, names);
  if (occupied.size) {
    throw new DomainError(
      "vat_occupied",
      "有缸已在其他未结束批次中：" + [...occupied].map(([vat, c]) => `${vat}（${c}）`).join("、"),
      { occupied: [...occupied].map(([vat, batch]) => ({ vat, batch })) }
    );
  }

  const batch = {
    id: newId(),
    code,
    source: String(input.source || "").trim(),
    owner: String(input.owner || "").trim(),
    days: Number(input.days) >= 0 ? Number(input.days) : 0,
    status: OPEN_STAGES.includes(input.status) ? input.status : "入缸",
    finished: false,
    waterChangePaused: false, // 某口缸霉点/水位过低时整批暂停换水
    pauseReason: "",
    vats,
    pendingWaterChanges: [], // 间隔不足、停在待处理的换水申请
    logs: [],
    observations: [], // 兼容旧数据
    vatObservations: [],
    createdAt: nowIso(),
  };
  addLog(batch, "建档", `创建纸浆批次，共 ${vats.length} 口缸：${names.join("、")}`);
  (db.items ||= []).unshift(batch);
  return batch;
}

// 每缸观察：任何时候都能追加（整批暂停换水也不影响观察）
export function appendObservation(db, ref, input = {}) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  if (!isUnfinished(batch)) throw new DomainError("batch_finished", "批次已结束，不能再追加记录");

  const name = String(input.vat ?? "").trim();
  const vat = getVat(batch, name);
  if (!vat) throw new DomainError("vat_not_found", `本批没有「${name}」这口缸`, { vat: name });

  const at = input.at || nowIso();
  vat.waterLevel = numOrKeep(input.waterLevel, vat.waterLevel);
  vat.temperature = numOrKeep(input.temperature, vat.temperature);
  if (vat.waterLevel !== null && Number.isNaN(vat.waterLevel)) vat.waterLevel = null;
  if (vat.temperature !== null && Number.isNaN(vat.temperature)) vat.temperature = null;

  const mold = detectMold(input);
  vat.mold = mold;
  const low = vat.waterLevel !== null && vat.waterLevel < LOW_WATER_LEVEL;

  let issue = "";
  if (mold) issue = "霉点";
  else if (low) issue = `水位过低（${vat.waterLevel}%）`;

  const record = {
    at,
    vat: vat.name,
    waterLevel: vat.waterLevel,
    temperature: vat.temperature,
    mold,
    note: String(input.note ?? ""),
    abnormal: Boolean(issue),
  };
  (batch.vatObservations ||= []).push(record);
  (batch.observations ||= []).push(record);
  batch.days = Number(batch.days || 0) + 1;

  if (issue) {
    // 某口缸霉点或水位过低：整批暂停换水
    batch.waterChangePaused = true;
    batch.pauseReason = `${vat.name}出现${issue}`;
    batch.status = "异常观察";
    addLog(batch, "异常", `${vat.name}出现${issue}，整批暂停换水`, true);
  } else {
    // 观察照常追加；非暂停、非待处理时才按天数回推发酵阶段
    if (!batch.waterChangePaused && batch.status !== "待处理") batch.status = stageByDays(batch.days);
    const note = `${vat.name}：温度${vat.temperature ?? "未记"}，水位${vat.waterLevel ?? "未记"}%` +
      (input.note ? `，${input.note}` : "");
    addLog(batch, "观察", note);
  }
  return { batch, vat, record, issue, paused: batch.waterChangePaused };
}

function performWaterChange(batch, vat, at, step = "换水") {
  vat.lastWaterChange = at.toISOString();
  batch.pendingWaterChanges = (batch.pendingWaterChanges || []).filter((p) => p.vat !== vat.name);
  addLog(batch, step, `${vat.name}完成换水，上次换水时间已更新`);
  if (batch.status === "待处理" && !(batch.pendingWaterChanges || []).length) {
    batch.status = batch.waterChangePaused ? "异常观察" : stageByDays(batch.days);
  }
  return { batch, changed: true, vat: vat.name, at: vat.lastWaterChange };
}

// 申请换水：整批暂停则拒绝；间隔不足则停在待处理，不更新上次换水时间
export function requestWaterChange(db, ref, input = {}) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  if (!isUnfinished(batch)) throw new DomainError("batch_finished", "批次已结束，不能再换水");

  const name = String(input.vat ?? "").trim();
  const vat = getVat(batch, name);
  if (!vat) throw new DomainError("vat_not_found", `本批没有「${name}」这口缸`, { vat: name });

  if (batch.waterChangePaused) {
    throw new DomainError("water_change_paused", `整批暂停换水：${batch.pauseReason || "有缸出现霉点或水位过低"}`, {
      reason: batch.pauseReason,
    });
  }

  const at = input.at ? new Date(input.at) : new Date();
  const last = toTime(vat.lastWaterChange);
  if (last !== null) {
    const elapsedHours = (at.getTime() - last) / 36e5;
    if (elapsedHours < MIN_WATER_CHANGE_HOURS) {
      const pending = {
        vat: vat.name,
        reason: "换水间隔不足",
        requestedAt: at.toISOString(),
        earliestAt: new Date(last + MIN_WATER_CHANGE_HOURS * 36e5).toISOString(),
      };
      batch.pendingWaterChanges = (batch.pendingWaterChanges || []).filter((p) => p.vat !== vat.name);
      batch.pendingWaterChanges.push(pending);
      batch.status = "待处理";
      addLog(
        batch,
        "待处理",
        `${vat.name}距上次换水仅 ${elapsedHours.toFixed(1)} 小时（不足 ${MIN_WATER_CHANGE_HOURS} 小时），先停在待处理`
      );
      return { batch, held: true, pending, waitHours: Number((MIN_WATER_CHANGE_HOURS - elapsedHours).toFixed(1)) };
    }
  }
  return performWaterChange(batch, vat, at);
}

// 重试待处理换水：到点才执行，仍没到点继续待处理
export function retryPendingWaterChange(db, ref, input = {}) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  if (!isUnfinished(batch)) throw new DomainError("batch_finished", "批次已结束");
  const vat = getVat(batch, String(input.vat ?? "").trim());
  if (!vat) throw new DomainError("vat_not_found", `本批没有「${input.vat}」这口缸`, { vat: input.vat });
  if (batch.waterChangePaused) {
    throw new DomainError("water_change_paused", `整批暂停换水：${batch.pauseReason || ""}`, { reason: batch.pauseReason });
  }
  const pending = (batch.pendingWaterChanges || []).find((p) => p.vat === vat.name);
  if (!pending) return requestWaterChange(db, ref, input);

  const at = input.at ? new Date(input.at) : new Date();
  const earliest = toTime(pending.earliestAt);
  if (earliest !== null && earliest > at.getTime()) {
    return {
      batch,
      held: true,
      pending,
      waitHours: Number(((earliest - at.getTime()) / 36e5).toFixed(1)),
    };
  }
  return performWaterChange(batch, vat, at, "重试换水");
}

// 异常解除后恢复整批换水：所有缸都无霉点且水位达标才允许
export function resumeWaterChanges(db, ref, input = {}) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  if (!isUnfinished(batch)) throw new DomainError("batch_finished", "批次已结束");
  if (!batch.waterChangePaused) throw new DomainError("not_paused", "该批次当前没有暂停换水");

  const unresolved = (batch.vats || [])
    .filter((v) => v.mold || (v.waterLevel !== null && v.waterLevel < LOW_WATER_LEVEL))
    .map((v) => v.name);
  if (unresolved.length) {
    throw new DomainError("issue_unresolved", `以下缸的霉点或低水位还没解除：${unresolved.join("、")}`, { vats: unresolved });
  }

  batch.waterChangePaused = false;
  batch.pauseReason = "";
  batch.vats.forEach((v) => (v.mold = false));
  if ((batch.pendingWaterChanges || []).length) batch.status = "待处理";
  else if (batch.status === "异常观察") batch.status = stageByDays(batch.days);
  addLog(batch, "恢复换水", input.note || "异常已处理，恢复整批换水");
  return { batch, resumed: true };
}

// 结束批次：释放缸位，同一批缸可以进入新批次
export function finishBatch(db, ref) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  if (!isUnfinished(batch)) throw new DomainError("batch_finished", "批次已结束");
  batch.finished = true;
  batch.status = "已结束";
  addLog(batch, "结束", "批次结束，缸位已释放");
  return { batch, finished: true };
}

// 兼容原有 PATCH：改状态（选“已结束”同样释放缸位）及少量字段
export function updateBatch(db, ref, patch = {}) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  if (patch.status !== undefined) {
    if (!STAGES.includes(patch.status)) throw new DomainError("invalid_status", `未知状态：${patch.status}`);
    batch.status = patch.status;
    batch.finished = patch.status === "已结束";
    addLog(batch, "状态", `更新为${patch.status}`);
  }
  for (const key of ["source", "owner"]) {
    if (patch[key] !== undefined) batch[key] = String(patch[key]);
  }
  if (patch.days !== undefined && !Number.isNaN(Number(patch.days))) batch.days = Number(patch.days);
  return batch;
}

export function appendLog(db, ref, input = {}) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  addLog(batch, input.step || "备注", String(input.note || ""));
  return batch;
}

// 兼容旧版“每日观察记录”表单：一条 action 追加观察，并按是否换水走换水判定
export function recordLegacyAction(db, ref, input = {}) {
  const batch = findBatch(db, ref);
  if (!batch) throw new DomainError("not_found", "批次不存在");
  const vatName = input.vat || batch.vats?.[0]?.name || "";
  const noteParts = [input.smell && `气味${input.smell}`, input.fiber && `纤维${input.fiber}`].filter(Boolean);
  const observation = appendObservation(db, ref, {
    vat: vatName,
    temperature: input.temperature,
    waterLevel: input.waterLevel,
    mold: detectMold(input),
    note: noteParts.join("，"),
    at: input.at,
  });
  let water = null;
  if (/是|有|true/i.test(String(input.changedWater ?? ""))) {
    try {
      water = requestWaterChange(db, ref, { vat: vatName, at: input.at });
    } catch (error) {
      if (error.code === "water_change_paused") water = { blocked: true, reason: error.message };
      else throw error;
    }
  }
  return { batch: observation.batch, observation, water };
}

// 列表摘要：附带每缸距上次换水小时数、缸数等，供页面直接渲染
export function summarize(batch) {
  const now = Date.now();
  const vats = (batch.vats || []).map((v) => {
    const t = toTime(v.lastWaterChange);
    return { ...v, hoursSinceChange: t === null ? null : Math.round(((now - t) / 36e5) * 10) / 10 };
  });
  return {
    ...batch,
    vats,
    vat: vats.map((v) => v.name).join("、"), // 兼容旧字段
    vatCount: vats.length,
    vatNames: vats.map((v) => v.name),
    pendingCount: (batch.pendingWaterChanges || []).length,
    logCount: (batch.logs || []).length,
  };
}

// 统计：沿用原来按状态计数，再补缸位、暂停、待处理等批次视角数据
export function computeStats(items) {
  const stats = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let vatCount = 0;
  let paused = 0;
  let pending = 0;
  let open = 0;
  for (const batch of items) {
    if (stats[batch.status] !== undefined) stats[batch.status] += 1;
    if (isUnfinished(batch)) open += 1;
    if (batch.waterChangePaused) paused += 1;
    pending += (batch.pendingWaterChanges || []).length;
    vatCount += (batch.vats || []).length;
  }
  return { ...stats, 未结束批次: open, 缸位总数: vatCount, 暂停换水批次: paused, 待处理换水: pending };
}
