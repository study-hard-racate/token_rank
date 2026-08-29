#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""scoring.py 单元测试 + 与前端 app.js calcComp 的对拍测试。

对拍原理：scoring.composite 与 app.js calcComp 均应输出「1 位小数的综合分」。
由于两侧都是 1 位小数，|py - js| 若 > 0.05 即为真实分歧（0.1 级差异），
因此用 0.05 + ε 容差做严格等价断言（相同值差为 0.0）。
"""

import json
import os
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scoring

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestSceneIndex:
    def test_order_per_scene(self):
        it = {"intel": 10, "code": 20, "agentic": 30}
        assert scoring.scene_index(it, "general") == (10.0, "intel")
        assert scoring.scene_index(it, "code") == (20.0, "code")
        assert scoring.scene_index(it, "agent") == (30.0, "agentic")

    def test_fallback_when_missing(self):
        assert scoring.scene_index({"code": 20, "agentic": 30}, "general") == (20.0, "code")
        assert scoring.scene_index({"agentic": 30}, "general") == (30.0, "agentic")
        assert scoring.scene_index({"intel": 10}, "code") == (10.0, "intel")

    def test_all_missing(self):
        assert scoring.scene_index({}, "general") == (None, None)
        assert scoring.scene_index({"intel": None}, "general") == (None, None)

    def test_non_numeric_skipped(self):
        # intel 解析失败应跳过，回退到 code
        it = {"intel": "n/a", "code": 5}
        assert scoring.scene_index(it, "general") == (5.0, "code")

    def test_unknown_scene_uses_general(self):
        assert scoring.scene_index({"intel": 7}, "weird") == (7.0, "intel")


class TestAddScores:
    def _items(self):
        return [
            {"id": "a", "input": 1.0, "output": 2.0, "speed_pct": 50.0, "intel": 10.0, "code": 20.0},
            {"id": "b", "input": 2.0, "output": 4.0, "speed_pct": None, "intel": 20.0},
            {"id": "c", "input": 4.0, "output": 8.0, "speed_pct": 100.0, "intel": 30.0, "agentic": 40.0},
        ]

    def test_ps_bisect(self):
        items = self._items()
        scoring.add_scores(items)
        # sorted inputs [1,2,4]，bisect_left 索引 0/1/2 → ps 100 / 66.7 / 33.3
        assert items[0]["ps"] == 100.0
        assert items[1]["ps"] == 66.7
        assert items[2]["ps"] == 33.3

    def test_pf_dict_shape(self):
        items = self._items()
        scoring.add_scores(items)
        for it in items:
            assert set(it["pf"].keys()) == {"general", "code", "agent"}
            for sc in scoring.SCENES:
                assert set(it["pf"][sc].keys()) == {"v", "src"}
        assert items[0]["pf"]["general"] == {"v": 10.0, "src": "intel"}
        assert items[0]["pf"]["code"] == {"v": 20.0, "src": "code"}
        # b 无 code/agentic：code 场景回退 intel
        assert items[1]["pf"]["code"] == {"v": 20.0, "src": "intel"}
        # c 无 code：agent 场景取 agentic
        assert items[2]["pf"]["agent"] == {"v": 40.0, "src": "agentic"}
        # 缺全部指数 → v=None
        items[1].clear()
        items[1].update({"id": "b2", "input": 2.0})
        scoring.add_scores([items[1]])
        assert items[1]["pf"]["general"]["v"] is None

    def test_sp(self):
        items = self._items()
        scoring.add_scores(items)
        assert items[0]["sp"] == 50.0
        assert items[1]["sp"] is None
        assert items[2]["sp"] == 100.0

    def test_empty(self):
        assert scoring.add_scores([]) == []


class TestComposite:
    def test_balanced_with_speed(self):
        # 100*0.4 + 14.2*0.4 + 83.6*0.2 = 62.4
        assert scoring.composite(100.0, 14.2, 83.6, "balanced") == 62.4

    def test_renorm_without_speed(self):
        # (100*0.4 + 50*0.4) / 0.8 = 75
        assert scoring.composite(100.0, 50.0, None, "balanced") == 75.0

    def test_value_preset(self):
        # 100*0.5 + 14.2*0.35 + 83.6*0.15 = 67.51 → 67.5
        assert scoring.composite(100.0, 14.2, 83.6, "value") == 67.5

    def test_perf_preset(self):
        # 100*0.25 + 14.2*0.5 + 83.6*0.25 = 53.0
        assert scoring.composite(100.0, 14.2, 83.6, "perf") == 53.0

    def test_unknown_preset_falls_back(self):
        assert scoring.composite(100.0, 50.0, 50.0, "weird") == scoring.composite(100.0, 50.0, 50.0, "balanced")

    def test_pf_none_returns_none(self):
        assert scoring.composite(100.0, None, 50.0, "balanced") is None
        assert scoring.composite(100.0, None, None, "value") is None

    def test_half_up_boundary_matches_js(self):
        # 0.92/0.8 = 1.15：Python round() 银行家舍入得 1.1，但前端 Math.round 得 1.2。
        # 以已部署的 JS 语义为准（对拍测试曾捕获此分歧），必须是 1.2。
        assert scoring.composite(0.0, 2.3, None, "balanced") == 1.2

    def test_regression_sum_order_matches_js(self):
        # 回归：CPython 内置 sum() 对 float 做补偿求和，会在 .x5 边界与 JS 朴素
        # 累加差 1 ulp（真实数据 google/gemma-4-31b-it agent/perf 曾 py=42.4 vs js=42.3）。
        # composite 必须用朴素顺序累加，结果与 JS 一致：42.3。
        assert scoring.composite(88.1, 14.4, 52.5, "perf") == 42.3


class TestParityWithJS:
    """对拍：scoring.composite 与真实 app.js calcComp 在输入网格上结果一致。

    两者都应输出 1 位小数；相同值差为 0.0，任何真实分歧都 ≥ 0.1，
    因此断言 |py - js| ≤ 0.05 + ε。需要 node 可用（CI 已具备）。
    """

    @pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
    def test_composite_parity(self):
        grid = []
        for ps in (0.0, 1.5, 33.3, 66.7, 100.0):
            for pf in (None, 2.3, 14.2, 25.3, 50.0, 100.0):
                for sp in (None, 0.0, 83.6, 100.0):
                    for preset in ("balanced", "value", "perf", "unknown"):
                        grid.append([ps, pf, sp, preset])
        bridge = os.path.join(ROOT, "tests", "calccomp_bridge.mjs")
        proc = subprocess.run(["node", bridge], input=json.dumps(grid),
                              capture_output=True, text=True, timeout=120)
        assert proc.returncode == 0, proc.stderr
        js_vals = json.loads(proc.stdout)
        assert len(js_vals) == len(grid)
        mismatches = []
        for (ps, pf, sp, preset), js in zip(grid, js_vals):
            py = scoring.composite(ps, pf, sp, preset)
            if py is None:
                if js is not None:
                    mismatches.append((ps, pf, sp, preset, py, js))
            elif js is None or abs(py - js) > 0.05 + 1e-9:
                mismatches.append((ps, pf, sp, preset, py, js))
        assert not mismatches, "Python scoring.composite 与 JS calcComp 分歧: {}".format(mismatches[:5])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
