#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""app.py Flask API 响应契约测试（Phase 2 后评分形状锁定）。

用 Flask test_client 直接打 /api/data，不打真实网络（refresher.ensure 被替换）。
读取真实 data.json（只读）。断言 API 模式评分字段形状与 v42 完全一致：
ps / pf(标量) / pf_src / sp / comp。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as appmod


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(appmod.refresher, "ensure", lambda: None)  # 阻止后台爬取
    return appmod.app.test_client()


def test_api_data_shape(client):
    r = client.get("/api/data?weights=balanced&scene=general")
    assert r.status_code == 200
    d = r.get_json()
    assert d["count"] > 0
    assert d["count"] == len(d["items"])
    assert isinstance(d["providers"], list) and d["providers"]
    o = next(x for x in d["items"] if x["comp"] is not None)
    for k in ("ps", "pf", "pf_src", "sp", "comp"):
        assert k in o, "响应缺评分字段 {}".format(k)
    assert isinstance(o["pf"], (int, float)), "API 模式 pf 必须是标量"
    assert o["pf_src"] in ("intel", "code", "agentic")


def test_api_data_scene_and_preset(client):
    d = client.get("/api/data?weights=perf&scene=agent").get_json()
    scored = [x for x in d["items"] if x["comp"] is not None]
    assert scored
    for o in scored:
        assert 0 <= o["comp"] <= 100
    # 未知权重回退 balanced（不报错）
    d2 = client.get("/api/data?weights=weird").get_json()
    assert d2["count"] == d["count"]


def test_api_data_budget(client):
    d = client.get("/api/data?budget=1").get_json()
    assert d["items"], "实惠榜不应为空"
    assert all(x["comp"] is None for x in d["items"]), "实惠榜只含无能力指数的模型"
    inputs = [x["input"] for x in d["items"]]
    assert inputs == sorted(inputs), "实惠榜应按输入价升序"


def test_api_data_filter_and_sort(client):
    d = client.get("/api/data?q=gpt&sort=input&order=asc").get_json()
    assert all("gpt" in (x["name"] or "").lower() or "gpt" in (x["id"] or "").lower()
               for x in d["items"])
    d2 = client.get("/api/data?max_price=1").get_json()
    assert all((x["input"] or 0) <= 1 and (x["output"] or 0) <= 1 for x in d2["items"])


def test_api_data_with_deltas(client):
    d = client.get("/api/data?with_deltas=1").get_json()
    assert "deltas7" in d


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
