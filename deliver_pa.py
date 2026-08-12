#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM Token 定价排行榜 一键交付脚本（只读，绝不修改任何文件）

用法：
  python deliver_pa.py           交互式：本地检查 -> 上传清单 -> 已上传后回车自动复查线上
  python deliver_pa.py --check   只做本地检查 + 上传清单，不做线上复查
  python deliver_pa.py --verify  只做线上复查（适用于手动改过文件后自查）

注意：本脚本不修改任何文件；版本号升号请用编辑器手工修改
      templates/index.html 中的 ?v=N 后再次运行本脚本检查。
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = "https://byj.pythonanywhere.com"
PAIRS = [
    ("templates/index.html", "/"),
    ("templates/about.html", "/about"),
    ("static/app.js", "/static/app.js"),
    ("static/style.css", "/static/style.css"),
    ("static/chart.umd.min.js", "/static/chart.umd.min.js"),
]
PY_FILES = ["app.py", "scraper.py", "deliver_pa.py"]
PA_TARGETS = {
    "templates/index.html": "/home/bj/token_rank/templates/",
    "templates/about.html": "/home/bj/token_rank/templates/",
    "static/app.js": "/home/bj/token_rank/static/",
    "static/style.css": "/home/bj/token_rank/static/",
    "static/chart.umd.min.js": "/home/bj/token_rank/static/",
    "app.py": "/home/bj/token_rank/",
    "scraper.py": "/home/bj/token_rank/",
}

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def info(msg):
    print(msg)


def ok(msg):
    print("[OK]   " + msg)


def warn(msg):
    print("[WARN] " + msg)


def diff(msg):
    print("[DIFF] " + msg)


def fail(msg):
    print("[FAIL] " + msg)


def norm(b):
    if b.startswith(b"\xef\xbb\xbf"):
        b = b[3:]
    s = b.decode("utf-8", errors="replace")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.rstrip() for ln in s.split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    return ("\n".join(lines) + "\n").encode("utf-8")


def md5(b):
    return hashlib.md5(b).hexdigest()


def local_bytes(rel):
    p = os.path.join(ROOT, *rel.split("/"))
    with open(p, "rb") as f:
        return f.read()


def fetch(url_path, tries=3):
    url = BASE + url_path
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                warn("线上获取失败 {}: {}".format(url_path, e))
    return None


def versions_of(b):
    if b is None:
        return []
    return sorted({int(x) for x in re.findall(rb"\?v=(\d+)", b)})


def check_local():
    info("== 1. 本地文件检查 ==")
    for rel, _ in PAIRS:
        try:
            b = local_bytes(rel)
        except OSError as e:
            fail("读不到 {}：{}".format(rel, e))
            continue
        bom = "含BOM(异常)" if b[:3] == b"\xef\xbb\xbf" else "无BOM(正常)"
        info("  {}  {}  {} 字节".format(rel, bom, len(b)))
    ok("BOM 检查完成（HTML/JS/CSS 应全部无 BOM）")

    v = versions_of(local_bytes("templates/index.html"))
    if len(v) == 1:
        ok("本地版本号 v={}（index.html 三处引用一致）".format(v[0]))
    elif not v:
        warn("本地 index.html 未找到 ?v=N 版本号")
    else:
        warn("本地版本号不一致：{}，请检查 templates/index.html".format(v))

    for pyf in PY_FILES:
        p = os.path.join(ROOT, pyf)
        if not os.path.exists(p):
            warn("缺少 {}".format(pyf))
            continue
        r = subprocess.run([sys.executable, "-m", "py_compile", p],
                           capture_output=True, text=True)
        if r.returncode == 0:
            ok("{} 语法通过 (py_compile)".format(pyf))
        else:
            fail("{} 语法错误：{}".format(pyf, r.stderr.strip()))

    if shutil.which("node"):
        r = subprocess.run(["node", "--check", os.path.join(ROOT, "static", "app.js")],
                           capture_output=True, text=True)
        if r.returncode == 0:
            ok("static/app.js 语法通过 (node --check)")
        else:
            fail("static/app.js 语法错误：{}".format(r.stderr.strip()))
    else:
        warn("本机未安装 node，跳过 app.js 语法检查")


