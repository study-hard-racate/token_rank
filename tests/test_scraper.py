#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""scraper.py 单元测试"""

import json
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scraper


class TestDedupe:
    def test_basic(self):
        items = [{"id": "a", "input": 1.0}, {"id": "b", "input": 2.0}, {"id": "a", "input": 3.0}]
        result = scraper._dedupe(items)
        assert len(result) == 2
        assert result[0]["input"] == 1.0

    def test_empty(self):
        assert scraper._dedupe([]) == []


class TestHistoryDeltas:
    def test_basic(self):
        import datetime as dt
        today = dt.date.today()
        d1 = (today - dt.timedelta(days=6)).isoformat()
        d2 = today.isoformat()
        history = {"model1": [
            {"date": d1, "input": 10.0, "output": 20.0},
            {"date": d2, "input": 12.0, "output": 24.0},
        ]}
        with patch.object(scraper, "load_history", return_value=history):
            deltas = scraper.history_deltas(7)
        assert "model1" in deltas
        assert deltas["model1"]["in_pct"] == 20.0

    def test_empty(self):
        with patch.object(scraper, "load_history", return_value={}):
            assert scraper.history_deltas(7) == {}


class TestHistoryStats:
    def test_basic(self):
        history = {
            "m1": [{"date": "2026-08-01", "input": 1.0}],
            "m2": [{"date": "2026-08-01", "input": 2.0}, {"date": "2026-08-02", "input": 3.0}],
        }
        with patch.object(scraper, "load_history", return_value=history):
            stats = scraper.history_stats()
        assert stats["models"] == 2
        assert stats["points"] == 3


class TestCollect:
    def test_returns_items(self):
        mock_items = [{"id": "test/model", "input": 1.0, "output": 2.0, "context": 1000}]
        with patch.object(scraper, "fetch_all", return_value=(mock_items, [])), \
             patch.object(scraper, "record_history"), \
             patch.object(scraper, "maybe_backfill"), \
             patch.object(scraper, "load_cache", return_value=None), \
             patch.object(scraper, "save_cache"), \
             patch.object(scraper, "load_aa_perf", return_value=None), \
             patch.object(scraper, "fetch_throughput_rank", return_value={}):
            result = scraper.collect()
        assert len(result["items"]) == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
