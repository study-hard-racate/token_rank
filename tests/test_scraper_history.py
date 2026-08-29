#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""历史数据与回补逻辑测试（tmp_path 隔离文件，无网络）。

覆盖：load/save_cache、load/save_history、record_history（同日替换 + 45 天裁剪）、
get_history、maybe_backfill（_last_backfill 标记与日期门限）、wayback_backfill、
_row_model_id、_monies。
"""

import datetime
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scraper


def _hfile(monkeypatch, tmp_path, name="history.json"):
    p = tmp_path / name
    monkeypatch.setattr(scraper, "HISTORY_FILE", str(p))
    return p


class TestFileRoundTrips:
    def test_cache_roundtrip(self, monkeypatch, tmp_path):
        p = tmp_path / "data.json"
        monkeypatch.setattr(scraper, "DATA_FILE", str(p))
        payload = {"updated": "x", "items": [{"id": "a", "input": 1.0}]}
        assert scraper.load_cache() is None
        scraper.save_cache(payload)
        assert scraper.load_cache() == payload

    def test_history_roundtrip_pops_backfill_marker(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path).write_text(
            json.dumps({"_last_backfill": "2026-08-01", "m1": [{"date": "2026-08-01", "input": 1.0}]}),
            encoding="utf-8")
        hist = scraper.load_history()
        assert "_last_backfill" not in hist
        assert "m1" in hist

    def test_history_corrupt_returns_empty(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path).write_text("{not json", encoding="utf-8")
        assert scraper.load_history() == {}


class TestRecordHistory:
    def test_same_day_replaces(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path)
        scraper.record_history([{"id": "m1", "input": 1.0, "output": 2.0}])
        scraper.record_history([{"id": "m1", "input": 3.0, "output": 4.0}])
        hist = scraper.load_history()
        assert hist["m1"] == [{"date": datetime.date.today().isoformat(), "input": 3.0, "output": 4.0}]

    def test_skips_item_without_input(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path)
        scraper.record_history([{"id": "m1", "input": None, "output": 2.0}])
        assert scraper.load_history() == {}

    def test_trims_to_keep_days(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path)
        monkeypatch.setattr(scraper, "HISTORY_KEEP_DAYS", 5)
        hist = {"m1": [{"date": "2026-01-{:02d}".format(i), "input": float(i), "output": 1.0} for i in range(1, 46)]}
        scraper.save_history(hist)
        scraper.record_history([{"id": "m1", "input": 99.0, "output": 1.0}])
        entries = scraper.load_history()["m1"]
        assert len(entries) == 5
        assert entries[-1]["input"] == 99.0
        assert entries[0]["date"] == "2026-01-42"


class TestGetHistory:
    def test_days_filter(self, monkeypatch, tmp_path):
        today = datetime.date.today()
        hist = {"m1": [
            {"date": (today - datetime.timedelta(days=10)).isoformat(), "input": 1.0},
            {"date": (today - datetime.timedelta(days=2)).isoformat(), "input": 2.0},
            {"date": today.isoformat(), "input": 3.0},
        ]}
        monkeypatch.setattr(scraper, "load_history", lambda: hist)
        pts = scraper.get_history("m1", 7)
        assert [p["input"] for p in pts] == [2.0, 3.0]
        # days 超过保留期 → 返回全部
        assert len(scraper.get_history("m1", scraper.HISTORY_KEEP_DAYS)) == 3
        # 未知模型 → 空
        assert scraper.get_history("nope", 7) == []


class TestRowModelId:
    def test_mappings(self):
        assert scraper._row_model_id("DeepSeek-V3 API deepseek-chat") == "deepseek/deepseek-chat"
        assert scraper._row_model_id("deepseek-reasoner price") == "deepseek/deepseek-reasoner"
        assert scraper._row_model_id("DeepSeek R1 pricing") == "deepseek/deepseek-reasoner"
        assert scraper._row_model_id("DeepSeek-V3 2.0") == "deepseek/deepseek-chat"
        assert scraper._row_model_id("some other model") is None


class TestMonies:
    def test_extract(self):
        assert scraper._monies("$2.00 USD input, $8.00 USD output") == [2.0, 8.0]
        assert scraper._monies("no prices here") == []
        assert scraper._monies("USD 5 per 1M") == [5.0, 1.0]


class TestWaybackBackfill:
    def test_adds_entries_from_snapshots(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path)
        monkeypatch.setattr(scraper, "BACKFILL_PAGES", {"example.com/pricing": ["deepseek/deepseek-chat"]})
        cdx = "20260818091234 200 text/html ABC\n20260819091234 200 text/html DEF\n"
        snapshot = ("<html><body><table><tr><td>DeepSeek API pricing deepseek-chat "
                    "$2.00 USD input $8.00 USD output</td></tr></table></body></html>")

        def fake_get(url, **k):
            if "cdx" in url:
                return _Resp(text=cdx)
            return _Resp(text=snapshot)

        monkeypatch.setattr(scraper, "_http_get", fake_get)
        assert scraper.wayback_backfill() is True
        hist = scraper.load_history()
        assert [e["date"] for e in hist["deepseek/deepseek-chat"]] == ["2026-08-18", "2026-08-19"]
        e = hist["deepseek/deepseek-chat"][0]
        assert e["input"] == 2.0 and e["output"] == 8.0

    def test_cdx_failure_skips(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path)
        monkeypatch.setattr(scraper, "BACKFILL_PAGES", {"example.com/pricing": ["deepseek/deepseek-chat"]})

        def boom(url, **k):
            raise RuntimeError("cdx down")

        monkeypatch.setattr(scraper, "_http_get", boom)
        assert scraper.wayback_backfill() is False


class TestMaybeBackfill:
    def test_marker_skips(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path).write_text(
            json.dumps({"_last_backfill": datetime.date.today().isoformat(), "m1": []}), encoding="utf-8")
        called = []
        monkeypatch.setattr(scraper, "wayback_backfill", lambda: called.append(1) or True)
        assert scraper.maybe_backfill() is None
        assert not called

    def test_enough_dates_skips(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path).write_text(
            json.dumps({"m1": [{"date": "2026-08-{:02d}".format(i), "input": 1.0} for i in range(1, 15)]}),
            encoding="utf-8")
        called = []
        monkeypatch.setattr(scraper, "wayback_backfill", lambda: called.append(1) or True)
        assert scraper.maybe_backfill() is None
        assert not called

    def test_few_dates_triggers_and_marks(self, monkeypatch, tmp_path):
        p = _hfile(monkeypatch, tmp_path)
        p.write_text(json.dumps({"m1": [{"date": "2026-08-01", "input": 1.0}]}), encoding="utf-8")
        monkeypatch.setattr(scraper, "wayback_backfill", lambda: True)
        assert scraper.maybe_backfill() is True
        # load_history 会 pop 掉 _last_backfill，需读原始文件断言标记
        raw = json.loads(p.read_text(encoding="utf-8"))
        assert raw.get("_last_backfill") == datetime.date.today().isoformat()

    def test_backfill_error_returns_false(self, monkeypatch, tmp_path):
        _hfile(monkeypatch, tmp_path)
        monkeypatch.setattr(scraper, "wayback_backfill", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
        assert scraper.maybe_backfill() is False


class _Resp:
    def __init__(self, text="", data=None):
        self.text = text
        self._data = data

    def json(self):
        return self._data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
