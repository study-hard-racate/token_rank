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


class TestAnthropicParse:
    def test_slug_basic(self):
        assert scraper._anthropic_slug("Claude Opus 5") == "claude-opus-5"
        assert scraper._anthropic_slug("Claude Sonnet 4.6") == "claude-sonnet-4.6"
        assert scraper._anthropic_slug("Claude Haiku 4.5") == "claude-haiku-4.5"

    def test_slug_strips_limited(self):
        assert scraper._anthropic_slug("Claude Mythos 5 ( limited availability )") == "claude-mythos-5"

    def test_mtok_price(self):
        assert scraper._mtok_price("$10 / MTok") == 10.0
        assert scraper._mtok_price("$0.50 / MTok") == 0.5
        assert scraper._mtok_price("$5 / MTok") == 5.0
        assert scraper._mtok_price("Not available") is None
        assert scraper._mtok_price("") is None


class TestFetchAllOverride:
    def test_anthropic_overrides_existing_only(self):
        openrouter = [{"id": "anthropic/claude-opus-5", "input": 10.0, "output": 50.0, "context": 200000}]
        anthropic_rows = [
            {"id": "anthropic/claude-opus-5", "input": 5.0, "output": 25.0,
             "cache_in": 0.5, "updated": "now"},
            {"id": "anthropic/claude-mythos-5", "input": 10.0, "output": 50.0, "updated": "now"},
        ]
        with patch.object(scraper, "fetch_openrouter", return_value=openrouter), \
             patch.object(scraper, "scrape_deepseek", return_value=[]), \
             patch.object(scraper, "scrape_anthropic", return_value=anthropic_rows):
            results, errors = scraper.fetch_all()
        byid = {r["id"]: r for r in results}
        assert byid["anthropic/claude-opus-5"]["input"] == 5.0
        assert byid["anthropic/claude-opus-5"]["output"] == 25.0
        assert byid["anthropic/claude-opus-5"].get("official_price") is True
        assert byid["anthropic/claude-opus-5"]["context"] == 200000  # context kept
        assert "anthropic/claude-mythos-5" not in byid  # 无幻影行

    def test_deepseek_adds_missing(self):
        openrouter = [{"id": "openai/gpt-5", "input": 1.25, "output": 10.0, "context": 400000}]
        ds_rows = [{"id": "deepseek/deepseek-v4-flash-0731", "input": 0.077, "output": 0.154,
                    "cache_in": 0.007, "context": 1000000, "updated": "now"}]
        with patch.object(scraper, "fetch_openrouter", return_value=openrouter), \
             patch.object(scraper, "scrape_deepseek", return_value=ds_rows), \
             patch.object(scraper, "scrape_anthropic", return_value=[]):
            results, errors = scraper.fetch_all()
        byid = {r["id"]: r for r in results}
        assert "deepseek/deepseek-v4-flash-0731" in byid
        assert byid["deepseek/deepseek-v4-flash-0731"].get("official_price") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
