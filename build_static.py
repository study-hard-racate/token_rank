#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""静态构建脚本：为 GitHub Pages 生成 site/ 发布目录（只生成文件，不推 Git）。

用法：
  python build_static.py --offline         直接用本地 data.json/history.json 构建（本地测试用，不爬取）
  python build_static.py [--restore DIR]   爬取最新数据并构建（GitHub Actions 用）
                                          --restore DIR：先从旧发布目录恢复 history.json 等（保证历史连续）

产物（site/ = gh-pages 分支根）：
  index.html / about.html / static/*       相对路径化后的前端
  data.json                                预计算 ps / pf×3场景 / sp，comp 由前端计算
  history.json / aa_perf.json              数据缓存（历史连续依赖 git 持久化）

说明：不改动 data.json / history.json 的语义，仅读取后按新结构输出。
"""

import datetime
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")
SCENES = ["general", "code", "agent"]
SCENE_ORDER = {
    "general": ("intel", "code", "agentic"),
    "code": ("code", "intel", "agentic"),
    "agent": ("agentic", "intel", "code"),
}
WEIGHTS = {
    "balanced": (0.4, 0.4, 0.2),
    "value": (0.5, 0.35, 0.15),
    "perf": (0.25, 0.5, 0.25),
}


def info(msg):
    print(msg)


def scene_index(it, scene):
    for k in SCENE_ORDER.get(scene, SCENE_ORDER["general"]):
        v = it.get(k)
        if v is not None:
            try:
                return float(v), k
            except (TypeError, ValueError):
                continue
    return None, None


def add_scores(items):
    """复刻 app._add_scores：ps 一次，pf 按 3 场景预计算。"""
    prices = sorted((it.get("input") or 0) for it in items)
    n = len(prices) or 1
    from bisect import bisect_left
    for it in items:
        it["ps"] = round(100 * (1 - bisect_left(prices, it.get("input") or 0) / n), 1)
        pf = {}
        for sc in SCENES:
            v, src = scene_index(it, sc)
            pf[sc] = {"v": round(v, 1) if v is not None else None, "src": src}
        it["pf"] = pf
        it["sp"] = it.get("speed_pct")
    return items


def copy_frontend():
    """把模板/静态资源拷贝到 site/，并将绝对路径改为相对（Pages 部署在子路径）。"""
    os.makedirs(SITE, exist_ok=True)
    os.makedirs(os.path.join(SITE, "static"), exist_ok=True)
    for src, dst in (
        ("templates/index.html", "index.html"),
        ("templates/about.html", "about.html"),
    ):
        with open(os.path.join(ROOT, src), "r", encoding="utf-8") as f:
            html = f.read()
        html = html.replace('href="/static/', 'href="static/')
        html = html.replace('src="/static/', 'src="static/')
        html = html.replace('href="/about"', 'href="about.html"')
        with open(os.path.join(SITE, dst), "w", encoding="utf-8") as f:
            f.write(html)
    for name in ("app.js", "style.css", "chart.umd.min.js", "favicon.svg"):
        shutil.copyfile(os.path.join(ROOT, "static", name), os.path.join(SITE, "static", name))
    info("前端已拷贝到 site/（相对路径化）")


def write_data(items, payload):
    data = {
        "updated": payload.get("updated"),
        "errors": payload.get("errors", []),
        "aa_perf_at": payload.get("aa_perf_at"),
        "items": items,
    }
    with open(os.path.join(SITE, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    info("site/data.json: {} 个模型".format(len(items)))


def main():
    offline = "--offline" in sys.argv
    restore = None
    if "--restore" in sys.argv:
        i = sys.argv.index("--restore")
        if i + 1 < len(sys.argv):
            restore = sys.argv[i + 1]

    if restore and os.path.isdir(restore):
        for name in ("history.json", "data.json", "aa_perf.json"):
            p = os.path.join(restore, name)
            if os.path.isfile(p):
                shutil.copyfile(p, os.path.join(ROOT, name))
                info("已从 {} 恢复 {}".format(restore, name))

    if offline:
        cached = None
        try:
            with open(os.path.join(ROOT, "data.json"), "r", encoding="utf-8") as f:
                cached = json.load(f)
        except (OSError, ValueError) as e:
            info("离线模式读 data.json 失败：{}".format(e))
            sys.exit(1)
        items = list(cached.get("items") or [])
        payload = cached
        info("离线模式：使用本地 data.json（{} 个模型）".format(len(items)))
    else:
        import scraper
        payload = scraper.collect()
        items = payload.get("items") or []
        info("在线模式：爬取完成（{} 个模型，errors={}）".format(len(items), len(payload.get("errors") or [])))

    items = add_scores(items)
    os.makedirs(SITE, exist_ok=True)
    write_data(items, payload)

    for name in ("history.json", "aa_perf.json"):
        src = os.path.join(ROOT, name)
        if not os.path.isfile(src):
            continue
        if name == "history.json":
            with open(src, "r", encoding="utf-8") as f:
                hist = json.load(f)
            clean = {k: v for k, v in hist.items() if isinstance(v, list)}
            with open(os.path.join(SITE, name), "w", encoding="utf-8") as f:
                json.dump(clean, f, ensure_ascii=False)
            info("site/history.json 已拷贝（清理非数组键 {} 个）".format(len(hist) - len(clean)))
        else:
            shutil.copyfile(src, os.path.join(SITE, name))
            info("site/{} 已拷贝".format(name))

    copy_frontend()
    info("构建完成：site/ 目录就绪")


if __name__ == "__main__":
    main()
