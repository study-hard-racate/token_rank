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

import scoring

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")


def info(msg):
    print(msg)


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
        if dst == "about.html":
            html = html.replace(
                "免费托管层无常驻定时任务，快照依赖您访问页面时触发刷新判断（约 6 小时一次）；若某天无人访问，当天价格历史会如实显示中断（页面会提示缺天数），不会伪造数据。",
                "本站由 GitHub Actions 定时任务每 6 小时自动爬取记录；若某次定时任务未运行，当天价格历史会如实空缺并在页面提示（不补造）。")
            html = html.replace(
                "免费托管存在 off-peak 时段限制，高峰时服务可能不可用，属平台规则。",
                "本站部署于 GitHub Pages，由 Actions 定时更新，无 off-peak 时段限制。")
        with open(os.path.join(SITE, dst), "w", encoding="utf-8") as f:
            f.write(html)
    for name in ("app.js", "utils.js", "style.css", "chart.umd.min.js", "favicon.svg"):
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


FALLBACK_MARKER = "all sources failed, using built-in fallback"


def fetch_online_data():
    """离线构建前尝试拉取线上最新数据（防本地旧数据覆盖线上历史）。失败则用本地。"""
    for name, dst in (("data.json", "data.json"), ("history.json", "history.json")):
        try:
            import urllib.request
            url = "https://study-hard-racate.github.io/token_rank/" + name
            with urllib.request.urlopen(url, timeout=30) as r:
                b = r.read()
            with open(os.path.join(ROOT, dst), "wb") as f:
                f.write(b)
            info("已拉取线上最新 {}（{} 字节）".format(name, len(b)))
        except Exception as e:
            info("拉取线上 {} 失败，用本地：{}".format(name, str(e)[:60]))


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
        fetch_online_data()
        cached = None
        try:
            with open(os.path.join(ROOT, "data.json"), "r", encoding="utf-8") as f:
                cached = json.load(f)
        except (OSError, ValueError) as e:
            info("离线模式读 data.json 失败：{}".format(e))
            sys.exit(1)
        items = list(cached.get("items") or [])
        payload = cached
        info("离线模式：使用 data.json（{} 个模型）".format(len(items)))
    else:
        import scraper
        payload = scraper.collect()
        items = payload.get("items") or []
        info("在线模式：爬取完成（{} 个模型，errors={}）".format(len(items), len(payload.get("errors") or [])))
        if any(FALLBACK_MARKER in str(e) for e in payload.get("errors") or []):
            old = None
            try:
                with open(os.path.join(ROOT, "data.json"), "r", encoding="utf-8") as f:
                    old = json.load(f)
            except (OSError, ValueError):
                old = None
            if old and old.get("items"):
                info("所有数据源失败：保留上次成功数据（{} 个模型），如实标注错误".format(len(old["items"])))
                payload = dict(old)
                payload["errors"] = (payload.get("errors") or []) + [
                    "all sources failed on this run: kept last successful data"]
                items = payload["items"]

    items = scoring.add_scores(items)
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
