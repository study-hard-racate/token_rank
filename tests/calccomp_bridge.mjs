// 对拍桥接：从真实 static/app.js 提取 calcComp，批量计算后输出 JSON（供 pytest 对比）。
// 用法：node tests/calccomp_bridge.mjs < inputs.json（[[ps, pf_v, sp, preset], ...]）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
const m = src.match(/function calcComp\(o, preset\) \{[\s\S]*?\n\}/);
if (!m) {
  console.error("calcComp not found in app.js");
  process.exit(2);
}
// 以函数表达式方式求值提取出的函数声明，得到可调用的 calcComp
const calcComp = eval("(" + m[0] + ")");

let inputs = [];
try {
  const raw = fs.readFileSync(0, "utf8").trim();
  inputs = raw ? JSON.parse(raw) : [];
} catch (e) {
  console.error("bad stdin: " + e.message);
  process.exit(2);
}

const out = inputs.map(([ps, pfv, sp, preset]) =>
  calcComp({ ps, pf_v: pfv, sp }, preset));
process.stdout.write(JSON.stringify(out));
