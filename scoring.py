#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""评分逻辑唯一实现（Phase 2 去重后，app.py 与 build_static.py 共同依赖）。

背景：v42 之前 ps/pf/sp/comp 的计算逻辑在 app.py、build_static.py、app.js 三处重复，
且两处 Python 的 pf 结构不一致（app.py 输出单场景标量、build_static 输出 3 场景 dict），
前端被迫兼容两种形状。本模块统一 Python 侧实现：

- `add_scores(items)` 原地补 ps / pf（3 场景 dict：{general,code,agent} → {v,src}）/ sp
  —— 这是 data.json 持久化形态，也是 app.py 进一步按请求场景展平的基础。
- `composite(ps, pf_v, sp, preset)` 纯函数计算综合分（与前端 app.js 的 calcComp 等价，
  由 tests/test_scoring.py 的对拍测试锁定等价性）。

不可直接修改的约定（与前端一致）：
- SCENES / SCENE_ORDER / WEIGHTS 的取值与 app.js 中 calcComp 的权重表一一对应；
  改动需同步前端并更新对拍测试。
"""

from bisect import bisect_left
import math

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


def scene_index(it, scene):
    """按场景优先级取能力指数：返回 (能力分, 来源指数)；无数据返回 (None, None)。

    场景优先级：general=intel>code>agentic；code=code>intel>agentic；agent=agentic>intel>code。
    与前端 SCENE_TIP 说明一致；数值解析失败视为缺失（跳过该项）。
    """
    for k in SCENE_ORDER.get(scene, SCENE_ORDER["general"]):
        v = it.get(k)
        if v is not None:
            try:
                return float(v), k
            except (TypeError, ValueError):
                continue
    return None, None


def add_scores(items):
    """原地给 items 补评分字段（与 build_static 原实现逐字段一致）：

    - ps: 价格分 = 输入价百分位（越低越贵，最高 100），保留 1 位小数
    - pf: {scene: {"v": 能力分(1 位小数), "src": 来源指数}} 三场景齐全
    - sp: 速度分 = speed_pct（可能为 None）
    返回 items 本身（便于链式调用）。
    """
    prices = sorted((it.get("input") or 0) for it in items)
    n = len(prices) or 1
    for it in items:
        it["ps"] = round(100 * (1 - bisect_left(prices, it.get("input") or 0) / n), 1)
        pf = {}
        for sc in SCENES:
            v, src = scene_index(it, sc)
            pf[sc] = {"v": round(v, 1) if v is not None else None, "src": src}
        it["pf"] = pf
        it["sp"] = it.get("speed_pct")
    return items


def composite(ps, pf_v, sp, preset="balanced"):
    """综合分 = 价格/能力/速度加权平均（0~100，1 位小数）。

    - 能力分缺失 → 返回 None（不参与综合推荐，前端显示 —）
    - 速度分缺失 → 仅用价格+能力并按剩余权重重归一化（与前端 calcComp 一致）
    - 未知 preset → 回退 balanced
    - 舍入用**半进位**（`floor(x*10+0.5)/10`）而非 Python 的银行家舍入：
      与前端 app.js `Math.round(sum/total*10)/10` 完全一致（已部署的静态站
      由 JS 计算综合分，API 模式必须与其逐位相同；对拍测试锁定）。
    """
    w1, w2, w3 = WEIGHTS.get(preset, WEIGHTS["balanced"])
    if pf_v is None:
        return None
    parts = [(ps, w1), (pf_v, w2)]
    if sp is not None:
        parts.append((sp, w3))
    # 朴素顺序累加（与 app.js calcComp 的 for 循环逐位一致）：
    # 注意不能用内置 sum()——CPython 3.12+ 对 float 做补偿求和，
    # 会在 .x5 舍入边界上与 JS 差 1 ulp（对拍测试曾捕获真实数据 17 处分歧）。
    total = 0.0
    s = 0.0
    for v, wt in parts:
        total += wt
        s += v * wt
    x = s / total
    return math.floor(x * 10 + 0.5) / 10
