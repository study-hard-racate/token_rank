#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Flask API 应用 — 仅用于本地开发调试。

生产环境已迁移至 GitHub Pages（静态模式），本文件保留用于：
  - 本地运行 `python app.py` 测试完整 API 功能
  - 调试数据抓取和评分逻辑

部署方式：python app.py → http://127.0.0.1:8081（默认端口 8081，可用环境变量 PORT 覆盖）
"""

import json
import os
import time
from datetime import date

from flask import Flask, jsonify, render_template, request

import scraper
import scoring

app = Flask(__name__)
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
refresher = scraper.Refresher()


def _read_cache():
    cached = scraper.load_cache()
    if not cached:
        refresher.refresh_async()
        return {
            "updated": "",
            "items": [],
            "errors": ["first load in progress, please refresh shortly"],
        }
    return cached


_low_map = None
_low_map_at = 0.0


def _all_time_low_map():
    """一次读取历史，构建 {model_id: 历史最低输入价}（60 秒缓存）。"""
    global _low_map, _low_map_at
    now = time.time()
    if _low_map is None or now - _low_map_at > 60:
        hist = scraper.load_history()
        low = {}
        for mid, entries in hist.items():
            if len(entries) < 7:
                continue
            vals = [e.get("input") for e in entries if e.get("input") is not None]
            if vals:
                low[mid] = min(vals)
        _low_map = low
        _low_map_at = now
    return _low_map


def _rank(items):
    sort_key = request.args.get("sort", "input")
    reverse = request.args.get("order", "asc") == "desc"
    if sort_key in ("score", "context"):
        reverse = True
    make_key = {
        "input": lambda x: (x.get("input") or 0, x.get("output") or 0),
        "output": lambda x: (x.get("output") or 0, x.get("input") or 0),
        "context": lambda x: x.get("context") or 0,
        "name": lambda x: x.get("name") or "",
        "tps": lambda x: (x.get("tps") or 0, x.get("input") or 0),
        "score": lambda x: (x.get("comp"), 1) if x.get("comp") is not None else (-1, 0),
    }.get(sort_key, lambda x: x.get("input") or 0)
    return sorted(items, key=make_key, reverse=reverse)


def _filter(items):
    query = request.args.get("q", "").strip().lower()
    provider = request.args.get("provider", "").strip().lower()
    max_price = request.args.get("max_price", "").strip()
    if query:
        terms = [t for t in query.split() if t]
        if terms:
            items = [it for it in items if all(
                term in (it.get("name") or "").lower()
                or term in (it.get("id") or "").lower()
                or term in (it.get("provider") or "").lower()
                for term in terms)]
    if provider:
        items = [it for it in items if provider in (it.get("provider") or "").lower()]
    if max_price:
        try:
            lim = float(max_price)
            items = [it for it in items
                     if (it.get("input") or 0) <= lim and (it.get("output") or 0) <= lim]
        except ValueError:
            pass
    return items


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/api/data")
def api_data():
    refresher.ensure()
    cached = _read_cache()
    scene = request.args.get("scene", "general")
    # 复制后再原地评分，避免污染缓存；add_scores 输出 3 场景 dict，按请求场景展平为标量
    items = scoring.add_scores([dict(it) for it in cached.get("items", [])])
    preset = request.args.get("weights", "balanced")
    if preset not in scoring.WEIGHTS:
        preset = "balanced"
    for o in items:
        pfv = (o.get("pf") or {}).get(scene) or {}
        o["pf"] = pfv.get("v")
        o["pf_src"] = pfv.get("src")
        o["comp"] = scoring.composite(o.get("ps"), o["pf"], o.get("sp"), preset)
    items = _filter(items)
    if request.args.get("budget") == "1":
        items = [o for o in items if o["comp"] is None]
        items = sorted(items, key=lambda o: (o.get("input") or 0, o.get("output") or 0))
    else:
        items = _rank(items)
    out = {
        "updated": cached.get("updated"),
        "errors": cached.get("errors", []),
        "aa_perf_at": cached.get("aa_perf_at"),
        "aa_perf_stale": cached.get("aa_perf_stale", False),
        "aa_perf_error": cached.get("aa_perf_error"),
        "count": len(items),
        "items": items,
        "providers": sorted({it.get("provider") for it in cached.get("items", [])}),
        "scored": sum(1 for o in items if o["comp"] is not None),
    }
    if request.args.get("with_deltas") == "1":
        out["deltas7"] = scraper.history_deltas(7)
        low = _all_time_low_map()
        for o in items:
            mn = low.get(o.get("id"))
            if mn is not None and (o.get("input") or 0) <= mn * 1.001:
                o["low_badge"] = True
    return jsonify(out)


@app.route("/api/summary")
def api_summary():
    refresher.ensure()
    cached = _read_cache()
    by_provider = {}
    for it in cached.get("items", []):
        by_provider.setdefault(it.get("provider"), []).append(it)
    stats = {}
    for name, its in by_provider.items():
        prices = sorted(x.get("input") or 0 for x in its)
        stats[name] = {
            "count": len(its),
            "min_input": prices[0] if prices else 0,
            "avg_input": round(sum(prices) / len(prices) or 0, 4) if prices else 0,
            "max_context": max(x.get("context") or 0 for x in its),
        }
    history = scraper.history_stats()
    if history.get("last"):
        try:
            history["gap_days"] = (date.today()
                                   - date.fromisoformat(history["last"])).days
        except (TypeError, ValueError):
            pass
    return jsonify({
        "updated": cached.get("updated"),
        "total_models": len(cached.get("items", [])),
        "providers": stats,
        "history": history,
    })


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    payload = refresher.refresh()
    return jsonify({"ok": True, "updated": payload["updated"], "count": len(payload["items"])})


@app.route("/api/history")
def api_history():
    model_id = request.args.get("model", "")
    try:
        days = int(float(request.args.get("days", "30")))
    except ValueError:
        days = 30
    days = max(1, min(180, days))
    points = scraper.get_history(model_id, days) if model_id else []
    return jsonify({"model": model_id, "days": days, "points": points})


@app.route("/api/history-deltas")
def api_history_deltas():
    try:
        days = int(float(request.args.get("days", "7")))
    except ValueError:
        days = 7
    days = max(1, min(180, days))
    return jsonify({"days": days, "deltas": scraper.history_deltas(days)})


@app.after_request
def add_cache_headers(resp):
    if request.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "public, max-age=3600"
    else:
        resp.headers["Cache-Control"] = "no-store"
    return resp


if __name__ == "__main__":
    refresher.start()
    port = int(os.environ.get("PORT", "8081"))
    app.run(host="0.0.0.0", port=port)