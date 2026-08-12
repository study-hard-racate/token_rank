const CNY_DEFAULT = 7.2;
const PAGE_SIZE = 60;
const HISTORY_KEEP_DAYS = 45;
const WEIGHT_LABEL = { balanced: "均衡型", value: "性价比", perf: "性能优先" };
const WEIGHT_TIP = {
  balanced: "价格40% 能力40% 速度20%",
  value: "价格50% 能力35% 速度15%",
  perf: "价格25% 能力50% 速度25%",
};
const SCENE_LABEL = { general: "通用智能", code: "编程开发", agent: "智能体" };
const SCENE_TIP = {
  general: "能力分用总体智能指数",
  code: "能力分用编程指数",
  agent: "能力分用智能体指数",
};

const state = {
  aaPerfAt: null,
  staticMode: null,
  allItems: [],
  histData: null,
  staticErrors: [],
  minTps: 0,
  items: [],
  providers: [],
  chart: null,
  showAll: false,
  currency: "usd",
  rate: Number(localStorage.getItem("tk_rate")) || CNY_DEFAULT,
  updated: null,
  estimate: null,
  deltas: {},
  trend: { id: null, multi: null, chart: null, range: 7, modelName: "" },
  providerChips: [],
  pcIndex: 0,
  mov: { days: 7, rows: [] },
  weights: "balanced",
  scene: "general",
  budget: false,
  compare: [],
  favs: readFavs(),
  favOnly: false,
  movKind: "all",
};

function chartColors() {
  const cs = getComputedStyle(document.body);
  const cv = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
  return {
    tick: cv("--chart-tick", "#94a3b8"),
    tickY: cv("--chart-tick", "#94a3b8"),
    grid: cv("--chart-grid", "#334155"),
    bar: document.body.classList.contains("light") ? "#0284c7" : "#38bdf8",
  };
}

function chartLabel(n) {
  const t = String(n || "").split(" (")[0];
  return t.length > 12 ? t.slice(0, 12) + "…" : t;
}

