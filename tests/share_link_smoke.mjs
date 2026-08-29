// share-link 按钮冒烟测试（无头 Node）：加载真实 static/app.js，
// 用最小 DOM 桩执行，模拟点击 #share-link，断言剪贴板收到含当前筛选参数的 URL。
// 运行：node tests/share_link_smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appSrc = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
const utilsSrc = fs.readFileSync(path.join(root, "static", "utils.js"), "utf8");

const elements = {};
const clickHandlers = [];

function makeEl(id) {
  return {
    id,
    textContent: "",
    value: "",
    className: "",
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    select() {},
    appendChild() {},
    removeChild() {},
  };
}

globalThis.$ = (id) => elements[id] || (elements[id] = makeEl(id));
globalThis.document = {
  getElementById: (id) => globalThis.$(id),
  querySelector: () => makeEl("q"),
  body: { classList: { contains: () => false }, appendChild() {}, removeChild() {} },
  createElement: () => makeEl("ta"),
  addEventListener: (type, fn) => { if (type === "click") clickHandlers.push(fn); },
  execCommand: (cmd) => { if (cmd === "copy") globalThis.__execCopied = true; return true; },
};
globalThis.window = { isSecureContext: true, addEventListener() {}, matchMedia: () => ({ matches: false }) };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async (t) => { globalThis.__copied = t; } } },
});
globalThis.location = { href: "https://example.com/token_rank/?q=deep", search: "?q=deep", pathname: "/token_rank/" };
globalThis.history = { replaceState: () => {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.AbortSignal = { timeout: () => ({}) };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
globalThis.setInterval = () => 0;
// 注意：不桩 setTimeout——测试需要真实定时器；app.js 里的延迟反馈回调在进程退出前无害
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

eval(utilsSrc); // 提供 escapeHtml 等纯函数（$ 已由上面定义，utils 内 const $ 会重定义——用 var 语义容错）
eval(appSrc);

// 构造 #share-link 按钮并设置当前筛选状态
const btn = globalThis.$("share-link");
btn.textContent = "分享链接";
globalThis.$("search").value = "deep";
globalThis.$("provider").value = "";
globalThis.$("maxprice").value = "";
globalThis.$("sort").value = "input";
globalThis.$("weights").value = "balanced";
globalThis.$("scene").value = "general";
globalThis.$("min-tps").value = "";

const fakeEvent = {
  target: btn,
  preventDefault() {},
};
// target.closest：模拟按钮自身匹配 #share-link，其他选择器不匹配
btn.closest = (sel) => (sel === "#share-link" ? btn : null);

for (const h of clickHandlers) h(fakeEvent);

await new Promise((r) => setTimeout(r, 50)); // 等 clipboard promise

const copied = globalThis.__copied || "";
if (typeof copied === "string" && copied.includes("/token_rank/") && copied.includes("q=deep")) {
  console.log("PASS[安全上下文]: 点击分享链接 → 剪贴板 =", copied);
  console.log("PASS[安全上下文]: 按钮反馈 =", JSON.stringify(btn.textContent));
} else {
  console.error("FAIL[安全上下文]: 剪贴板未收到预期 URL，实际 =", JSON.stringify(copied));
  process.exit(1);
}

// ---- 场景 B：非安全上下文（如 http://127.0.0.1）走 execCommand 降级 ----
globalThis.window.isSecureContext = false;
globalThis.__execCopied = false;
btn.textContent = "分享链接";
for (const h of clickHandlers) h(fakeEvent);
await new Promise((r) => setTimeout(r, 20));
if (globalThis.__execCopied) {
  console.log("PASS[降级路径]: isSecureContext=false 时走 document.execCommand 复制");
  console.log("PASS[降级路径]: 按钮反馈 =", JSON.stringify(btn.textContent));
} else {
  console.error("FAIL[降级路径]: execCommand 未被执行");
  process.exit(1);
}

console.log("ALL PASS");
process.exit(0);
