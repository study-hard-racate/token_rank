/* ============================================================
 * api.js — 数据加载（API 模式 / 静态模式）
 * ============================================================
 * 包含：detectStatic、loadData、loadDataStatic、loadMovers、
 *       manualRefresh 等数据获取与刷新逻辑
 * ============================================================ */

// ============================================================
// [3] 数据加载（API 模式 / 静态模式）
// ============================================================
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
    fillProviders();
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
  if (location.hostname.endsWith("github.io") || location.pathname.indexOf("/token_rank") === 0) {
    state.staticMode = true;
    return true;
  }
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
      o.pf = o.pf_v;
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
    fillProviders();
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

// ============================================================
// [4] 价格变动榜（Movers）
// ============================================================
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

async function manualRefresh() {
  if (state.staticMode) {
    alert("静态版数据由 GitHub Actions 定时更新（每 6 小时自动爬取）。\n如需立即更新，请到 Actions 页面手动触发 workflow。");
    window.open("https://github.com/study-hard-racate/token_rank/actions/workflows/update-data.yml", "_blank");
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
