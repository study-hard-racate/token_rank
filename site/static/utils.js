// utils.js —— 纯工具函数（无 state / DOM 副作用，除 $ 外均为纯函数）。
// 在 app.js 之前以普通 script 加载，函数挂在全局作用域供 app.js 复用。
// 说明：完整 ES module 拆分因 app.js 大量函数通过共享 state 与全局 helper 强耦合、
// 且该站点已在部署，回归风险高（此前一次拆分曾损坏该文件），故仅拆分本纯工具层。

const $ = (id) => document.getElementById(id);

function fmtCtx(n) {
  if (!(n > 0)) return "—";
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n >= 1000 ? (n / 1000).toFixed(0) + "K" : String(n));
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function chartLabel(n) {
  const t = String(n || "").split(" (")[0];
  return t.length > 12 ? t.slice(0, 12) + "…" : t;
}

function csvSafe(s) {
  const t = String(s == null ? "" : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), ms); };
}
