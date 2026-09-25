// 页面操作：建档多缸、逐缸水位/温度/换水观察、待处理换水审批、整批暂停提示、筛选与统计

import { STAGES, ENDED, MIN_WATER_CHANGE_HOURS, LOW_WATER_CM } from "./batch.js";

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法纸浆发酵批次管理</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --hold:#8a6d1f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; } main { display:grid; grid-template-columns:400px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:56px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.mini { padding:5px 9px; font-size:12px; font-weight:400; }
    button.danger { background:var(--warn); } button.hold { background:var(--hold); }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:22px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:140px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .card.ended { opacity:.62; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.paused { background:#f7e7e3; color:var(--warn); border-color:#dfb8ae; font-weight:700; }
    .vat { border:1px solid var(--line); border-radius:6px; padding:8px 10px; display:grid; gap:4px; background:#fafcf8; }
    .vat-head { display:flex; justify-content:space-between; gap:8px; align-items:center; }
    .tag { display:inline-block; border-radius:4px; padding:1px 6px; font-size:11px; margin-right:4px; background:#ecefe9; color:var(--muted); }
    .tag.warn { background:#f7e7e3; color:var(--warn); font-weight:700; }
    .pending { border:1px dashed #d8b65e; background:#fdf7e6; border-radius:6px; padding:8px 10px; display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:104px; overflow:auto; display:grid; gap:3px; }
    .warn { color:var(--warn); font-weight:700; } .hold-text { color:var(--hold); font-weight:700; }
    .vat-row { display:grid; grid-template-columns:1.2fr 1fr 1fr auto; gap:6px; align-items:center; margin-top:6px; }
    .vat-row input { padding:7px; } .vat-row .mini { white-space:nowrap; }
    .checkline { display:flex; gap:16px; margin-top:10px; } .checkline label { display:flex; gap:6px; align-items:center; margin:0; color:var(--ink); } .checkline input { width:auto; }
    #msg { margin-top:10px; font-size:13px; min-height:20px; } #msg.ok { color:var(--accent); } #msg.err { color:var(--warn); font-weight:700; }
    .card-foot { display:flex; gap:8px; align-items:center; flex-wrap:wrap; border-top:1px solid var(--line); padding-top:8px; } .card-foot select { width:auto; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法纸浆发酵批次管理</h1><div class="meta">一批多缸 · 水位温度 · 换水间隔 · 霉点/低水位整批暂停</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm" class="panel">
        <h2>新增发酵批次</h2>
        <label>批次编号</label><input name="code" required placeholder="如 PF-2026-02">
        <label>原料来源</label><input name="source" placeholder="如 构树皮">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><label>负责人</label><input name="owner"></div>
          <div><label>发酵天数</label><input name="days" type="number" value="0" min="0"></div>
        </div>
        <label>初始状态</label><select name="status">${STAGES.filter((s) => s !== ENDED).map((s) => "<option>" + s + "</option>").join("")}</select>
        <label>本批缸位（一批可带多口缸）</label>
        <div id="vatRows"></div>
        <button type="button" class="secondary mini" id="addVat" style="margin-top:8px;">+ 再加一口缸</button>
        <div style="margin-top:12px;"><button>保存批次</button></div>
      </form>
      <form id="actionForm" class="panel" style="margin-top:14px;">
        <h2>逐缸观察 / 换水</h2>
        <label>选择批次</label><select name="batchId" id="actionBatch"></select>
        <label>选择缸号</label><select name="vatName" id="actionVat"></select>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><label>水位（cm，低于 ${LOW_WATER_CM} 判过低）</label><input name="waterLevel" type="number" step="0.1"></div>
          <div><label>温度（℃）</label><input name="temperature" type="number" step="0.1"></div>
        </div>
        <div class="checkline">
          <label><input type="checkbox" name="mold"> 有霉点</label>
          <label><input type="checkbox" name="changeWater"> 本次换水</label>
        </div>
        <label>观察备注</label><textarea name="note" placeholder="气味、纤维松散度等"></textarea>
        <div style="margin-top:12px;"><button>提交记录</button></div>
        <div class="meta" style="margin-top:8px;">换水间隔不足 ${MIN_WATER_CHANGE_HOURS / 24} 天会停在待处理；整批暂停时只拦下换水，观察照常追加。</div>
        <div id="msg"></div>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option>${STAGES.map((s) => "<option>" + s + "</option>").join("")}</select>
        <select id="pauseFilter"><option value="">全部批次</option><option value="paused">仅暂停换水</option><option value="normal">仅正常换水</option></select>
        <select id="pendingFilter"><option value="">有无待处理均可</option><option value="yes">仅有待处理</option></select>
        <input id="search" placeholder="搜索编号 / 缸号 / 原料 / 负责人">
      </div>
      <div class="panel"><h2>批次总览</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const STAGES = ${JSON.stringify(STAGES)};
    const ENDED = ${JSON.stringify(ENDED)};
    const MIN_HOURS = ${MIN_WATER_CHANGE_HOURS};
    const LOW_CM = ${LOW_WATER_CM};
    let batches = [];
    const $ = (sel) => document.querySelector(sel);
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }
    function fmt(iso) { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0") + " " + String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0"); }
    function gapText(iso) {
      if (!iso) return "无换水记录";
      const h = (Date.now() - Date.parse(iso)) / 3600000;
      if (h < 0) return fmt(iso);
      if (h < 24) return Math.max(0, Math.round(h)) + " 小时前";
      return Math.floor(h / 24) + " 天前";
    }
    function isActive(b) { return b.status !== ENDED; }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? Object.assign({}, options, { headers: { "Content-Type": "application/json" } }) : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function notify(text, ok) { const el = $("#msg"); el.textContent = text; el.className = ok ? "ok" : "err"; if (ok) setTimeout(() => { el.textContent = ""; el.className = ""; }, 5000); }

    function vatRowHtml(name) {
      return '<div class="vat-row"><input name="vatName" placeholder="缸号，如 一号缸"' + (name ? ' value="' + esc(name) + '"' : "") + ' required><input name="vatLevel" type="number" step="0.1" placeholder="水位cm"><input name="vatTemp" type="number" step="0.1" placeholder="温度℃"><button type="button" class="secondary mini vat-del">移除</button></div>';
    }
    function renderVatRows() { $("#vatRows").innerHTML = vatRowHtml(); }

    function renderBatchOptions() {
      const active = batches.filter(isActive);
      $("#actionBatch").innerHTML = active.length
        ? active.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.code) + ' · ' + esc(b.source || "") + "（" + b.vats.length + " 缸）</option>").join("")
        : '<option value="">（暂无未结束批次）</option>';
      renderVatOptions();
    }
    function renderVatOptions() {
      const b = batches.find((x) => x.id === $("#actionBatch").value);
      $("#actionVat").innerHTML = b ? b.vats.map((v) => '<option value="' + encodeURIComponent(v.name) + '">' + esc(v.name) + (v.mold ? "（霉点）" : v.lowWater ? "（水位过低）" : "") + "</option>").join("") : "";
    }

    function computeStats() {
      const stats = Object.fromEntries(STAGES.map((s) => [s, 0]));
      let activeVats = 0, pausedBatches = 0, pending = 0, alertVats = 0;
      for (const b of batches) {
        if (stats[b.status] !== undefined) stats[b.status] += 1;
        if (isActive(b)) { activeVats += b.vats.length; if (b.waterChangePaused) pausedBatches += 1; pending += (b.pendingWaterChanges || []).length; }
        alertVats += b.vats.filter((v) => v.mold || v.lowWater).length;
      }
      stats["在管缸位"] = activeVats; stats["暂停换水批次"] = pausedBatches; stats["待处理换水"] = pending; stats["异常缸位"] = alertVats;
      return stats;
    }
    function renderStats() {
      const stats = computeStats();
      $("#stats").innerHTML = Object.entries(stats).map(([k, v]) => '<div class="stat"><span>' + esc(k) + "</span><strong>" + v + "</strong></div>").join("");
    }

    function vatHtml(b, v) {
      const last = (v.observations || []).at(-1);
      const tags = (v.mold ? '<span class="tag warn">霉点</span>' : "") + (v.lowWater ? '<span class="tag warn">水位过低</span>' : "");
      return '<div class="vat"><div class="vat-head"><b>' + esc(v.name) + "</b><span>" + tags + '<button type="button" class="secondary mini" data-act="observe" data-id="' + esc(b.id) + '" data-vat="' + encodeURIComponent(v.name) + '"' + (isActive(b) ? "" : " disabled") + ">追加观察</button></span></div>"
        + '<div class="meta">水位 <b class="' + (v.lowWater ? "warn" : "") + '">' + (v.waterLevel == null ? "未填" : esc(v.waterLevel) + "cm") + '</b> ｜ 温度 ' + (v.temperature == null ? "未填" : esc(v.temperature) + "℃") + " ｜ 上次换水 " + esc(gapText(v.lastWaterChange)) + (v.lastWaterChange ? "（" + fmt(v.lastWaterChange) + "）" : "") + "</div>"
        + (last && last.note ? '<div class="meta">最近观察：' + esc(last.note) + "</div>" : "");
    }
    function pendingHtml(b, p) {
      return '<div class="pending"><span><span class="hold-text">待处理</span> ' + esc(p.vat) + " 换水申请 · " + fmt(p.requestedAt) + ' · <span class="meta">' + esc(p.reason || "") + "</span></span><span>"
        + '<button type="button" class="mini" data-act="pending-ok" data-id="' + esc(b.id) + '" data-pid="' + esc(p.id) + '">执行换水</button> '
        + '<button type="button" class="secondary mini" data-act="pending-cancel" data-id="' + esc(b.id) + '" data-pid="' + esc(p.id) + '">取消</button></span></div>';
    }
    function cardHtml(b) {
      const pausePill = b.waterChangePaused ? '<span class="pill paused">整批暂停换水：' + esc((b.pauseReasons || []).join("、")) + "</span>" : '<span class="pill">换水正常</span>';
      const logs = (b.logs || []).slice(-5).map((l) => '<div><span class="meta">' + fmt(l.at) + "</span> " + esc(l.step) + "：" + esc(l.note) + "</div>").join("");
      return '<article class="card' + (isActive(b) ? "" : " ended") + '"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><h3>' + esc(b.code) + '</h3><span class="pill">' + esc(b.status) + "</span></div>"
        + '<div class="meta">' + esc(b.source || "原料未填") + " ｜ 负责人 " + esc(b.owner || "未填") + " ｜ 第 " + esc(b.days) + " 天 ｜ " + b.vats.length + " 口缸 ｜ 建档 " + fmt(b.createdAt) + "</div>"
        + pausePill
        + b.vats.map((v) => vatHtml(b, v)).join("")
        + (b.pendingWaterChanges || []).map((p) => pendingHtml(b, p)).join("")
        + '<div class="logs meta">' + (logs || "暂无记录") + "</div>"
        + '<div class="card-foot"><label style="margin:0;">状态</label><select data-status="' + esc(b.id) + '">' + STAGES.map((s) => '<option ' + (s === b.status ? "selected" : "") + ">" + s + "</option>").join("") + "</select>"
        + (isActive(b) ? '<button type="button" class="danger mini" data-act="end" data-id="' + esc(b.id) + '">结束批次（释放缸位）</button>' : '<span class="meta">缸位已释放</span>') + "</div></article>";
    }
    function renderCards() {
      const status = $("#statusFilter").value;
      const pause = $("#pauseFilter").value;
      const onlyPending = $("#pendingFilter").value === "yes";
      const q = $("#search").value.trim().toLowerCase();
      const visible = batches.filter((b) => {
        if (status && b.status !== status) return false;
        if (pause === "paused" && !b.waterChangePaused) return false;
        if (pause === "normal" && b.waterChangePaused) return false;
        if (onlyPending && !(b.pendingWaterChanges || []).length) return false;
        if (q && JSON.stringify(b).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      $("#cards").innerHTML = visible.length ? visible.map(cardHtml).join("") : '<div class="meta">没有符合条件的批次</div>';
      bindCardEvents();
    }
    function render() { renderStats(); renderBatchOptions(); renderCards(); }

    async function load() { batches = await api("/api/batches"); render(); }

    async function patchStatus(id, status) {
      if (status === ENDED && !confirm("结束后释放缸位，未完成的待处理换水将作废。确认结束？")) return false;
      await api("/api/batches/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
      return true;
    }
    function bindCardEvents() {
      document.querySelectorAll("select[data-status]").forEach((sel) => {
        sel.onchange = async () => { const ok = await patchStatus(sel.dataset.status, sel.value); if (!ok) await load(); };
      });
      document.querySelectorAll("[data-act]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          try {
            if (btn.dataset.act === "observe") {
              $("#actionBatch").value = id; renderVatOptions();
              $("#actionVat").value = btn.dataset.vat;
              $("#actionForm [name=waterLevel]").focus();
              notify("已选好批次和缸号，填好水位温度后提交即可。", true);
              return;
            }
            if (btn.dataset.act === "end") { await patchStatus(id, ENDED); return; }
            if (btn.dataset.act === "pending-ok") { await api("/api/batches/" + encodeURIComponent(id) + "/pending/" + encodeURIComponent(btn.dataset.pid), { method: "POST", body: JSON.stringify({ decision: "execute" }) }); notify("换水已执行，上次换水时间已更新。", true); await load(); return; }
            if (btn.dataset.act === "pending-cancel") { await api("/api/batches/" + encodeURIComponent(id) + "/pending/" + encodeURIComponent(btn.dataset.pid), { method: "POST", body: JSON.stringify({ decision: "cancel" }) }); notify("已取消该换水申请。", true); await load(); }
          } catch (e) { notify(e.message, false); }
        };
      });
    }

    $("#addVat").onclick = () => { $("#vatRows").insertAdjacentHTML("beforeend", vatRowHtml()); bindDel(); };
    function bindDel() {
      document.querySelectorAll(".vat-del").forEach((btn) => { btn.onclick = () => { if (document.querySelectorAll(".vat-row").length > 1) btn.closest(".vat-row").remove(); }; });
    }
    $("#createForm").onsubmit = async (event) => {
      event.preventDefault();
      const f = event.target;
      const rows = [...document.querySelectorAll(".vat-row")];
      const vats = rows.map((row) => ({
        name: row.querySelector("[name=vatName]").value.trim(),
        waterLevel: row.querySelector("[name=vatLevel]").value,
        temperature: row.querySelector("[name=vatTemp]").value
      })).filter((v) => v.name);
      if (!vats.length) return notify("至少保留一口缸并填写缸号。", false);
      try {
        await api("/api/batches", { method: "POST", body: JSON.stringify({
          code: f.code.value.trim(), source: f.source.value.trim(), owner: f.owner.value.trim(),
          days: f.days.value, status: f.status.value, vats
        }) });
        f.reset(); f.days.value = "0"; renderVatRows(); bindDel();
        notify("批次已建档。", true); await load();
      } catch (e) { notify(e.message, false); }
    };
    $("#actionBatch").onchange = renderVatOptions;
    $("#actionForm").onsubmit = async (event) => {
      event.preventDefault();
      const f = event.target;
      if (!f.batchId.value) return notify("请先选择一个未结束批次。", false);
      try {
        const out = await api("/api/batches/" + encodeURIComponent(f.batchId.value) + "/vats/" + encodeURIComponent(f.vatName.value) + "/observations", {
          method: "POST",
          body: JSON.stringify({ waterLevel: f.waterLevel.value, temperature: f.temperature.value, mold: f.mold.checked, changeWater: f.changeWater.checked, note: f.note.value })
        });
        const wc = out.waterChange || {};
        if (wc.result === "done") notify("观察已追加，换水完成，上次换水时间已更新。", true);
        else if (wc.result === "pending") notify("观察已追加；换水间隔不足 " + MIN_HOURS / 24 + " 天，申请已停在待处理。", false);
        else if (wc.result === "paused") notify("观察已追加；整批暂停换水：" + (wc.reasons || []).join("、") + "。其他缸仍可继续观察。", false);
        else notify("观察已追加。", true);
        f.waterLevel.value = ""; f.temperature.value = ""; f.mold.checked = false; f.changeWater.checked = false; f.note.value = "";
        await load();
        f.batchId.value = out.batchId; renderVatOptions(); f.vatName.value = encodeURIComponent(out.vatName);
      } catch (e) { notify(e.message, false); }
    };
    $("#statusFilter").onchange = renderCards;
    $("#pauseFilter").onchange = renderCards;
    $("#pendingFilter").onchange = renderCards;
    $("#search").oninput = renderCards;
    $("#reload").onclick = load;

    renderVatRows(); bindDel(); load();
  </script>
</body>
</html>`;
}
