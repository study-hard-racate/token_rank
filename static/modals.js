/* ============================================================
 * modals.js — 弹窗功能（趋势/详情/对比）
 * ============================================================
 * 包含：openTrend、openTrendMulti、trendRender、closeTrend、
 *       openDetail、openScoreDetail、openCompare、updateCmpBar、
 *       clearCmp
 * ============================================================ */

// ============================================================
// [10] 弹窗：价格趋势 / 模型详情 / 综合分明细 / 模型对比
// ============================================================
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
    const allDates = [...new Set(dataList.flatMap((d) => d.pts.map((p) => p.date)))].sort();
    const datasets = [];
    dataList.forEach((d, di) => {
      if (d.pts.length < 2) return;
      const byDate = {};
      d.pts.forEach((p) => { byDate[p.date] = p; });
      const base = colors[di % colors.length];
      const series = (key) => allDates.map((date) => (byDate[date] ? byDate[date][key] * r : null));
      datasets.push({
        label: (d.it ? d.it.name.split(" (")[0] : "模型") + " 输入",
        data: series("input"), borderColor: base,
        backgroundColor: base + "33", tension: .3, borderDash: [], spanGaps: true,
      });
      datasets.push({
        label: (d.it ? d.it.name.split(" (")[0] : "模型") + " 输出",
        data: series("output"), borderColor: base,
        backgroundColor: "transparent", tension: .3, borderDash: [5, 5], spanGaps: true,
      });
    });
    state.trend.chart = new Chart($("trend-chart"), {
      type: "line",
      data: { labels: allDates, datasets },
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
  const officialNote = it.official_price
    ? `<div class="sd-note">⚠ 本模型价格为 DeepSeek 官方定价（官方页 off-peak 档，$/100 万 tokens），已覆盖 OpenRouter 报价。</div>` : "";
  $("detail-title").textContent = "模型详情 · " + name.split(" (")[0];
  $("detail-body").innerHTML = `
    ${officialNote}
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
