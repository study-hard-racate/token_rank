#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Refresher 后台刷新线程测试（collect/save_cache 全部打桩，无网络）。
"""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scraper


def _wait_until(fn, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if fn():
            return True
        time.sleep(0.02)
    return False


class TestRefresher:
    def test_ensure_triggers_when_stale(self, monkeypatch):
        r = scraper.Refresher()
        calls = []
        monkeypatch.setattr(scraper, "collect", lambda: calls.append(1) or {"items": []})
        monkeypatch.setattr(scraper, "save_cache", lambda p: None)
        r.ensure()  # _last 为 None → 应触发后台刷新
        assert _wait_until(lambda: len(calls) >= 1), "collect 未被调用"
        r._running = False

    def test_ensure_noop_when_fresh(self, monkeypatch):
        r = scraper.Refresher()
        calls = []
        monkeypatch.setattr(scraper, "collect", lambda: calls.append(1) or {"items": []})
        monkeypatch.setattr(scraper, "save_cache", lambda p: None)
        r._last = time.time()  # 刚刷新过
        r.ensure()
        time.sleep(0.2)
        assert calls == []
        r._running = False

    def test_refresh_async_dedup(self, monkeypatch):
        r = scraper.Refresher()
        calls = []
        monkeypatch.setattr(scraper, "collect", lambda: calls.append(1) or {"items": []})
        monkeypatch.setattr(scraper, "save_cache", lambda p: None)
        r._refreshing = True  # 模拟正在刷新
        r.refresh_async()
        time.sleep(0.2)
        assert calls == [], "刷新进行中不应重复启动"
        r._refreshing = False
        r._running = False

    def test_refresh_blocking(self, monkeypatch):
        r = scraper.Refresher()
        monkeypatch.setattr(scraper, "collect", lambda: {"items": [{"id": "a"}], "updated": "t"})
        saved = []
        monkeypatch.setattr(scraper, "save_cache", lambda p: saved.append(p))
        payload = r.refresh()
        assert payload["updated"] == "t"
        assert saved and saved[0]["updated"] == "t"
        assert r._last is not None
        assert r._refreshing is False
        r._running = False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
