/* ============================================================
 * features.js — 筛选、估算、导出、货币、状态管理等功能
 * ============================================================
 * 包含：calcComp、filterItemsStatic、histDeltasLocal、
 *       lowMapLocal、getHistoryLocal、histStatsLocal、
 *       summaryLocal、runEstimate、exportCSV、exportTrendCSV、
 *       setRate、syncRateUI、autoRate、saveFilters、
 *       saveStateToURL、applyStateFromURL、toggleTheme、
 *       applyFilters、toggleFav、maybeFavAlert、guideShow、
 *       guideDone
 * ============================================================ */

// ============================================================
// 计算综合分
// ============================================================
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

// ============================================================
// 历史数据本地处理
// ============================================================
function histDeltasLocal(days) {
  const out = {};
  const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  for (const [mid, entries] of Object.entries(state.histData || {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    const pts = entries.filter((e) => e.date >= cutoff);
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
  const all = (state.histData || {})[id];
  const entries = Array.isArray(all) ? all : [];
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
  let gaps = 0;
  if (first && last) {
    const end = new Date(last + "T00:00:00Z").getTime();
    let cur = new Date(first + "T00:00:00Z").getTime();
    while (cur < end) {
      cur += 86400000;
      if (!dates.has(new Date(cur).toISOString().slice(0, 10))) gaps += 1;
    }
  }
  let gapDays = 0;
  if (last) {
    gapDays = Math.max(0, Math.floor((new Date(new Date().toISOString().slice(0, 10)) - new Date(last)) / 86400000));
  }
  return { days: ds.length, models, points, first, last, gap_days: gapDays, gaps };
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
  const h = histStatsLocal();
  if (state.staticMode) {
    const lastUpd = state.updated ? new Date(state.updated).getTime() : 0;
    const stale = !lastUpd || Date.now() - lastUpd > 12 * 3600 * 1000;
    h.gap_days = stale ? 1 : 0;
    h.stale = stale;
    h.updated = state.updated;
  }
  return { total_models: state.allItems.length, providers: stats, history: h };
}

// ============================================================
// [7] 成本估算器
// ============================================================
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

// ============================================================
// [12] CSV 导出
// ============================================================
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

// ============================================================
// [11] 货币与汇率
// ============================================================
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

// ============================================================
// [9] 筛选器与 URL 状态管理
// ============================================================
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

// ============================================================
// [13] 收藏与新手引导
// ============================================================
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
