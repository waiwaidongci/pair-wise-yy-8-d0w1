// 页面操作：记录页 HTML 与前端交互（建档、每缸观察/换水、筛选、统计）。
// 只负责页面渲染和调 API，业务判定全部在 batch.js，存取在 store.js。

import { STAGES, LOW_WATER_LEVEL, MIN_WATER_CHANGE_HOURS } from "./batch.js";

export function renderPage() {
  const stagesJson = JSON.stringify(STAGES);
  const lowJson = JSON.stringify(LOW_WATER_LEVEL);
  const minHoursJson = JSON.stringify(MIN_WATER_CHANGE_HOURS);
  // 统计卡片展示顺序
  const statKeysJson = JSON.stringify([...STAGES, "未结束批次", "暂停换水批次", "待处理换水", "缸位总数"]);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法纸浆发酵批次管理</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --hold:#a06a1c; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:17px; } main { display:grid; grid-template-columns:400px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:56px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 12px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.warn { background:var(--warn); } button.hold { background:var(--hold); } button.tiny { padding:5px 9px; font-size:12px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:96px; overflow:auto; } .warn { color:var(--warn); font-weight:700; } .hold { color:var(--hold); font-weight:700; }
    table { width:100%; border-collapse:collapse; font-size:13px; } th,td { border-bottom:1px solid var(--line); padding:5px 4px; text-align:left; vertical-align:middle; } th { color:var(--muted); font-weight:400; }
    .banner { border-radius:6px; padding:8px 10px; font-size:13px; } .banner.paused { background:#f7e7e3; color:var(--warn); border:1px solid #e3bcb2; } .banner.pending { background:#f6ecd9; color:var(--hold); border:1px solid #e0cb9f; } .banner.finished { background:#eef0ec; color:var(--muted); }
    .vatrow { display:grid; grid-template-columns:1fr 80px 80px 1fr auto; gap:6px; align-items:center; margin-bottom:6px; } .vatrow input { padding:7px; } .vatrow .tag { font-size:12px; color:var(--muted); }
    .btns { display:flex; gap:8px; flex-wrap:wrap; } .lowwater { color:var(--warn); font-weight:700; }
    #toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:#2c332a; color:#fff; padding:11px 18px; border-radius:8px; font-size:14px; display:none; max-width:80vw; z-index:10; } #toast.err { background:var(--warn); }
    .row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .row2 label { margin-top:6px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法纸浆发酵批次管理</h1><div class="meta">一批多缸：每缸水位、温度、上次换水时间统一照看；异常时整批暂停换水</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm">
        <h2>新增发酵批次</h2>
        <div class="row2">
          <div><label>批次编号</label><input name="code" required></div>
          <div><label>发酵天数</label><input name="days" type="number" min="0" value="0"></div>
        </div>
        <label>原料来源</label><input name="source">
        <div class="row2">
          <div><label>负责人</label><input name="owner"></div>
          <div><label>初始状态</label><select name="status" id="createStatus"></select></div>
        </div>
        <label>本批浸泡缸（至少一口；同一口缸不能留在两个未结束批次）</label>
        <div id="vatRows"></div>
        <button type="button" class="secondary tiny" id="addVatRow">再加一口缸</button>
        <div style="margin-top:12px"><button>保存批次</button></div>
      </form>

      <form id="obsForm" style="margin-top:14px">
        <h2>每缸观察 / 换水</h2>
        <label>选择批次</label><select name="batch" id="batchSelect"></select>
        <label>选择缸号</label><select name="vat" id="vatSelect"></select>
        <div class="row2">
          <div><label>水位 %（低于 ${LOW_WATER_LEVEL}% 为过低）</label><input name="waterLevel" type="number" min="0" max="100" id="obsLevel"></div>
          <div><label>温度 ℃</label><input name="temperature" type="number" step="0.1" id="obsTemp"></div>
        </div>
        <label>霉点</label><select name="mold"><option value="无">无</option><option value="有">有（整批暂停换水）</option></select>
        <label>观察备注（气味、纤维状态等）</label><textarea name="note"></textarea>
        <div class="btns" style="margin-top:10px">
          <button type="button" id="addObsBtn">追加观察</button>
          <button type="button" class="secondary" id="waterBtn">申请换水</button>
        </div>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option></select>
        <input id="search" placeholder="搜索编号、原料、缸号或关键词">
      </div>
      <div class="panel">
        <h2>批次列表</h2>
        <div class="meta" style="margin:-6px 0 10px">换水间隔不足 ${MIN_WATER_CHANGE_HOURS} 小时会停在“待处理”；某口缸霉点或水位过低时整批暂停换水，其他缸仍可追加观察。</div>
        <div class="grid" id="cards"></div>
      </div>
    </section>
  </main>
  <div id="toast"></div>
  <script>
    const STAGES = ${stagesJson};
    const LOW_LEVEL = ${lowJson};
    const MIN_HOURS = ${minHoursJson};
    const STAT_KEYS = ${statKeysJson};
    let batches = [];
    const createForm = document.querySelector('#createForm');
    const obsForm = document.querySelector('#obsForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const batchSelect = document.querySelector('#batchSelect');
    const vatSelect = document.querySelector('#vatSelect');
    const vatRows = document.querySelector('#vatRows');
    const toastEl = document.querySelector('#toast');
    let toastTimer = null;

    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
    function toast(msg, isErr) {
      toastEl.textContent = msg;
      toastEl.className = isErr ? 'err' : '';
      toastEl.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, 4200);
    }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? Object.assign({}, options, { headers: { 'Content-Type': 'application/json' } }) : options);
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function fmtTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return esc(iso);
      const p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function fmtHours(h) {
      if (h === null || h === undefined) return '未换水';
      if (h < 24) return h.toFixed(1) + ' 小时前';
      return Math.floor(h / 24) + ' 天' + Math.round(h % 24) + ' 小时前';
    }
    function currentBatch() {
      return batches.find(function (b) { return (b.id || b.code) === batchSelect.value; }) || null;
    }

    // ---------- 建档：多缸编辑 ----------
    function addVatRow(seed) {
      const div = document.createElement('div');
      div.className = 'vatrow';
      div.innerHTML =
        '<input placeholder="缸号，如 三号缸" class="v-name">' +
        '<input type="number" min="0" max="100" placeholder="水位%" class="v-level">' +
        '<input type="number" step="0.1" placeholder="温度" class="v-temp">' +
        '<input type="datetime-local" class="v-last" title="上次换水时间">' +
        '<button type="button" class="secondary tiny v-del">删</button>';
      div.querySelector('.v-del').onclick = function () { div.remove(); };
      vatRows.appendChild(div);
    }
    document.querySelector('#addVatRow').onclick = function () { addVatRow(); };
    createForm.onsubmit = async function (event) {
      event.preventDefault();
      const fd = new FormData(createForm);
      const vats = Array.prototype.slice.call(vatRows.children).map(function (row) {
        return {
          name: row.querySelector('.v-name').value.trim(),
          waterLevel: row.querySelector('.v-level').value,
          temperature: row.querySelector('.v-temp').value,
          lastWaterChange: row.querySelector('.v-last').value
        };
      }).filter(function (v) { return v.name; });
      try {
        await api('/api/batches', { method: 'POST', body: JSON.stringify({
          code: fd.get('code'), source: fd.get('source'), owner: fd.get('owner'),
          days: fd.get('days'), status: fd.get('status'), vats: vats
        }) });
        createForm.reset();
        vatRows.innerHTML = '';
        addVatRow();
        await load();
        toast('批次已建档，共 ' + vats.length + ' 口缸');
      } catch (error) { toast(error.message, true); }
    };

    // ---------- 每缸观察 / 换水 ----------
    function fillBatchSelect() {
      const prev = batchSelect.value;
      batchSelect.innerHTML = batches.map(function (b) {
        return '<option value="' + esc(b.id || b.code) + '">' + esc(b.code) + ' · ' + esc(b.source || '') +
          '（' + b.vatCount + ' 缸' + (b.finished ? '，已结束' : '') + '）</option>';
      }).join('');
      if (prev && batches.some(function (b) { return (b.id || b.code) === prev; })) batchSelect.value = prev;
    }
    function fillVatSelect(presetVat) {
      const b = currentBatch();
      vatSelect.innerHTML = b ? b.vats.map(function (v) {
        const flags = [];
        if (v.mold) flags.push('霉点');
        if (v.waterLevel !== null && v.waterLevel < LOW_LEVEL) flags.push('低水位');
        return '<option value="' + esc(v.name) + '"' + (v.name === presetVat ? ' selected' : '') + '>' +
          esc(v.name) + (flags.length ? '（' + flags.join('、') + '）' : '') + '</option>';
      }).join('') : '';
      syncVatHint();
    }
    function syncVatHint() {
      const b = currentBatch();
      const v = b && b.vats.find(function (x) { return x.name === vatSelect.value; });
      if (v) {
        document.querySelector('#obsLevel').placeholder = v.waterLevel === null ? '水位%' : '当前 ' + v.waterLevel + '%';
        document.querySelector('#obsTemp').placeholder = v.temperature === null ? '温度' : '当前 ' + v.temperature + '℃';
      }
    }
    batchSelect.onchange = function () { fillVatSelect(); };
    vatSelect.onchange = syncVatHint;

    function obsPayload() {
      const fd = new FormData(obsForm);
      return { vat: fd.get('vat'), waterLevel: fd.get('waterLevel'), temperature: fd.get('temperature'), mold: fd.get('mold'), note: fd.get('note') };
    }
    document.querySelector('#addObsBtn').onclick = async function () {
      const ref = batchSelect.value;
      try {
        const r = await api('/api/batches/' + encodeURIComponent(ref) + '/vats/observation', { method: 'POST', body: JSON.stringify(obsPayload()) });
        obsForm.reset();
        await load();
        if (r.issue) toast(r.issue ? '已记录：' + esc(r.vat.name) + '出现' + r.issue + '，整批暂停换水，其他缸仍可观察' : '观察已追加');
        else toast('观察已追加');
      } catch (error) { toast(error.message, true); }
    };
    document.querySelector('#waterBtn').onclick = async function () {
      const ref = batchSelect.value;
      const v = vatSelect.value;
      try {
        const r = await api('/api/batches/' + encodeURIComponent(ref) + '/vats/water-change', { method: 'POST', body: JSON.stringify({ vat: v }) });
        await load();
        if (r.held) toast('换水间隔不足，' + esc(r.pending.vat) + ' 停在待处理，还需约 ' + r.waitHours + ' 小时', true);
        else toast(esc(r.vat) + ' 已完成换水');
      } catch (error) { toast(error.message, true); }
    };

    // ---------- 列表、筛选、统计 ----------
    function renderStats(stats) {
      statsEl.innerHTML = STAT_KEYS.filter(function (k) { return stats[k] !== undefined; }).map(function (k) {
        return '<div class="stat"><span>' + esc(k) + '</span><strong>' + stats[k] + '</strong></div>';
      }).join('');
    }
    function vatTable(b) {
      const pendingMap = {};
      (b.pendingWaterChanges || []).forEach(function (p) { pendingMap[p.vat] = p; });
      const rows = b.vats.map(function (v) {
        const levelCls = (v.waterLevel !== null && v.waterLevel < LOW_LEVEL) ? ' class="lowwater"' : '';
        const flags = [];
        if (v.mold) flags.push('<span class="warn">霉点</span>');
        if (v.waterLevel !== null && v.waterLevel < LOW_LEVEL) flags.push('<span class="warn">水位过低</span>');
        const acts = b.finished ? '<span class="meta">已结束</span>'
          : pendingMap[v.name]
            ? '<button class="hold tiny" data-water="retry" data-vat="' + esc(v.name) + '">重试待处理</button>'
            : '<button class="secondary tiny" data-water="change" data-vat="' + esc(v.name) + '">换水</button>';
        return '<tr><td>' + esc(v.name) + (flags.length ? '<br>' + flags.join(' ') : '') + '</td>' +
          '<td' + levelCls + '>' + (v.waterLevel === null ? '—' : esc(v.waterLevel) + '%') + '</td>' +
          '<td>' + (v.temperature === null ? '—' : esc(v.temperature) + '℃') + '</td>' +
          '<td>' + fmtTime(v.lastWaterChange) + '<br><span class="meta">' + fmtHours(v.hoursSinceChange) + '</span></td>' +
          '<td>' + acts + ' <button class="tiny" data-pick="' + esc(v.name) + '">观察</button></td></tr>';
      }).join('');
      return '<table><tr><th>缸号</th><th>水位</th><th>温度</th><th>上次换水</th><th>操作</th></tr>' + rows + '</table>';
    }
    function cardHtml(b) {
      let banner = '';
      if (b.waterChangePaused) {
        banner = '<div class="banner paused">⏸ 整批暂停换水：' + esc(b.pauseReason || '有缸出现霉点或水位过低') +
          (b.finished ? '' : ' <button class="warn tiny" data-resume="1">异常已解除，恢复换水</button>') + '</div>';
      } else if (b.pendingCount) {
        banner = '<div class="banner pending">⏳ ' + b.pendingCount + ' 口缸换水间隔不足，停在待处理，到点后点“重试”</div>';
      } else if (b.finished) {
        banner = '<div class="banner finished">批次已结束，缸位已释放，可用于新批次</div>';
      }
      const logs = (b.logs || []).slice(-4).map(function (l) {
        return '<div class="' + (l.abnormal ? 'warn' : '') + '">' + fmtTime(l.at) + ' ' + esc(l.step) + '：' + esc(l.note) + '</div>';
      }).join('');
      return '<article class="card">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
        '<h3>' + esc(b.code) + '</h3><span class="pill">' + esc(b.status) + '</span></div>' +
        '<div class="meta">' + esc(b.source || '原料未填') + ' · 负责人 ' + esc(b.owner || '未填') + ' · 第 ' + esc(b.days) + ' 天 · ' + b.vatCount + ' 口缸</div>' +
        banner + vatTable(b) +
        '<div class="row2"><div><label>状态</label><select data-status="' + esc(b.id || b.code) + '">' +
          STAGES.map(function (s) { return '<option' + (s === b.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></div><div><label>批次操作</label><div class="btns">' +
        '<button class="secondary tiny" data-note="' + esc(b.id || b.code) + '">追加备注</button>' +
        (b.finished ? '' : '<button class="warn tiny" data-finish="' + esc(b.id || b.code) + '">结束批次</button>') +
        '</div></div></div>' +
        '<div class="logs meta">' + (logs || '暂无记录') + '</div></article>';
    }
    function renderCards() {
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim().toLowerCase();
      const visible = batches.filter(function (b) {
        if (status && b.status !== status) return false;
        if (q) return JSON.stringify(b).toLowerCase().includes(q);
        return true;
      });
      cards.innerHTML = visible.length ? visible.map(cardHtml).join('') : '<div class="meta">没有符合条件的批次</div>';
    }
    function render() {
      fillBatchSelect();
      fillVatSelect();
      renderCards();
    }

    cards.addEventListener('click', async function (event) {
      const btn = event.target.closest('button');
      if (!btn) return;
      const card = btn.closest('.card');
      const code = card.querySelector('h3').textContent;
      const ref = code;
      try {
        if (btn.dataset.water) {
          const path = btn.dataset.water === 'retry' ? 'vats/retry' : 'vats/water-change';
          const r = await api('/api/batches/' + encodeURIComponent(ref) + '/' + path, { method: 'POST', body: JSON.stringify({ vat: btn.dataset.vat }) });
          await load();
          if (r.held) toast(esc(r.pending.vat) + ' 还没到换水间隔，需再等约 ' + r.waitHours + ' 小时', true);
          else toast(esc(r.vat) + ' 已完成换水');
        } else if (btn.dataset.resume !== undefined) {
          await api('/api/batches/' + encodeURIComponent(ref) + '/resume', { method: 'POST', body: JSON.stringify({}) });
          await load();
          toast('已恢复整批换水');
        } else if (btn.dataset.finish) {
          if (!confirm('结束批次 ' + code + '？结束后缸位释放。')) return;
          await api('/api/batches/' + encodeURIComponent(ref) + '/finish', { method: 'POST' });
          await load();
          toast('批次已结束，缸位已释放');
        } else if (btn.dataset.note) {
          const note = prompt('记录备注');
          if (note) {
            await api('/api/items/' + encodeURIComponent(btn.dataset.note) + '/logs', { method: 'POST', body: JSON.stringify({ step: '备注', note: note }) });
            await load();
          }
        } else if (btn.dataset.pick) {
          batchSelect.value = batches.find(function (b) { return b.code === code; }).id || code;
          fillVatSelect(btn.dataset.pick);
          document.querySelector('#obsForm').scrollIntoView({ behavior: 'smooth' });
        }
      } catch (error) { toast(error.message, true); }
    });
    cards.addEventListener('change', async function (event) {
      const sel = event.target.closest('[data-status]');
      if (!sel) return;
      try {
        await api('/api/items/' + encodeURIComponent(sel.dataset.status), { method: 'PATCH', body: JSON.stringify({ status: sel.value }) });
        await load();
        toast('状态已更新为 ' + sel.value);
      } catch (error) { toast(error.message, true); }
    });

    async function load() {
      const [list, stats] = await Promise.all([api('/api/items'), api('/api/stats')]);
      batches = list;
      renderStats(stats);
      render();
    }
    document.querySelector('#statusFilter').onchange = renderCards;
    document.querySelector('#search').oninput = renderCards;
    document.querySelector('#reload').onclick = function () { load().then(function () { toast('已刷新'); }); };
    document.querySelector('#createStatus').innerHTML = STAGES.map(function (s, i) {
      return '<option' + (i === 0 ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    addVatRow();
    load().catch(function (e) { toast(e.message, true); });
  </script>
</body>
</html>`;
}