function readFavs() {
  try {
    const v = JSON.parse(localStorage.getItem("tk_favs") || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function saveFavs() {
  try { localStorage.setItem("tk_favs", JSON.stringify(state.favs)); } catch (e) {}
}

const $ = (id) => document.getElementById(id);
const sign = () => (state.currency === "cny" ? "¥" : "$");
const rate = () => (state.currency === "cny" ? state.rate : 1);

function fmtPrice(n) {
  if (n == null) return "—";
  const v = Number(n * rate());
  const fixed = v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(2) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return sign() + fixed;
}
function fmtCtx(n) {
  if (!(n > 0)) return "—";
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n >= 1000 ? (n / 1000).toFixed(0) + "K" : String(n));
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}
function monthlyCost(it) {
  const { inM, outM } = state.estimate || {};
  const pct = ((state.estimate && state.estimate.cachePct) || 0) / 100;
  const cin = (it.cache_in != null ? it.cache_in : it.input) || 0;
  return (it.input || 0) * (1 - pct) * (inM || 0)
    + cin * pct * (inM || 0)
    + (it.output || 0) * (outM || 0);
}

async function loadData() {
  if (await detectStatic()) { await loadDataStatic(); return; }
  const params = new URLSearchParams();
  if ($("search").value) params.set("q", $("search").value);
  if ($("provider").value) params.set("provider", $("provider").value);
  if ($("maxprice").value) params.set("max_price", $("maxprice").value);
  if (state.budget) {
    params.set("budget", "1");
  } else {
    params.set("sort", $("sort").value);
  }
  params.set("weights", $("weights").value);
  params.set("scene", $("scene").value);
  params.set("with_deltas", "1");

  setLoading(true);
  try {
    const data = await (await fetch("/api/data?" + params.toString())).json();
    state.items = data.items || [];
    if (data.providers && data.providers.length) state.providers = data.providers;
    state.updated = data.updated;
    state.aaPerfAt = data.aa_perf_at || null;
    state.showAll = false;
    state.deltas = data.deltas7 || {};
    state.deltasFetched = true;
    renderMeta(data);
    renderTable();
    renderChart();
    renderStats();
    loadMovers();
    saveFilters();
    saveStateToURL();
    maybeFavAlert();
  } catch (e) {
    state.loadError = e;
    renderLoadError();
  } finally {
    setLoading(false);
  }
}

async function detectStatic() {
  if (state.staticMode != null) return state.staticMode;
  try {
    const res = await fetch("/api/data?probe=1", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error("no api");
    await res.json();
    state.staticMode = false;
  } catch (e) {
    state.staticMode = true;
  }
  return state.staticMode;
}

function calcComp(o, preset) {
  const w = { balanced: [0.4, 0.4, 0.2], value: [0.5, 0.35, 0.15], perf: [0.25, 0.5, 0.25] }[preset] || [0.4, 0.4, 0.2];
  if (o.pf_v == null) return null;
  const parts = [[o.ps, w[0]], [o.pf_v, w[1]]];
  if (o.sp != null) parts.push([o.sp, w[2]]);
  let total = 0, sum = 0;
  for (const [v, wt] of parts) { total += wt; sum += v * wt; }
  return Math.round(sum / total * 10) / 10;
}

function filterItemsStatic(items, q, provider, maxPrice) {
  let out = items;
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    if (terms.length) {
      out = out.filter((it) => terms.every((t) =>
        (it.name || "").toLowerCase().includes(t) ||
        (it.id || "").toLowerCase().includes(t) ||
        (it.provider || "").toLowerCase().includes(t)));
    }
  }
  if (provider) out = out.filter((it) => (it.provider || "").toLowerCase().includes(provider));
  if (maxPrice) {
    const lim = parseFloat(maxPrice);
    if (!isNaN(lim)) out = out.filter((it) => (it.input || 0) <= lim && (it.output || 0) <= lim);
  }
  return out;
}

function histDeltasLocal(days) {
  const out = {};
  const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  for (const [mid, entries] of Object.entries(state.histData || {})) {
    const pts = (entries || []).filter((e) => e.date >= cutoff);
    if (pts.length >= 2) {
      const first = pts[0], last = pts[pts.length - 1];
      const pct = (a, b) => (!a || b == null || b === 0) ? null : Math.round((a / b * 100 - 100) * 10) / 10;
      out[mid] = {
        in_pct: pct(last.input, first.input),
        out_pct: pct(last.output, first.output),
        in_first: first.input, in_last: last.input,
        out_first: first.output, out_last: last.output,
        first: first.date, last: last.date,
      };
    }
  }
  return out;
}

function lowMapLocal() {
  const low = {};
  for (const [mid, entries] of Object.entries(state.histData || {})) {
    if (!Array.isArray(entries) || entries.length < 7) continue;
    const vals = entries.map((e) => e.input).filter((v) => v != null);
    if (vals.length) low[mid] = Math.min.apply(null, vals);
  }
  return low;
}

function getHistoryLocal(id, days) {
  const entries = (state.histData || {})[id] || [];
  const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { model: id, days, points: entries.filter((e) => e.date >= cutoff) };
}

function histStatsLocal() {
  const dates = new Set();
  let models = 0, points = 0;
  for (const [mid, entries] of Object.entries(state.histData || {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    models += 1;
    for (const e of entries) {
      if (e && e.date) { dates.add(e.date); points += 1; }
    }
  }
  const ds = [...dates].sort();
  const first = ds[0] || null, last = ds[ds.length - 1] || null;
  let gapDays = 0;
  if (last) {
    gapDays = Math.max(0, Math.floor((new Date(new Date().toISOString().slice(0, 10)) - new Date(last)) / 86400000));
  }
  return { days: ds.length, models, points, first, last, gap_days: gapDays };
}

function summaryLocal() {
  const byProvider = {};
  for (const it of state.allItems) {
    (byProvider[it.provider] = byProvider[it.provider] || []).push(it);
  }
  const stats = {};
  for (const [name, its] of Object.entries(byProvider)) {
    const prices = its.map((x) => x.input || 0).sort((a, b) => a - b);
    const avg = prices.length ? prices.reduce((s, v) => s + v, 0) / prices.length : 0;
    stats[name] = {
      count: its.length,
      min_input: prices[0] || 0,
      avg_input: Math.round(avg * 10000) / 10000,
      max_context: Math.max.apply(null, its.map((x) => x.context || 0)),
    };
  }
  return { total_models: state.allItems.length, providers: stats, history: histStatsLocal() };
}

async function loadDataStatic() {
  setLoading(true);
  try {
    if (!state.histData) {
      const hr = await fetch("history.json", { cache: "no-store" });
      state.histData = await hr.json();
    }
    if (!state.allItems.length) {
      const dr = await fetch("data.json", { cache: "no-store" });
      const data = await dr.json();
      state.allItems = data.items || [];
      state.updated = data.updated;
      state.aaPerfAt = data.aa_perf_at || null;
      state.staticErrors = data.errors || [];
      state.providers = [...new Set(state.allItems.map((x) => x.provider))].sort();
    }
    state.deltas = histDeltasLocal(7);
    state.deltasFetched = true;
    const low = lowMapLocal();
    const scene = state.scene;
    const preset = state.weights;
    let items = state.allItems.map((it) => {
      const o = Object.assign({}, it);
      const pf = (o.pf || {})[scene];
      o.pf_v = pf ? pf.v : null;
      o.pf_src = pf ? pf.src : null;
      o.comp = calcComp(o, preset);
      return o;
    });
    items = filterItemsStatic(items,
      $("search").value.trim().toLowerCase(),
      $("provider").value.trim().toLowerCase(),
      $("maxprice").value.trim());
    if (state.budget) {
      items = items.filter((o) => o.comp == null);
      items.sort((a, b) => (a.input || 0) - (b.input || 0) || (a.output || 0) - (b.output || 0));
    }
    for (const o of items) {
      const mn = low[o.id];
      if (mn != null && (o.input || 0) <= mn * 1.001) o.low_badge = true;
    }
    state.items = items;
    state.showAll = false;
    renderMeta({ count: items.length, updated: state.updated, errors: state.staticErrors });
    renderTable();
    renderChart();
    renderStats();
    loadMovers();
    saveFilters();
    saveStateToURL();
    maybeFavAlert();
  } catch (e) {
    state.loadError = e;
    renderLoadError();
  } finally {
    setLoading(false);
  }
}

function renderLoadError() {
  const tbody = document.querySelector("#rank tbody");
  if (tbody && !state.items.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">加载失败（可能处于离线或服务器繁忙）。请点击「立即刷新」重试，或稍后访问。</td></tr>`;
  }
  $("meta").innerHTML = ` <span class="err">⚠ 数据加载失败（${(state.loadError && state.loadError.message) || "网络错误"}）。数据仍停留在上次成功结果。</span>`;
}

async function loadMovers() {
  let deltas = null;
  try {
    if (state.deltasFetched && state.mov.days === 7) {
      deltas = state.deltas;
    } else if (state.staticMode) {
      deltas = histDeltasLocal(state.mov.days);
    } else {
      const res = await (await fetch(`/api/history-deltas?days=${state.mov.days}`)).json();
      deltas = res.deltas || {};
    }
    const byId = {};
    state.items.forEach((it) => { byId[it.id] = it; });
    state.mov.rows = [];
    for (const [id, d] of Object.entries(deltas)) {
      const it = byId[id];
      if (!it) continue;
      state.mov.rows.push({
        it, d,
        mag: Math.max(Math.abs(d.in_pct || 0), Math.abs(d.out_pct || 0)),
      });
    }
    state.mov.rows.sort((a, b) => b.mag - a.mag);
    if (state.mov.days === 7 && !state.deltasFetched) {
      state.deltas = deltas;
      state.deltasFetched = true;
      renderTable();
    }
  } catch (e) {
    state.mov.rows = [];
  }
  renderMovers();
}

function mvPrice(d, key) {
  const v = d[key];
  if (v != null) return fmtPrice(v * 1);
  return "—";
}

function mvDelta(d, which) {
  const pct = which === "in" ? d.in_pct : d.out_pct;
  const last = which === "in" ? d.in_last : d.out_last;
  const first = which === "in" ? d.in_first : d.out_first;
  if (pct == null || last == null || first == null) return "—";
  const cls = pct > 0 ? "up" : "down";
  const arrow = pct > 0 ? "▲" : "▼";
  const signTxt = pct >= 0 ? "+" : "";
  const diff = (last - first) * rate();
  return `<span class="delta ${cls}">${arrow} ${Math.abs(pct)}%</span>` +
    ` <small class="mv-sub">${signTxt}${sign()}${diff.toFixed(2)}</small>`;
}

function renderMovers() {
  const tbody = document.querySelector("#movers tbody");
  if (!tbody) return;
  let rows = state.mov.rows;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">近 ${state.mov.days} 天暂无价格变动记录（历史自部署日起按日累积）。</td></tr>`;
    $("mv-hint").textContent = "";
    return;
  }
  if ($("mv-moved").checked) {
    rows = rows.filter((r) => r.d.in_pct != null || r.d.out_pct != null);
  }
  const kind = state.movKind;
  if (kind === "down") {
    rows = rows.filter((r) => (r.d.in_pct != null && r.d.in_pct < 0) || (r.d.out_pct != null && r.d.out_pct < 0));
    rows.sort((a, b) => b.mag - a.mag);
  } else if (kind === "up") {
    rows = rows.filter((r) => (r.d.in_pct != null && r.d.in_pct > 0) || (r.d.out_pct != null && r.d.out_pct > 0));
    rows.sort((a, b) => b.mag - a.mag);
  }
  const visible = rows.slice(0, 15);
  tbody.innerHTML = visible.map((r, i) => {
    const it = r.it, d = r.d;
    return `<tr class="mv-row" data-trend="${escapeHtml(it.id)}" data-name="${escapeHtml(it.name)}" title="点击查看价格走势">
      <td>${i + 1}</td>
      <td class="name-cell">${escapeHtml(it.name)}</td>
      <td><span class="badge">${escapeHtml(it.provider)}</span></td>
      <td class="num">${mvPrice(d, "in_last")}</td>
      <td class="num">${mvDelta(d, "in")}</td>
      <td class="num">${mvPrice(d, "out_last")}</td>
      <td class="num">${mvDelta(d, "out")}</td>
      <td>${d.first} ~ ${d.last}</td>
    </tr>`;
  }).join("");
  const changed = rows.filter((r) => r.d.in_pct != null || r.d.out_pct != null).length;
  const kindTxt = kind === "down" ? "降价榜" : kind === "up" ? "涨价榜" : "全部";
  $("mv-hint").textContent =
    `${kindTxt}：${rows.length} 个模型在近 ${state.mov.days} 天内发生价格变动（显示前 ${visible.length}）`;
}

function setMoversRange(days) {
  state.mov.days = days;
  document.querySelectorAll(".range-btn2").forEach((b) =>
    b.classList.toggle("active", parseInt(b.dataset.days) === days));
  saveFilters();
  loadMovers();
}

function setLoading(on) {
  $("refresh").disabled = on;
  $("refresh").textContent = on ? "刷新中…" : "立即刷新";
}

function renderMeta(data) {
  const n = (data.errors || []).length;
  const dsBlocked = (data.errors || []).some((e) => /scrape_deepseek/.test(e));
  const errs = dsBlocked
    ? ` <span class="err" title="DeepSeek 官网在服务器环境被拦截（平台限制），已使用 OpenRouter 数据">⚠ DeepSeek 官网被服务器拦截（环境限制），已用 OpenRouter 数据</span>`
    : n
      ? ` <span class="err" title="${(data.errors || []).join("；")}">⚠ ${n} 个辅助源失败（已用其余数据源）</span>` : "";
  const next = (iso) => {
    const t = new Date(iso);
    if (isNaN(t)) return "—";
    t.setHours(t.getHours() + 6);
    return fmtTime(t.toISOString());
  };
  const estTxt = state.estimate
    ? ` · 估算中：月输入 <b>${state.estimate.inM}M</b> / 月输出 <b>${state.estimate.outM}M</b> tokens，缓存 <b>${state.estimate.cachePct || 0}%</b>` : "";
  const costWarn = ($("sort").value === "cost" && !state.estimate)
    ? ` <span class="err">（按估算成本排序需先在估算器输入用量）</span>` : "";
  const scoreNote = $("sort").value === "score" && !state.budget
    ? ` · 综合推荐按「${SCENE_LABEL[state.scene]}·${WEIGHT_TIP[state.weights]}」加权，仅含能力指数数据的模型参与` : "";
  const budgetNote = state.budget
    ? ` · 实惠榜：仅含暂无能力指数数据的 ${data.count} 个模型，按输入价从低到高推荐，不参与综合评分` : "";
  $("subtitle").textContent = state.currency === "cny"
    ? `实时爬取各大模型 Token 费用 · 价格货币：人民币 ¥ / 100 万 tokens（汇率 1 USD ≈ ${state.rate}，可在上方修改或点"自动汇率"获取）`
    : "实时爬取各大模型 Token 费用 · 价格单位：美元 / 100 万 tokens";
  let perfAge = "";
  if (state.aaPerfAt) {
    const days = (Date.now() - new Date(state.aaPerfAt).getTime()) / 86400000;
    if (days > 30) {
      perfAge = ` <span class="err" title="Artificial Analysis 官网当前不可达，性能数据来自 ${fmtTime(state.aaPerfAt)} 的缓存">⚠ 性能数据已 ${Math.floor(days)} 天未更新（数据源不可达，用缓存）</span>`;
    }
  }
  $("meta").innerHTML =
    `共 <b>${data.count}</b> 个模型 · 最近更新：${fmtTime(data.updated)} · 下次自动：${next(data.updated)}${estTxt}${costWarn}${scoreNote}${budgetNote}${errs}${perfAge}`;
}

function buildRows() {
  const sortVal = state.budget ? "input" : $("sort").value;
  const useCost = sortVal === "cost" && state.estimate;
  let rows = state.items.map((it) => ({ i: it, c: useCost ? monthlyCost(it) : 0 }));
  if (state.favOnly) {
    rows = rows.filter((r) => state.favs.includes(r.i.id));
  }
  if (state.minTps > 0) {
    rows = rows.filter((r) => (r.i.tps || 0) >= state.minTps);
  }
  if (useCost) {
    rows.sort((a, b) => a.c - b.c);
  } else if (sortVal === "input" || sortVal === "output") {
    const p = sortVal;
    const q = sortVal === "input" ? "output" : "input";
    rows.sort((a, b) => (a.i[p] || 0) - (b.i[p] || 0) || (a.i[q] || 0) - (b.i[q] || 0));
  } else if (sortVal === "context") {
    rows.sort((a, b) => (b.i.context || 0) - (a.i.context || 0));
  } else if (sortVal === "name") {
    rows.sort((a, b) => String(a.i.name).localeCompare(String(b.i.name)));
  } else if (sortVal === "score") {
    rows.sort((a, b) => (b.i.comp ?? -1) - (a.i.comp ?? -1));
  } else if (sortVal === "tps") {
    rows.sort((a, b) => (b.i.tps || 0) - (a.i.tps || 0));
  }
  return { rows, useCost };
}

function renderTable() {
  const tbody = document.querySelector("#rank tbody");
  tbody.innerHTML = "";
  const { rows, useCost } = buildRows();

  if (useCost) {
    $("th-in").textContent = `月成本 (${sign()})`;
    $("th-out").textContent = `输入 (${sign()}/1M)`;
  } else {
    const sortVal = state.budget ? "input" : $("sort").value;
    $("th-in").textContent = (sortVal === "output" ? "输出" : "输入") + ` (${sign()}/1M)`;
    $("th-out").textContent = (sortVal === "output" ? "输入" : "输出") + ` (${sign()}/1M)`;
  }

  const visible = state.showAll ? rows : rows.slice(0, PAGE_SIZE);
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="loading-cell">无匹配结果</td></tr>`;
  }
  const isScore = $("sort").value === "score" && !state.budget;
  $("th-cache").textContent = `缓存输入 (${sign()}/1M)`;
  $("th-score").textContent = isScore
    ? `综合分(${WEIGHT_LABEL[state.weights]}/${SCENE_LABEL[state.scene]})`
    : state.budget ? "综合分" : "综合分";
  $("th-score").title = isScore
    ? `${SCENE_TIP[state.scene]} · 权重 ${WEIGHT_TIP[state.weights]}`
    : "综合推荐分（价格/能力/速度加权）";
  visible.forEach(({ i: it, c }, i) => {
    const cls = i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "";
    const tr = document.createElement("tr");
    const batch = String(it.id).includes(":batch")
      ? ` <span class="batch-tag">batch</span>` : "";
    const rec = isScore && i < 3 && it.comp != null
      ? ` <span class="rec-tag">推荐</span>` : "";
    const bud = state.budget && i < 3
      ? ` <span class="rec-tag rec-budget">实惠</span>` : "";
    const ckd = state.compare.includes(it.id) ? " checked" : "";
    const favCls = state.favs.includes(it.id) ? " fav-on" : "";
    const favStar = state.favs.includes(it.id) ? "★" : "☆";
    tr.innerHTML = `
      <td class="${cls}">${i + 1}</td>
      <td class="cmp-col"><input type="checkbox" class="cmp-cb" data-id="${escapeHtml(it.id)}"${ckd} title="加入对比"></td>
      <td class="name-cell">
        <button class="fav-btn${favCls}" data-fav="${escapeHtml(it.id)}" title="收藏/取消收藏该模型">${favStar}</button>
        <a class="model-link" href="https://openrouter.ai/${encodeURIComponent(it.id)}" target="_blank" rel="noopener"
           title="${escapeHtml(it.id)}">${escapeHtml(it.name)}</a>${it.low_badge ? `<span class="low-tag" title="输入价创历史新低（自本站在线以来）">新低</span>` : ""}${batch}${rec}${bud}
        <button class="trend-btn" data-trend="${escapeHtml(it.id)}" data-name="${escapeHtml(it.name)}">历史</button>
        <button class="copy-btn" title="复制模型 ID" data-id="${escapeHtml(it.id)}">⧉</button>
        <button class="copy-btn info-btn" title="查看模型详情" data-info="${escapeHtml(it.id)}">ⓘ</button>
      </td>
      <td><span class="badge">${escapeHtml(it.provider)}</span></td>
      <td class="num">${useCost ? fmtPrice(c) : fmtPrice(it.input)}${useCost ? "" : deltaBadgeHTML(it.id, false)}</td>
      <td class="num">${cacheCell(it)}</td>
      <td class="num">${fmtPrice(it.output)}${deltaBadgeHTML(it.id, true)}</td>
      <td class="num">${fmtCtx(it.context)}</td>
      <td class="num">${it.tps != null ? Math.round(it.tps) : `<span class="score-none" data-tip="暂无输出速度数据（Artificial Analysis 未收录该模型）">—</span>`}</td>
      <td class="num">${scoreHTML(it)}</td>
      <td>${fmtTime(it.updated)}</td>`;
    tbody.appendChild(tr);
  });

  const more = $("more");
  if (rows.length > PAGE_SIZE && !state.showAll) {
    more.innerHTML = `<button class="more-btn" id="btn-more">显示全部 ${rows.length} 条</button>`;
    $("btn-more").addEventListener("click", () => { state.showAll = true; renderTable(); });
  } else {
    more.innerHTML = "";
  }
}

function renderChart() {
  if (typeof Chart === "undefined") return;
  const cc = chartColors();
  const sortVal = state.budget ? "input" : $("sort").value;
  const effSort = state.budget ? "input" : sortVal;
  const useCost = effSort === "cost" && state.estimate;
  let top;
  let label;
  if (useCost) {
    top = state.items.map((it) => ({ it, c: monthlyCost(it) }))
      .filter((x) => x.c > 0).sort((a, b) => a.c - b.c).slice(0, 10).reverse();
    label = "估算月成本";
  } else if (effSort === "score") {
    top = state.items.filter((x) => x.comp != null)
      .sort((a, b) => b.comp - a.comp).slice(0, 10).reverse()
      .map((it) => ({ it, c: it.comp }));
    label = `综合分(${WEIGHT_LABEL[state.weights]})`;
  } else if (effSort === "tps") {
    top = state.items.filter((x) => x.tps != null)
      .sort((a, b) => b.tps - a.tps).slice(0, 10).reverse()
      .map((it) => ({ it, c: it.tps }));
    label = "输出速度 (tokens/s)";
  } else {
    top = state.items.filter((x) => x.input > 0)
      .sort((a, b) => a.input - b.input).slice(0, 10).reverse()
      .map((it) => ({ it, c: it.input }));
    label = "输入价格";
  }
  const chartTitle = state.budget
    ? "实惠榜 · 最便宜的 10 个（输入价格）"
    : effSort === "score"
      ? `综合推荐 Top 10（${SCENE_LABEL[state.scene]}·${WEIGHT_TIP[state.weights]}）`
      : effSort === "tps"
        ? "最快的 10 个模型（AA 评测输出速度）"
        : useCost ? "最省的 10 个模型（月成本）" : "最便宜的 10 个模型（输入价格）";
  const titleEl = document.querySelector(".chart-card h2");
  if (titleEl) titleEl.textContent = chartTitle;
  if (!top.length) return;
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($("chart"), {
    type: "bar",
    data: {
      labels: top.map((x) => chartLabel(x.it.name)),
      datasets: [{
        label: useCost ? `估算成本 (${sign()}/月)` : effSort === "score" ? `${label} / 100` : `输入价格 (${sign()}/1M)`,
        data: top.map((x) => (effSort === "score" ? x.c : x.c * rate())),
        backgroundColor: cc.bar,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { labels: { color: cc.tick } } },
      scales: {
        x: { ticks: { color: cc.tick }, grid: { color: cc.grid } },
        y: { ticks: { color: cc.tickY, autoSkip: false, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function runEstimate() {
  const inM = parseFloat($("inM").value) || 0;
  const outM = parseFloat($("outM").value) || 0;
  const cachePct = parseFloat($("cachePct").value) || 0;
  if (inM <= 0 && outM <= 0) {
    $("est-result").innerHTML = `<span class="err">请至少填写一项目用量</span>`;
    return;
  }
  state.estimate = { inM, outM, cachePct };
  $("sort").value = "cost";
  const res = $("est-result");
  let rows = state.items.map((it) => ({ it, c: monthlyCost(it) }))
    .filter((x) => x.c > 0).sort((a, b) => a.c - b.c).slice(0, 5);
  const c = (n) => fmtPrice(n);
  const cacheTxt = cachePct > 0
    ? `（缓存命中 ${cachePct}%，无缓存价模型按原输入价折算）`
    : "";
  res.innerHTML =
    `按 <b>输入 ${inM}M + 输出 ${outM}M tokens/月（缓存 ${cachePct}%）</b> 计算，最省的 5 个模型：${cacheTxt}<br>` +
    rows.map((x, i) =>
      `<div class="est-item">${i === 0 ? "* " : `${i + 1}. `}${escapeHtml(x.it.name.split(" (")[0])}` +
      ` <b>${c(x.c)}/月</b>（输入价 ${fmtPrice(x.it.input)}` +
      `${x.it.cache_in != null ? `，缓存价 ${fmtPrice(x.it.cache_in)}` : ""}）</div>`).join("") ||
    `<span class="err">无结果</span>`;
  renderTable();
  renderChart();
}

let _statsAt = 0;

function renderStats() {
  if (Date.now() - _statsAt < 5 * 60 * 1000) {
    if (typeof state.providerChips !== "undefined" && state.providerChips.length) {
      renderProvider();
      renderHistProg();
    }
    return;
  }
  _statsAt = Date.now();
  (async () => {
    try {
      const data = state.staticMode ? summaryLocal() : await (await fetch("/api/summary")).json();
      state.providerChips = Object.entries(data.providers || {})
        .sort((a, b) => a[1].min_input - b[1].min_input)
        .map(([name, s]) => ({
          name,
          count: s.count,
          min: s.min_input,
          avg: s.avg_input,
          ctx: s.max_context,
        }));
      if (state.pcIndex >= state.providerChips.length) state.pcIndex = 0;
      renderProvider();
      renderHistProg(data.history || {});
    } catch (e) {
      if (state.providerChips.length) renderProvider();
    }
  })();
}

function renderHistProg(hist) {
  const box = $("hist-prog");
  if (!box) return;
  if (!hist || !hist.days) {
    box.innerHTML = "";
    return;
  }
  const full = 7;
  const pct = Math.min(100, Math.round((hist.days / HISTORY_KEEP_DAYS) * 100));
  const note = hist.days >= full
    ? `已积累 ${hist.days} 天，覆盖 ${hist.models} 个模型（${hist.points} 个快照）`
    : `已积累 ${hist.days} 天（${hist.first} 起），覆盖 ${hist.models} 个模型，满 ${full} 天后趋势更完整`;
  const gap = hist.gap_days > 0
    ? ` <span class="hist-warn">⚠ 历史快照已中断 ${hist.gap_days} 天（最后 ${hist.last}）——免费层无定时任务，请每天访问一次页面续记历史</span>`
    : "";
  box.innerHTML = `<div class="hist-track"><div class="hist-fill" style="width:${pct}%"></div></div>
    <span class="hist-note">${note}</span>${gap}`;
}

function saveFilters() {
  const obj = {
    q: $("search").value,
    provider: $("provider").value,
    max: $("maxprice").value,
    sort: $("sort").value,
    weights: $("weights").value,
    scene: $("scene").value,
    currency: state.currency,
    budget: state.budget ? 1 : 0,
    mov: state.mov.days,
    favOnly: state.favOnly ? 1 : 0,
  };
  try { localStorage.setItem("tk_filters", JSON.stringify(obj)); } catch (e) {}
}

function saveStateToURL() {
  const p = new URLSearchParams();
  const q = $("search").value;
  const provider = $("provider").value;
  const max = $("maxprice").value;
  const sort = $("sort").value;
  const weights = $("weights").value;
  const scene = $("scene").value;
  const minTps = $("min-tps").value;
  if (q) p.set("q", q);
  if (provider) p.set("provider", provider);
  if (max) p.set("max_price", max);
  if (sort && sort !== "input") p.set("sort", sort);
  if (weights && weights !== "balanced") p.set("weights", weights);
  if (scene && scene !== "general") p.set("scene", scene);
  if (minTps) p.set("min_tps", minTps);
  if (state.budget) p.set("budget", "1");
  if (state.favOnly) p.set("fav", "1");
  const qs = p.toString();
  try {
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  } catch (e) {}
}

function applyStateFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.has("q")) $("search").value = p.get("q");
  if (p.has("provider")) $("provider").value = p.get("provider");
  if (p.has("max_price")) $("maxprice").value = p.get("max_price");
  if (p.has("sort")) $("sort").value = p.get("sort");
  if (p.has("weights")) $("weights").value = p.get("weights");
  if (p.has("scene")) $("scene").value = p.get("scene");
  if (p.has("min_tps")) {
    $("min-tps").value = p.get("min_tps");
    state.minTps = parseInt(p.get("min_tps"), 10) || 0;
  }
  if (p.has("budget") || p.get("sort") === "budget") { state.budget = true; }
  if (p.has("fav")) { state.favOnly = true; $("fav-toggle").classList.add("active"); }
}

function toggleTheme() {
  const light = document.body.classList.toggle("light");
  try { localStorage.setItem("tk_theme", light ? "light" : "dark"); } catch (e) {}
  $("theme").textContent = light ? "暗色" : "亮色";
  renderChart();
  if (state.trend.id) trendRender();
  renderMovers();
}

function applyFilters() {
  let obj = null;
  try { obj = JSON.parse(localStorage.getItem("tk_filters") || "null"); } catch (e) {}
  if (!obj) return;
  if (obj.q) $("search").value = obj.q;
  if (obj.max) $("maxprice").value = obj.max;
  if (obj.sort) $("sort").value = obj.sort;
  if (obj.weights) $("weights").value = obj.weights;
  if (obj.scene) $("scene").value = obj.scene;
  if (obj.currency === "cny") { state.currency = "cny"; $("currency").value = "cny"; }
  if (obj.budget || obj.sort === "budget") { state.budget = true; }
  if (obj.favOnly) { state.favOnly = true; $("fav-toggle").classList.add("active"); }
  if (obj.provider) state.savedProvider = obj.provider;
  if (obj.mov) {
    state.mov.days = obj.mov;
    document.querySelectorAll(".range-btn2").forEach((b) =>
      b.classList.toggle("active", parseInt(b.dataset.days) === obj.mov));
  }
}

function renderProvider() {
  const chips = state.providerChips;
  if (!chips.length) {
    $("stats").innerHTML = "<h2>厂商概览</h2><div class='ps-card'><div class='chip-name'>暂无数据</div></div>";
    return;
  }
  const i = state.pcIndex;
  const c = chips[i];
  const pct = Math.round(((i + 1) / chips.length) * 100);
  const ctx = c.ctx > 0 ? fmtCtx(c.ctx) : "—";
  $("stats").innerHTML = `
    <h2>厂商概览 <small>${i + 1} / ${chips.length}</small></h2>
    <div class="ps-body">
      <button class="pbtn" data-dir="prev">▲</button>
      <div class="ps-card">
        <div class="chip-name">${escapeHtml(c.name)}</div>
        <div class="chip-meta">${c.count} 款 · 最低 <b>${fmtPrice(c.min)}/1M</b> · 平均 ${fmtPrice(c.avg)}/1M · 最大上下文 ${ctx}</div>
      </div>
      <button class="pbtn" data-dir="next">▼</button>
    </div>
    <div class="pbar"><div class="pbar-fill" style="width:${pct}%"></div></div>
    <div class="p-hint">鼠标滚轮上下切换厂商</div>`;
}

function pcMove(steps) {
  if (!state.providerChips.length) return;
  const n = state.providerChips.length;
  state.pcIndex = (state.pcIndex + steps + n) % n;
  renderProvider();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cacheCell(it) {
  if (it.cache_in == null) {
    return `<span class="score-none" data-tip="无缓存命中优惠价，成本按原输入价计">—</span>`;
  }
  return fmtPrice(it.cache_in);
}

function scoreHTML(it) {
  if (it.comp == null) {
    return `<span class="score-none" data-tip="缺少能力指数数据，不参与综合推荐">—</span>`;
  }
  const v = Math.max(0, Math.min(100, it.comp));
  return `<span class="score-cell score-click" data-scoreid="${escapeHtml(it.id)}" data-name="${escapeHtml(it.name)}" title="点击查看明细 · 综合分 ${it.comp.toFixed(1)} / 100（${SCENE_LABEL[state.scene]} · ${WEIGHT_TIP[state.weights]}）">
    <span class="score-bar" style="width:${v}%"></span>${it.comp.toFixed(1)}
  </span>`;
}

function openScoreDetail(id, name) {
  const it = state.items.find((x) => x.id === id);
  if (!it || it.comp == null) return;
  const srcLabel = {
    code: "编程指数", intel: "总体智能指数", agentic: "智能体指数",
  }[it.pf_src] || "未知指数";
  const wTip = WEIGHT_TIP[state.weights];
  $("score-title").textContent = "综合分明细 · " + name.split(" (")[0];
  $("score-body").innerHTML = `
    <div class="sd-total">综合分 <b>${it.comp.toFixed(1)}</b> / 100</div>
    <div class="sd-row"><span>价格分（输入价百分位，越高越便宜）</span><b>${it.ps != null ? it.ps.toFixed(1) : "—"}</b></div>
    <div class="sd-row"><span>能力分（${srcLabel}，${SCENE_LABEL[state.scene]}场景）</span><b>${it.pf != null ? it.pf.toFixed(1) : "—"}</b></div>
    <div class="sd-row"><span>速度分（吞吐名次百分位${it.speed_rank != null ? "，名次 " + it.speed_rank : ""}）</span><b>${it.sp != null ? it.sp.toFixed(1) : "—"}</b></div>
    <div class="sd-row"><span>当前权重</span><b>${WEIGHT_TIP[state.weights]}</b></div>
    <div class="sd-note">综合分 = 加权平均：各维度得分 × 权重之和（缺项按剩余权重重归一化）。价格分/速度分均为 0~100 百分位；能力分为指数原值${it.idx_fallback ? "。部分能力指数为历史缓存值（本次抓取暂无数据时沿用上次结果）" : ""}。</div>`;
  $("score-modal").classList.remove("hidden");
}

function openDetail(id, name) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const srcLabel = {
    code: "编程指数", intel: "总体智能指数", agentic: "智能体指数",
  }[it.pf_src] || "无指数数据";
  const d7 = state.deltas[id];
  const d7Txt = (!d7 || (d7.in_pct == null && d7.out_pct == null))
    ? "近 7 天无价格变动"
    : `${d7.first} → ${d7.last}：` +
      (d7.in_pct != null ? `输入 ${d7.in_pct > 0 ? "▲" : "▼"}${Math.abs(d7.in_pct)}%` : "") +
      (d7.in_pct != null && d7.out_pct != null ? "；" : "") +
      (d7.out_pct != null ? `输出 ${d7.out_pct > 0 ? "▲" : "▼"}${Math.abs(d7.out_pct)}%` : "");
  const row = (label, val) => `<div class="sd-row"><span>${label}</span><b>${val}</b></div>`;
  const fbk = (it.aa_perf ? ` ⚠ 性能数据（tps/首 token 时间）来自 Artificial Analysis 官网公开评测（按模型名匹配补充，数据抓取于 ${state.aaPerfAt ? fmtTime(state.aaPerfAt) : "?"}）` : "") +
    (it.idx_fallback ? ` ⚠ 能力指数为历史缓存值（本次抓取缺失时沿用上次结果，如实披露）` : "");
  $("detail-title").textContent = "模型详情 · " + name.split(" (")[0];
  $("detail-body").innerHTML = `
    <div class="detail-id">${escapeHtml(it.id)}</div>
    ${row(`输入价格 (${sign()}/1M)`, fmtPrice(it.input))}
    ${row(`缓存输入 (${sign()}/1M)`, it.cache_in != null ? fmtPrice(it.cache_in) : "—（无缓存价，按原输入价计）")}
    ${row(`输出价格 (${sign()}/1M)`, fmtPrice(it.output))}
    ${row("上下文长度", fmtCtx(it.context) + (it.context ? `（${it.context.toLocaleString()} tokens）` : ""))}
    ${row("厂商", `<span class="badge">${escapeHtml(it.provider)}</span>`)}
    ${row("近 7 天变动", d7Txt)}
    ${row(`能力指数（总智能/编程/智能体）`, it.intel != null ? `${it.intel} / ${it.code != null ? it.code : "—"} / ${it.agentic != null ? it.agentic : "—"}` : "—")}
    ${row("速度：吞吐名次", it.speed_rank != null ? `${it.speed_rank} 名` : "—")}
    ${row("速度：实测 tps", it.tps != null ? `${Math.round(it.tps)} tokens/s` : "暂无（AA 评测未收录该模型）")}
    ${row("速度：首 token 延迟 ttft", it.ttft != null ? `${Math.round(it.ttft)} ms` : "暂无（AA 评测未收录该模型）")}
    ${row(`能力分（${SCENE_LABEL[state.scene]} · 用${srcLabel}）`, it.pf != null ? it.pf.toFixed(1) : "—（无指数，综合分不参与）")}
    ${row("价格分（输入价百分位）", it.ps != null ? it.ps.toFixed(1) : "—")}
    ${row("速度分（吞吐名次百分位）", it.sp != null ? it.sp.toFixed(1) : "—")}
    ${row(`综合分（${WEIGHT_LABEL[state.weights]}）`, it.comp != null ? it.comp.toFixed(1) : "不参与综合评分")}
    ${row("更新时间", fmtTime(it.updated))}
    <div class="sd-note">价格来自 OpenRouter 公开数据；能力指数原值来自 Artificial Analysis（指数缺失时沿用上次缓存）。tps/ttft 曾由 OpenRouter API 提供，2026 年 API 改版后已不再返回，现改由 Artificial Analysis 官网公开评测数据按模型名匹配补充（未收录模型如实显示"暂无"）；速度维度仍使用吞吐名次（百分位）。</div>${fbk}`;
  $("detail-modal").classList.remove("hidden");
}

function setRate(v) {
  const n = parseFloat(v);
  if (!(n > 0)) return;
  state.rate = n;
  localStorage.setItem("tk_rate", String(n));
  renderTable();
  renderChart();
  renderMeta({ count: state.items.length, updated: state.updated, errors: [] });
  renderProvider();
  renderMovers();
}

function syncRateUI() {
  const on = state.currency === "cny";
  $("rate").disabled = !on;
  $("rate-auto").disabled = !on;
  $("rate").placeholder = on ? "汇率 1$=?¥" : "人民币模式下可用";
  if (on && state.rate !== CNY_DEFAULT) $("rate").value = state.rate;
}

async function autoRate(silent) {
  const btn = $("rate-auto");
  const old = btn.textContent;
  if (!silent) {
    btn.textContent = "获取中…";
    btn.disabled = true;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    const cny = data && data.rates && data.rates.CNY;
    if (!(cny > 0)) throw new Error("no rate");
    $("rate").value = cny.toFixed(2);
    setRate(cny);
  } catch (e) {
    if (!silent) alert("自动获取汇率失败（可能被网络拦截），请手动输入最新汇率。当前：" + state.rate);
  } finally {
    if (!silent) {
      btn.textContent = old;
      btn.disabled = false;
    }
  }
}

function csvSafe(s) {
  const t = String(s == null ? "" : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function exportCSV() {
  const { rows, useCost } = buildRows();
  const lines = [["排名", "模型", "模型ID", "厂商", `输入(${sign()}/M)`, useCost ? `月成本(${sign()})` : `缓存输入(${sign()}/M)`, `输出(${sign()}/M)`, "上下文", "tps", "综合分", "价格分", "能力分", "速度分", "吞吐名次", "更新时间"]];
  rows.forEach(({ i: it }, idx) => {
    lines.push([
      idx + 1,
      csvSafe(it.name),
      csvSafe(it.id),
      csvSafe(it.provider),
      fmtPrice(it.input),
      useCost ? sign() + (monthlyCost(it) * rate()).toFixed(2) : (it.cache_in != null ? fmtPrice(it.cache_in) : ""),
      fmtPrice(it.output),
      it.context || "",
      it.tps != null ? Math.round(it.tps) : "",
      it.comp != null ? it.comp : "",
      it.ps != null ? it.ps : "",
      it.pf != null ? it.pf : "",
      it.sp != null ? it.sp : "",
      it.speed_rank != null ? it.speed_rank : "",
      it.updated,
    ]);
  });
  const csv = "\uFEFF" + lines.map((row) =>
    row.map((c) => {
      const s = String(c == null ? "" : c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `llm-token-rank-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportTrendCSV() {
  const ids = state.trend.multi && state.trend.multi.length
    ? state.trend.multi
    : (state.trend.id ? [state.trend.id] : []);
  if (!ids.length) return;
  const days = state.trend.range;
  const lines = [["模型", "模型ID", "日期", "输入价($/M)", "输出价($/M)"]];
  for (const id of ids) {
    try {
      const res = state.staticMode
        ? getHistoryLocal(id, days)
        : await (await fetch(`/api/history?model=${encodeURIComponent(id)}&days=${days}`)).json();
      const name = (state.items.find((x) => x.id === id) || {}).name || id;
      (res.points || []).forEach((p) => {
        lines.push([csvSafe(String(name).split(" (")[0]), csvSafe(id), p.date,
          p.input != null ? p.input : "", p.output != null ? p.output : ""]);
      });
    } catch (e) {}
  }
  if (lines.length === 1) {
    alert("该模型暂无历史数据，无法导出");
    return;
  }
  const csv = "\uFEFF" + lines.map((r) =>
    r.map((c) => {
      const s = String(c == null ? "" : c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trend-${new Date().toISOString().slice(0, 10)}-${days}d.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function deltaBadgeHTML(id, isOutput) {
  const d = state.deltas[id];
  if (!d) return "";
  const pct = isOutput ? d.out_pct : d.in_pct;
  if (pct == null || pct === 0) return "";
  const cls = pct > 0 ? "up" : "down";
  const arrow = pct > 0 ? "▲" : "▼";
  const first = isOutput ? d.out_first : d.in_first;
  const last = isOutput ? d.out_last : d.in_last;
  return ` <span class="delta ${cls}" title="${first} → ${last}" data-tip="近 7 天${isOutput ? "输出" : "输入"}价变动：$${first}/1M → $${last}/1M">${arrow}${Math.abs(pct)}%</span>`;
}

async function openTrend(id, name) {
  state.trend.multi = null;
  state.trend.id = id;
  state.trend.modelName = name;
  $("trend-title").textContent = "价格趋势 · " + name.split(" (")[0];
  $("trend-modal").classList.remove("hidden");
  await trendRender();
}

async function openTrendMulti() {
  const sel = state.compare
    .map((id) => state.items.find((x) => x.id === id))
    .filter(Boolean)
    .slice(0, 4);
  if (sel.length < 2) {
    alert("至少勾选 2 个模型才能进行走势对比（一次最多 4 个）");
    return;
  }
  state.trend.multi = sel;
  state.trend.id = null;
  state.trend.modelName = "";
  $("trend-title").textContent = "价格趋势对比（" + sel.length + " 个模型）";
  $("trend-modal").classList.remove("hidden");
  await trendRender();
}

async function trendRender() {
  const cc = chartColors();
  const days = state.trend.range;
  const body = $("trend-body");
  const multi = state.trend.multi || [];
  let dataList = [];
  if (multi.length) {
    for (const it of multi) {
      try {
        const res = state.staticMode
          ? getHistoryLocal(it.id, days)
          : await (await fetch(`/api/history?model=${encodeURIComponent(it.id)}&days=${days}`)).json();
        dataList.push({ it, pts: (res.points || []).filter((p) => p.date && p.input != null) });
      } catch (e) {
        dataList.push({ it, pts: [] });
      }
    }
  } else {
    const res = state.staticMode
      ? getHistoryLocal(state.trend.id, days)
      : await (await fetch(`/api/history?model=${encodeURIComponent(state.trend.id)}&days=${days}`)).json();
    dataList.push({ it: state.items.find((x) => x.id === state.trend.id), pts: (res.points || []).filter((p) => p.date && p.input != null) });
  }
  const any = dataList.some((d) => d.pts.length >= 2);
  if (any) {
    body.innerHTML = `<canvas id="trend-chart"></canvas>`;
    if (state.trend.chart) state.trend.chart.destroy();
    const r = rate();
    const colors = ["#38bdf8", "#fbbf24", "#34d399", "#f472b6"];
    const datasets = [];
    dataList.forEach((d, di) => {
      if (d.pts.length < 2) return;
      const base = colors[di % colors.length];
      datasets.push({
        label: (d.it ? d.it.name.split(" (")[0] : "模型") + " 输入",
        data: d.pts.map((p) => p.input * r), borderColor: base,
        backgroundColor: base + "33", tension: .3, borderDash: [],
      });
      datasets.push({
        label: (d.it ? d.it.name.split(" (")[0] : "模型") + " 输出",
        data: d.pts.map((p) => p.output * r), borderColor: base,
        backgroundColor: "transparent", tension: .3, borderDash: [5, 5],
      });
    });
    state.trend.chart = new Chart($("trend-chart"), {
      type: "line",
      data: { labels: dataList.map((d) => d.pts.map((p) => p.date)).sort((a, b) => a.length - b.length).pop() || [], datasets },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: cc.tick, boxWidth: 16, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: cc.tick, maxTicksLimit: 10 }, grid: { color: cc.grid } },
          y: { ticks: { color: cc.tick }, grid: { color: cc.grid }, title: { display: true, text: `${sign()} / 1M tokens`, color: "#94a3b8" } },
        },
      },
    });
    return;
  }
  const cur = multi.length ? null : state.items.find((x) => x.id === state.trend.id);
  const curTxt = multi.length
    ? dataList.map((d) => `${d.it ? d.it.name.split(" (")[0] : ""} ${d.pts.length} 点`).join("，")
    : cur
      ? `当前价格：输入 ${fmtPrice(cur.input)} / 输出 ${fmtPrice(cur.output)}`
      : "该模型当前不在榜单中";
  body.innerHTML = `<div class="trend-empty">
      <div>${curTxt}</div>
      <div>历史记录已积累 <b>${dataList[0] ? dataList[0].pts.length : 0}</b> 个数据点（近 ${days} 天）。</div>
      <div>每 6 小时自动记录一次按日快照，≥2 个点后即可显示价格走势折线图。</div>
    </div>`;
}

function closeTrend() {
  $("trend-modal").classList.add("hidden");
  if (state.trend.chart) { state.trend.chart.destroy(); state.trend.chart = null; }
}

async function manualRefresh() {
  if (state.staticMode) {
    alert("静态版数据由 GitHub Actions 定时更新（每 6 小时自动爬取）。\n如需立即更新，请到 Actions 页面手动触发 workflow。");
    window.open("https://github.com/USER/token_rank/actions/workflows/update-data.yml", "_blank");
    return;
  }
  setLoading(true);
  try {
    await fetch("/api/refresh", { method: "POST" });
    await loadData();
  } finally {
    setLoading(false);
  }
}

function initProviders() {
  state.providers.forEach((p) => {
    const op = document.createElement("option");
    op.value = op.textContent = p;
    $("provider").appendChild(op);
  });
}

const MAX_CMP = 6;

function toggleCmp(id, cb) {
  const i = state.compare.indexOf(id);
  if (i >= 0) {
    state.compare.splice(i, 1);
  } else if (state.compare.length >= MAX_CMP) {
    if (cb) cb.checked = false;
    $("cmp-count").textContent = `最多选 ${MAX_CMP} 个`;
    return;
  } else {
    state.compare.push(id);
  }
  updateCmpBar();
}

function toggleFav(id) {
  const i = state.favs.indexOf(id);
  if (i >= 0) state.favs.splice(i, 1);
  else state.favs.push(id);
  saveFavs();
  renderTable();
}

function maybeFavAlert() {
  const box = $("fav-alert");
  if (!box || !state.favs.length) return;
  if (sessionStorage.getItem("tk_fav_close")) return;
  const hits = [];
  state.favs.forEach((id) => {
    const d = state.deltas[id];
    if (!d) return;
    if (d.in_pct != null && d.in_pct < 0) {
      hits.push({ id, kind: "输入价", pct: d.in_pct, first: d.in_first, last: d.in_last });
    }
    if (d.out_pct != null && d.out_pct < 0) {
      hits.push({ id, kind: "输出价", pct: d.out_pct, first: d.out_first, last: d.out_last });
    }
  });
  if (!hits.length) return;
  hits.sort((a, b) => a.pct - b.pct);
  const hit = hits[0];
  const it = state.items.find((x) => x.id === hit.id);
  const name = it ? it.name.split(" (")[0] : hit.id;
  box.innerHTML = `近 7 天你收藏的 <b>${escapeHtml(name)}</b> ${hit.kind}降价 <b class="fav-alert-good">${Math.abs(hit.pct)}%</b>（${fmtPrice(hit.first)} → ${fmtPrice(hit.last)}）<button class="fav-alert-x" id="fav-alert-x" title="关闭">×</button>`;
  box.classList.remove("hidden");
  box.onclick = (e) => {
    if (e.target.id === "fav-alert-x") {
      box.classList.add("hidden");
      try { sessionStorage.setItem("tk_fav_close", "1"); } catch (e2) {}
      return;
    }
    $("search").value = String(name).split(" ")[0] || name;
    loadData();
    box.classList.add("hidden");
  };
}

const GUIDE_KEY = "tk_guide_v25";

function guideShow(force) {
  const ov = $("guide");
  if (!ov) return;
  if (!force && localStorage.getItem(GUIDE_KEY)) return;
  const steps = ov.querySelectorAll(".guide-step");
  const dots = $("guide-dots");
  const prev = $("guide-prev");
  const next = $("guide-next");
  const close = $("guide-close");
  let step = 1;
  const total = steps.length;
  dots.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const d = document.createElement("span");
    d.className = "g-dot" + (i === 0 ? " active" : "");
    dots.appendChild(d);
  }
  ov.addEventListener("click", (e) => e.stopPropagation());
  const render = () => {
    steps.forEach((s) => s.classList.toggle("active", +s.dataset.step === step));
    dots.querySelectorAll(".g-dot").forEach((d, i) => d.classList.toggle("active", i === step - 1));
    prev.disabled = step === 1;
    next.textContent = step === total ? "开始使用" : "下一步";
  };
  prev.onclick = () => { if (step > 1) { step--; render(); } };
  next.onclick = () => {
    if (step < total) { step++; render(); }
    else guideDone();
  };
  close.onclick = guideDone;
  ov.classList.remove("hidden");
  render();
}

function guideDone() {
  try { localStorage.setItem(GUIDE_KEY, "1"); } catch (e) {}
  $("guide").classList.add("hidden");
}

function updateCmpBar() {
  const n = state.compare.length;
  $("cmp-bar").classList.toggle("hidden", n === 0);
  $("cmp-count").textContent = `已选 ${n} 个`;
}

function clearCmp() {
  state.compare = [];
  updateCmpBar();
  document.querySelectorAll(".cmp-cb").forEach((cb) => (cb.checked = false));
}

function openCompare() {
  const sel = state.compare
    .map((id) => state.items.find((x) => x.id === id))
    .filter(Boolean);
  if (!sel.length) return;
  $("cmp-title").textContent = `模型对比（${sel.length} 个）`;
  const th = `<th>模型</th>` + sel.map((it) =>
    `<th><a class="model-link" href="https://openrouter.ai/${encodeURIComponent(it.id)}" target="_blank" rel="noopener" title="${escapeHtml(it.id)}">${escapeHtml(it.name.split(" (")[0])}</a></th>`).join("");
  const row = (label, fn, cls) => {
    const kl = cls ? ` class="${cls}"` : "";
    return `<tr${kl}><td class="cmp-field">${label}</td>` + sel.map((x) => `<td data-label="${escapeHtml(label)}">${fn(x)}</td>`).join("") + "</tr>";
  };
  const idxSrc = `能力指数(${SCENE_LABEL[state.scene]})`;
  $("cmp-body").innerHTML = `<div class="cmp-scroll"><table id="cmp-table">
    <thead><tr>${th}</tr></thead>
    <tbody>
      ${row("模型", (x) => `<a class="model-link" href="https://openrouter.ai/${encodeURIComponent(x.id)}" target="_blank" rel="noopener" title="${escapeHtml(x.id)}">${escapeHtml(x.name.split(" (")[0])}</a>`, "m-only")}
      ${row("厂商", (x) => `<span class="badge">${escapeHtml(x.provider)}</span>`)}
      ${row(`输入 (${sign()}/1M)`, (x) => fmtPrice(x.input))}
      ${row(`缓存输入 (${sign()}/1M)`, (x) => x.cache_in != null ? fmtPrice(x.cache_in) : `<span class="score-none">—</span>`)}
      ${row(`输出 (${sign()}/1M)`, (x) => fmtPrice(x.output))}
      ${row("上下文", (x) => fmtCtx(x.context))}
      ${row(idxSrc, (x) => x.pf != null ? x.pf.toFixed(1) : `<span class="score-none">—</span>`)}
      ${row("能力指数（总智能/编程/智能体）", (x) => x.intel != null ? `${x.intel} / ${x.code != null ? x.code : "—"} / ${x.agentic != null ? x.agentic : "—"}` : `<span class="score-none">—</span>`)}
      ${row("tps（AA 评测输出速度）", (x) => x.tps != null ? Math.round(x.tps) : `<span class="score-none">—</span>`)}
      ${row("ttft（首 token，ms）", (x) => x.ttft != null ? Math.round(x.ttft) : `<span class="score-none">—</span>`)}
      ${row("速度分（百分位）", (x) => x.sp != null ? x.sp.toFixed(1) : `<span class="score-none">—</span>`)}
      ${row(`综合分(${WEIGHT_LABEL[state.weights]}/${SCENE_LABEL[state.scene]})`, (x) => x.comp != null ? x.comp.toFixed(1) : `<span class="score-none">—</span>`)}
      ${row("更新时间", (x) => fmtTime(x.updated))}
    </tbody>
  </table></div>`;
  $("cmp-modal").classList.remove("hidden");
}

document.addEventListener("change", (e) => {
  const cb = e.target.closest(".cmp-cb");
  if (cb) {
    toggleCmp(cb.dataset.id, cb);
    return;
  }
});

document.addEventListener("click", (e) => {
  const sc = e.target.closest(".score-click");
  if (sc) {
    openScoreDetail(sc.dataset.scoreid, sc.dataset.name);
    return;
  }
  const favBtn = e.target.closest(".fav-btn");
  if (favBtn) {
    toggleFav(favBtn.dataset.fav);
    return;
  }
  const favToggle = e.target.closest("#fav-toggle");
  if (favToggle) {
    state.favOnly = !state.favOnly;
    favToggle.classList.toggle("active", state.favOnly);
    renderTable();
    renderChart();
    saveStateToURL();
    return;
  }
  const cmpTrendBtn = e.target.closest("#cmp-trend");
  if (cmpTrendBtn) {
    openTrendMulti();
    return;
  }
  const mk = e.target.closest(".mv-kind");
  if (mk) {
    state.movKind = mk.dataset.kind;
    document.querySelectorAll(".mv-kind").forEach((b) =>
      b.classList.toggle("active", b.dataset.kind === state.movKind));
    renderMovers();
    return;
  }
  const cmpOpen = e.target.closest("#cmp-open");
  if (cmpOpen) {
    openCompare();
    return;
  }
  const cmpClear = e.target.closest("#cmp-clear");
  if (cmpClear) {
    clearCmp();
    return;
  }
  if (e.target.id === "score-close") { $("score-modal").classList.add("hidden"); return; }
  if (e.target.id === "cmp-close") { $("cmp-modal").classList.add("hidden"); return; }
  if (e.target.closest("#rate-auto")) { autoRate(); return; }
  if (e.target.closest("#export")) { exportCSV(); return; }
  const rb = e.target.closest(".range-btn2");
  if (rb) {
    setMoversRange(parseInt(rb.dataset.days));
    return;
  }
  const mvRow = e.target.closest("#movers tbody tr[data-trend]");
  if (mvRow) {
    openTrend(mvRow.dataset.trend, mvRow.dataset.name);
    return;
  }
  const pbtn = e.target.closest(".pbtn");
  if (pbtn) {
    pcMove(pbtn.dataset.dir === "next" ? 1 : -1);
    return;
  }
  const trend = e.target.closest(".trend-btn");
  if (trend) {
    openTrend(trend.dataset.trend, trend.dataset.name);
    return;
  }
  const infoBtn = e.target.closest(".info-btn");
  if (infoBtn) {
    const it = state.items.find((x) => x.id === infoBtn.dataset.info);
    openDetail(infoBtn.dataset.info, it ? it.name : infoBtn.dataset.info);
    return;
  }
  if (e.target.closest("#trend-export")) { exportTrendCSV(); return; }
  if (e.target.id === "trend-modal") { closeTrend(); return; }
  if (["score-modal", "detail-modal", "cmp-modal"].includes(e.target.id)) {
    e.target.classList.add("hidden");
    return;
  }
  if (e.target.id === "detail-close") { $("detail-modal").classList.add("hidden"); return; }
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(id).then(() => {
      const old = btn.textContent;
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = old), 1200);
    });
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  guideShow();
  applyFilters();
  applyStateFromURL();
  $("theme").addEventListener("click", toggleTheme);
  const gr = $("guide-reopen");
  if (gr) gr.addEventListener("click", () => guideShow(true));
  if ((localStorage.getItem("tk_theme") || "dark") === "light") {
    document.body.classList.add("light");
    $("theme").textContent = "暗色";
  }
  $("search").addEventListener("input", debounce(loadData, 300));
  $("provider").addEventListener("change", loadData);
  $("maxprice").addEventListener("change", loadData);
  $("sort").addEventListener("change", () => {
    state.budget = $("sort").value === "budget";
    loadData();
  });
  $("min-tps").addEventListener("input", (e) => {
    state.minTps = parseInt(e.target.value, 10) || 0;
    renderTable();
    renderChart();
    renderMeta({ count: state.items.length, updated: state.updated, errors: [] });
    saveStateToURL();
  });
  $("weights").addEventListener("change", () => { loadData(); });
  $("scene").addEventListener("change", () => { loadData(); });
  $("currency").addEventListener("change", (e) => {
    state.currency = e.target.value;
    renderTable();
    renderChart();
    renderMeta({ count: state.items.length, updated: state.updated, errors: [] });
    renderProvider();
    renderMovers();
    syncRateUI();
    saveFilters();
  });
  $("rate").addEventListener("change", () => setRate($("rate").value));
  syncRateUI();
  if ($("currency").value === "cny" && state.rate !== CNY_DEFAULT) {
    $("rate").value = state.rate;
  }
  $("refresh").addEventListener("click", manualRefresh);
  $("est-btn").addEventListener("click", runEstimate);
  $("inM").addEventListener("keydown", (e) => { if (e.key === "Enter") runEstimate(); });
  $("outM").addEventListener("keydown", (e) => { if (e.key === "Enter") runEstimate(); });
  $("cachePct").addEventListener("keydown", (e) => { if (e.key === "Enter") runEstimate(); });
  $("modal-close").addEventListener("click", closeTrend);
  const setRange = (days) => {
    state.trend.range = days;
    $("range-7").classList.toggle("active", days === 7);
    $("range-30").classList.toggle("active", days === 30);
    if (state.trend.id) trendRender();
  };
  $("range-7").addEventListener("click", () => setRange(7));
  $("range-30").addEventListener("click", () => setRange(30));
  $("stats").addEventListener("wheel", (e) => {
    if (!state.providerChips.length) return;
    e.preventDefault();
    pcMove(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  $("mv-moved").addEventListener("change", renderMovers);
  window.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    if (!typing && e.key === "/") {
      e.preventDefault();
      $("search").focus();
      return;
    }
    if (e.key !== "Escape") return;
    if (!$("trend-modal").classList.contains("hidden")) closeTrend();
    else if (!$("score-modal").classList.contains("hidden")) $("score-modal").classList.add("hidden");
    else if (!$("detail-modal").classList.contains("hidden")) $("detail-modal").classList.add("hidden");
    else if (!$("cmp-modal").classList.contains("hidden")) $("cmp-modal").classList.add("hidden");
  });
  await loadData();
  autoRate(true);
  initProviders();
  if (state.savedProvider) {
    const sp = state.savedProvider;
    delete state.savedProvider;
    if (state.providers.includes(sp)) {
      $("provider").value = sp;
      loadData();
    }
  }
  setInterval(() => { if (document.visibilityState === "visible") loadData(); }, 5 * 60 * 1000);
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), ms); };
}