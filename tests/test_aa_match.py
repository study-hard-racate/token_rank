#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AA 性能数据匹配逻辑测试：_aa_bare / _aa_de_suffix / _aa_or_attempts / merge_aa_perf。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scraper


class TestAADeSuffix:
    def test_strips_known_suffixes(self):
        assert scraper._aa_de_suffix("claude-opus-5-non-reasoning") == "claude-opus-5"
        assert scraper._aa_de_suffix("gpt-5-pro") == "gpt-5"
        # 连续剥除：-thinking 剥掉后 -flash 仍在后缀表，继续剥
        assert scraper._aa_de_suffix("gemini-2.5-flash-thinking") == "gemini-2.5"
        assert scraper._aa_de_suffix("plain") == "plain"

    def test_keeps_short_remainder(self):
        # 剥掉后缀后剩余过短（≤2 字符）则不剥，避免把 "x-pro" 剥成 "x"
        assert scraper._aa_de_suffix("x-pro") == "x-pro"


class TestAABare:
    def test_basic(self):
        assert scraper._aa_bare("gpt-5") == "gpt5"
        assert scraper._aa_bare("Claude Opus 5") == "claudeopus5"
        assert scraper._aa_bare("~deepseek/deepseek-chat:free") == "deepseek/deepseekchat"

    def test_strips_suffix(self):
        assert scraper._aa_bare("gpt-5-pro") == "gpt5"
        assert scraper._aa_bare("claude-opus-5-non-reasoning") == "claudeopus5"

    def test_empty(self):
        assert scraper._aa_bare(None) == ""
        assert scraper._aa_bare("") == ""


class TestAAOrAttempts:
    def test_yields_suffix_variants(self):
        got = list(scraper._aa_or_attempts("gpt-5-pro"))
        assert got == ["gpt5pro", "gpt5"]

    def test_yields_date_stripped_variant(self):
        got = list(scraper._aa_or_attempts("deepseek-v4-flash-0731"))
        # base 去分隔符；-0731 属于 -\d{2,4}$ 也应被剥掉作为候选
        assert "deepseekv4flash0731" in got
        assert "deepseekv4flash" in got

    def test_colon_suffix_removed(self):
        got = list(scraper._aa_or_attempts("kimi-k2:free"))
        assert got == ["kimik2"]


class TestMergeAAPerf:
    def test_fills_missing_and_flags(self):
        items = [
            {"id": "openai/gpt-5", "tps": None, "ttft": None},
            {"id": "openai/gpt-5-pro", "tps": 200.0, "ttft": None},
            {"id": "unknown/model-9", "tps": None, "ttft": None},
        ]
        perf = {"gpt5": {"tps": 106.99, "ttft": 65270.0}, "gpt5pro": {"tps": 201.0, "ttft": 100.0}}
        filled, matched = scraper.merge_aa_perf(items, perf)
        assert filled == 3           # gpt-5 两个字段 + gpt-5-pro 的 ttft
        assert matched == 2          # 命中两个 id
        assert items[0]["tps"] == 106.99
        assert items[0]["ttft"] == 65270.0
        assert items[0]["aa_perf"] is True
        # 已有 tps 不覆盖，只补缺失的 ttft
        assert items[1]["tps"] == 200.0
        assert items[1]["ttft"] == 100.0
        assert items[2]["tps"] is None and items[2]["ttft"] is None

    def test_empty_perf(self):
        items = [{"id": "a/b", "tps": None, "ttft": None}]
        assert scraper.merge_aa_perf(items, {}) == (0, 0)
        assert scraper.merge_aa_perf(items, None) == (0, 0)

    def test_null_values_not_filled(self):
        items = [{"id": "openai/gpt-5", "tps": None, "ttft": None}]
        perf = {"gpt5": {"tps": None, "ttft": None}}
        assert scraper.merge_aa_perf(items, perf) == (0, 1)
        assert items[0].get("aa_perf") is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