def compare_online():
    info("== 2. 与线上比对（归一化：去BOM、CRLF转LF、去行尾空白） ==")
    out = []
    for rel, url in PAIRS:
        rb = fetch(url)
        if rb is None:
            out.append((rel, "unknown"))
            continue
        lb = norm(local_bytes(rel))
        same = lb == norm(rb)
        out.append((rel, "same" if same else "diff"))
        if same:
            ok("{} 与线上一致".format(rel))
        else:
            diff("{} 与线上不同（本次需上传）".format(rel))
    return out


def upload_list():
    info("== 3. 上传清单（Files 页） ==")
    for rel in ("templates/index.html", "templates/about.html", "static/app.js",
                "static/style.css", "static/chart.umd.min.js", "app.py", "scraper.py"):
        p = os.path.join(ROOT, *rel.split("/"))
        if not os.path.exists(p):
            continue
        info("  {}   ->   {}".format(rel, PA_TARGETS[rel]))
    info("提示：只上传本轮改动过的文件即可；后端（app.py/scraper.py）改动后必须去 Web 页点 Reload；"
         "上传后浏览器请按 Ctrl+F5 强刷（静态缓存 1 小时）")


def verify_online():
    info("== 4. 线上复查 ==")
    html = fetch("/")
    if html is None:
        fail("无法访问线上首页")
        return
    v = versions_of(html)
    lv = versions_of(local_bytes("templates/index.html"))
    if v and lv and v[0] == lv[0]:
        ok("线上版本号 v={}，与本地一致".format(v[0]))
    else:
        diff("线上版本号 {} vs 本地 {}（Reload 或缓存未生效？）".format(v, lv))

    for rel, url in PAIRS:
        rb = fetch(url)
        if rb is None:
            continue
        if norm(rb) == norm(local_bytes(rel)):
            ok("{} 线上与本地一致".format(rel))
        else:
            diff("{} 线上与本地不一致（可能未上传或未强刷）".format(rel))

    try:
        d = json.loads(fetch("/api/data?with_deltas=1"))
        items = d.get("items") or []
        tps_n = sum(1 for it in items if it.get("tps") is not None)
        ttft_n = sum(1 for it in items if it.get("ttft") is not None)
        info("  /api/data?with_deltas=1: count={} scored={} errors={} 字段含 deltas7={} tps覆盖={}/{} ttft覆盖={}/{}".format(
            d.get("count"), d.get("scored"), len(d.get("errors") or []),
            "deltas7" in d, tps_n, len(items), ttft_n, len(items)))
        if tps_n == 0 and ttft_n == 0:
            info("  tps/ttft 为 0——预期：OpenRouter API 已不再返回该字段（2026 改版），速度维度用吞吐名次")
        elif tps_n > 0:
            ok("tps/ttft 已解锁（覆盖 {} 个模型）".format(tps_n))
        errs = d.get("errors") or []
        if errs and all("scrape_deepseek" in str(e) for e in errs):
            ok("errors 仅 DeepSeek 403（预期，平台限制）")
        elif errs:
            diff("errors 含非预期项：{}".format(errs[:3]))
        else:
            ok("errors 为空")
    except Exception as e:
        fail("/api/data 复查失败：{}".format(e))

    try:
        s = json.loads(fetch("/api/summary"))
        h = s.get("history") or {}
        info("  /api/summary: total_models={} history={}".format(
            s.get("total_models"), h))
        if "gap_days" in h:
            if h["gap_days"] > 0:
                warn("历史快照已中断 {} 天（最后 {}）——请每天访问一次页面".format(
                    h["gap_days"], h.get("last")))
            else:
                ok("gap_days={}（历史最新，无中断）".format(h["gap_days"]))
        else:
            fail("/api/summary 缺少 gap_days 字段——app.py 是否已上传并 Reload？")
    except Exception as e:
        fail("/api/summary 复查失败：{}".format(e))


def main():
    args = sys.argv[1:]
    info("LLM Token 定价排行榜 一键交付脚本（只读）")
    if "--verify" in args:
        verify_online()
        info("完成。若文件未上传，请按第 3 步清单上传后再复查。")
        return
    check_local()
    compare_online()
    upload_list()
    if "--check" in args:
        return
    ans = input("上传并 Reload 完成后按回车自动复查线上；输入 s 跳过复查：").strip().lower()
    if ans == "s":
        info("已跳过线上复查")
        return
    verify_online()
    info("完成。")


if __name__ == "__main__":
    main()
