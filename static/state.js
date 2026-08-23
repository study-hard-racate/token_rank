/* ============================================================
 * state.js — 常量定义、状态对象与工具函数
 * ============================================================
 * 包含：常量、state 对象、DOM 引用、格式化、图表颜色、
 *       收藏读写、CSV 转义、防抖、HTML 转义
 * ============================================================ */

// ============================================================
// [1] 常量与状态定义
// ============================================================
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

// ============================================================
// [2] 工具函数
// ============================================================
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

function csvSafe(s) {
  const t = String(s == null ? "" : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), ms); };
}
