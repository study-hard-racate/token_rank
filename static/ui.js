/* ============================================================
 * ui.js — UI 渲染
 * ============================================================
 * 包含：setLoading、renderMeta、buildRows、renderTable、
 *       renderChart、renderMovers、setMoversRange、renderStats、
 *       renderHistProg、renderProvider、pcMove、fillProviders、
 *       cacheCell、scoreHTML、deltaBadgeHTML、renderLoadError、
 *       monthlyCost
 * ============================================================ */

function monthlyCost(it) {
  const { inM, outM } = state.estimate || {};
  const pct = ((state.estimate && state.estimate.cachePct) || 0) / 100;
  const cin = (it.cache_in != null ? it.cache_in : it.input) || 0;
  return (it.input || 0) * (1 - pct) * (inM || 0)
    + cin * pct * (inM || 0)
    + (it.output || 0) * (outM || 0);
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

// ============================================================
// [5] 表格渲染
// ============================================================
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

// ============================================================
// [6] 图表渲染
// ============================================================
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

// ============================================================
// 价格变动榜渲染
// ============================================================
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

// ============================================================
// [8] 厂商概览与历史进度
// ============================================================
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
      if (state.providerChips && state.providerChips.length) renderProvider();
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
    ? (state.staticMode
      ? ` <span class="hist-warn">⚠ 数据较旧（最后更新 ${fmtTime(hist.updated)}）——由 GitHub Actions 定时更新，稍后刷新查看</span>`
      : ` <span class="hist-warn">⚠ 历史快照已中断 ${hist.gap_days} 天（最后 ${hist.last}）——免费层无定时任务，请每天访问一次页面续记历史</span>`)
    : "";
  const gapsWarn = state.staticMode && hist.gaps > 0
    ? ` <span class="hist-warn" title="如 08-13 这类日期无任何数据源运行（如实保留空缺，不补造）">⚠ 历史记录有 ${hist.gaps} 天空缺（当日数据源未运行）</span>`
    : "";
  box.innerHTML = `<div class="hist-track"><div class="hist-fill" style="width:${pct}%"></div></div>
    <span class="hist-note">${note}</span>${gap}${gapsWarn}`;
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
  if (!state.providerChips || !state.providerChips.length) return;
  const n = state.providerChips.length;
  state.pcIndex = (state.pcIndex + steps + n) % n;
  renderProvider();
}

let _providersKey = "";

function fillProviders() {
  const key = state.providers.join("|");
  if (key === _providersKey) return;
  _providersKey = key;
  const sel = $("provider");
  const cur = sel.value;
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部厂商";
  sel.appendChild(all);
  state.providers.forEach((p) => {
    const op = document.createElement("option");
    op.value = op.textContent = p;
    sel.appendChild(op);
  });
  if (cur && state.providers.includes(cur)) sel.value = cur;
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

function renderLoadError() {
  const tbody = document.querySelector("#rank tbody");
  if (tbody && !state.items.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="loading-cell">加载失败（可能处于离线或服务器繁忙）。请点击「立即刷新」重试，或稍后访问。</td></tr>`;
  }
  $("meta").innerHTML = ` <span class="err">⚠ 数据加载失败（${(state.loadError && state.loadError.message) || "网络错误"}）。数据仍停留在上次成功结果。</span>`;
}
