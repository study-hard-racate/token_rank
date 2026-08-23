/* ============================================================
 * app.js — 主入口：事件监听与初始化
 * ============================================================
 * 加载顺序：state.js → api.js → ui.js → modals.js → features.js → app.js
 * 本文件仅包含 DOMContentLoaded 事件监听器和所有事件绑定。
 * ============================================================ */

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
  } else if (!localStorage.getItem("tk_theme") && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    document.body.classList.add("light");
    $("theme").textContent = "暗色";
  }
  $("search").addEventListener("input", debounce(loadData, 200));
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
  $("share-link").addEventListener("click", () => {
    saveStateToURL();
    const url = location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        const btn = $("share-link");
        const old = btn.textContent;
        btn.textContent = "已复制 ✓";
        setTimeout(() => (btn.textContent = old), 1500);
      });
    } else {
      prompt("复制当前链接：", url);
    }
  });
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
    if (!state.providerChips || !state.providerChips.length) return;
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
