#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取解析器测试：用 fixture HTML/JSON（无网络）验证各解析函数。

覆盖：scrape_deepseek / scrape_anthropic / fetch_openrouter /
fetch_throughput_rank / fetch_aa_perf / fetch_all 降级路径。
"""

import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scraper


class _Resp:
    def __init__(self, text="", data=None):
        self.text = text
        self._data = data

    def json(self):
        return self._data


# ---- fixture: DeepSeek 官方定价页（OFF-PEAK 档） ----
DEEPSEEK_HTML = """<html><body><table>
  <tr><th>MODEL</th><th>Flash</th><th>Pro</th></tr>
  <tr><th>MODEL VERSION</th><td>deepseek-v4-flash-0731</td><td>deepseek-v4-pro-0813</td></tr>
  <tr><th>CONTEXT LENGTH</th><td>1M</td></tr>
  <tr><td>CACHE HIT (OFF-PEAK)</td><td>$0.007</td><td>$0.014</td></tr>
  <tr><td>PEAK CACHE HIT</td><td>$0.014</td><td>$0.028</td></tr>
  <tr><td>CACHE MISS (OFF-PEAK)</td><td>$0.077</td><td>$0.154</td></tr>
  <tr><td>PEAK CACHE MISS</td><td>$0.154</td><td>$0.308</td></tr>
  <tr><td>OUTPUT TOKENS (OFF-PEAK)</td><td>$0.154</td><td>$0.308</td></tr>
  <tr><td>PEAK OUTPUT TOKENS</td><td>$0.308</td><td>$0.616</td></tr>
</table></body></html>"""

# ---- fixture: 2026-08-29 实证的真实三列结构（OFF-PEAK/PEAK 为独立行） ----
DEEPSEEK_HTML_3COL = """<html><body><table>
  <tr><th>MODEL</th><th>deepseek-v4-flash</th><th>deepseek-v4-pro</th><th>deepseek-v4-flash-vision-exp</th></tr>
  <tr><th>MODEL VERSION</th><td>DeepSeek-V4-Flash-0731</td><td>DeepSeek-V4-Pro-0813</td><td>DeepSeek-V4-Flash-Vision-Exp</td></tr>
  <tr><th>CONTEXT LENGTH</th><td>1M</td></tr>
  <tr><td>1M INPUT TOKENS (CACHE HIT)</td><td>OFF-PEAK</td><td>$0.007</td><td>$0.022</td><td>$0.007</td></tr>
  <tr><td>PEAK</td><td>$0.014</td><td>$0.044</td><td>$0.014</td></tr>
  <tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>OFF-PEAK</td><td>$0.22</td><td>$0.66</td><td>$0.22</td></tr>
  <tr><td>PEAK</td><td>$0.44</td><td>$1.32</td><td>$0.44</td></tr>
  <tr><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.66</td><td>$1.98</td><td>$0.66</td></tr>
  <tr><td>PEAK</td><td>$1.32</td><td>$3.96</td><td>$1.32</td></tr>
</table></body></html>"""


class TestParseContext:
    def test_units(self):
        assert scraper._parse_context("1M") == 1000000
        assert scraper._parse_context("128K") == 128000
        assert scraper._parse_context("32000") == 32000
        assert scraper._parse_context("1.5M") == 1500000
        assert scraper._parse_context("") is None
        assert scraper._parse_context(None) is None
        assert scraper._parse_context("n/a") is None


class TestScrapeDeepseek:
    def test_offpeak_rows(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=DEEPSEEK_HTML))
        out = scraper.scrape_deepseek()
        assert len(out) == 3
        flash = out[0]
        assert flash["id"] == "deepseek/deepseek-v4-flash-0731"
        assert flash["input"] == 0.077     # CACHE MISS OFF-PEAK
        assert flash["output"] == 0.154    # OUTPUT TOKENS OFF-PEAK
        assert flash["cache_in"] == 0.007  # CACHE HIT OFF-PEAK
        assert flash["provider"] == "DeepSeek"
        assert flash["context"] == 1000000  # CONTEXT LENGTH 行解析（1M）
        latest = out[1]  # latest 紧随 flash 追加
        assert latest["id"] == "~deepseek/deepseek-v4-flash-latest"
        assert latest["name"] == "DeepSeek V4 Flash Latest (DeepSeek)"
        assert latest["input"] == flash["input"]
        pro = out[2]
        assert pro["id"] == "deepseek/deepseek-v4-pro-0813"
        assert (pro["input"], pro["output"], pro["cache_in"]) == (0.154, 0.308, 0.014)

    def test_context_parsed_from_row(self, monkeypatch):
        html = DEEPSEEK_HTML.replace("<td>1M</td>", "<td>128K</td>")
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=html))
        out = scraper.scrape_deepseek()
        assert out[0]["context"] == 128000

    def test_context_missing_falls_back(self, monkeypatch):
        html = DEEPSEEK_HTML.replace("<tr><th>CONTEXT LENGTH</th><td>1M</td></tr>", "")
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=html))
        out = scraper.scrape_deepseek()
        assert out[0]["context"] == scraper.DEEPSEEK_DEFAULT_CONTEXT

    def test_missing_table_raises(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text="<html>no table</html>"))
        with pytest.raises(ValueError, match="pricing table not found"):
            scraper.scrape_deepseek()

    def test_missing_model_row_raises(self, monkeypatch):
        html = DEEPSEEK_HTML.replace("<th>MODEL</th>", "<th>MODELL</th>")
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=html))
        with pytest.raises(ValueError, match="MODEL row not found"):
            scraper.scrape_deepseek()


class TestScrapeDeepseekThreeCol:
    def test_parses_all_models(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=DEEPSEEK_HTML_3COL))
        out = scraper.scrape_deepseek()
        by_id = {r["id"]: r for r in out}
        assert len(out) == 4  # flash-0731 / flash-latest / pro-0813 / vision-exp
        assert by_id["deepseek/deepseek-v4-flash-0731"]["input"] == 0.22
        assert by_id["deepseek/deepseek-v4-flash-0731"]["cache_in"] == 0.007
        assert by_id["deepseek/deepseek-v4-pro-0813"]["input"] == 0.66
        assert by_id["deepseek/deepseek-v4-pro-0813"]["output"] == 1.98
        assert by_id["deepseek/deepseek-v4-pro-0813"]["cache_in"] == 0.022
        assert by_id["deepseek/deepseek-v4-flash-vision-exp"]["input"] == 0.22
        assert by_id["deepseek/deepseek-v4-flash-vision-exp"]["output"] == 0.66
        assert all(r["context"] == 1000000 for r in out)

    def test_price_rows_shorter_than_models_skips_gracefully(self, monkeypatch):
        # 页面结构异常：3 个模型列但价格行只有 2 个值 → 只产出 flash/pro，不崩溃
        html = """<html><body><table>
  <tr><th>MODEL</th><th>a</th><th>b</th><th>c</th></tr>
  <tr><th>MODEL VERSION</th><td>V-A</td><td>V-B</td><td>V-C</td></tr>
  <tr><th>CONTEXT LENGTH</th><td>1M</td></tr>
  <tr><td>CACHE HIT (OFF-PEAK)</td><td>$0.007</td><td>$0.022</td></tr>
  <tr><td>CACHE MISS (OFF-PEAK)</td><td>$0.22</td><td>$0.66</td></tr>
  <tr><td>OUTPUT TOKENS (OFF-PEAK)</td><td>$0.66</td><td>$1.98</td></tr>
</table></body></html>"""
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=html))
        out = scraper.scrape_deepseek()
        ids = [r["id"] for r in out]
        assert "deepseek/deepseek-v4-flash-0731" in ids
        assert "deepseek/deepseek-v4-pro-0813" in ids
        assert "deepseek/deepseek-v4-flash-vision-exp" not in ids  # 价格列不足，跳过
        assert len(out) == 3  # flash + latest + pro


# ---- fixture: Anthropic 官方定价页（$/MTok） ----
ANTHROPIC_HTML = """<html><body>
<h1>API pricing</h1>
<table>
  <tr><th>Model</th><th>Base Input Tokens</th><th>Long Context</th><th>Cache Writes</th><th>Cache Hits &amp; Refreshes</th><th>Output Tokens</th></tr>
  <tr><td>Claude Opus 5</td><td>$5 / MTok</td><td>$15 / MTok</td><td>$6.25 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
  <tr><td>Claude Sonnet 4.6 ( limited availability )</td><td>$3 / MTok</td><td>$9 / MTok</td><td>$3.75 / MTok</td><td>$0.30 / MTok</td><td>$15 / MTok</td></tr>
</table>
</body></html>"""


class TestScrapeAnthropic:
    def test_parse(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=ANTHROPIC_HTML))
        out = scraper.scrape_anthropic()
        by_id = {r["id"]: r for r in out}
        assert by_id["anthropic/claude-opus-5"]["input"] == 5.0
        assert by_id["anthropic/claude-opus-5"]["output"] == 25.0
        assert by_id["anthropic/claude-opus-5"]["cache_in"] == 0.5
        assert by_id["anthropic/claude-opus-5"]["name"] == "Claude Opus 5 (Anthropic)"
        sonnet = by_id["anthropic/claude-sonnet-4.6"]
        assert (sonnet["input"], sonnet["output"], sonnet["cache_in"]) == (3.0, 15.0, 0.3)
        # 括号中的 "limited availability" 应被 slug 去掉
        assert "anthropic/claude-sonnet-4.6" in by_id

    def test_no_table_raises(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text="<html>none</html>"))
        with pytest.raises(ValueError, match="anthropic pricing table not found"):
            scraper.scrape_anthropic()


# ---- fixture: OpenRouter /api/v1/models JSON ----
OPENROUTER_JSON = {
    "data": [
        {
            "id": "openai/gpt-5",
            "name": "GPT-5",
            "context_length": 400000,
            "pricing": {"prompt": 0.00000125, "completion": 0.00001, "input_cache_read": 0.000000625},
            "top_provider": {},
            "benchmarks": {"artificial_analysis": {"intelligence_index": 90.5, "coding_index": 92.0, "agentic_index": 88.0}},
        },
        {
            "id": "x-ai/grok-4.6",
            "name": "Grok 4.6",
            "context_length": 131072,
            "pricing": {"prompt": 0.000002, "completion": 0.000006, "input_cache_read": 0.0},
        },
        {
            "id": "weird-vendor/alpha-1",
            "name": "Alpha 1",
            "context_length": 8000,
            "pricing": {"prompt": 0.0000005, "completion": 0.000001},
        },
        {"id": "plain-model", "name": "Plain", "context_length": 0, "pricing": {"prompt": 0.000001, "completion": 0.000002}},
        {"id": "broken/no-pricing", "name": "No Pricing", "context_length": 0, "pricing": {}},
        {"id": "free/model", "name": "Free", "context_length": 0, "pricing": {"prompt": 0, "completion": 0}},
    ]
}


class TestFetchOpenrouter:
    def test_parse_and_provider_map(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(data=OPENROUTER_JSON))
        out = scraper.fetch_openrouter()
        by_id = {r["id"]: r for r in out}
        # 价格换算：per-token → per-1M
        assert by_id["openai/gpt-5"]["input"] == 1.25
        assert by_id["openai/gpt-5"]["output"] == 10.0
        assert by_id["openai/gpt-5"]["cache_in"] == 0.625
        assert by_id["openai/gpt-5"]["context"] == 400000
        assert by_id["openai/gpt-5"]["provider"] == "OpenAI"
        assert by_id["openai/gpt-5"]["intel"] == 90.5
        assert by_id["openai/gpt-5"]["code"] == 92.0
        assert by_id["openai/gpt-5"]["agentic"] == 88.0
        # 0 的缓存价 → None（避免 0 值误导）
        assert by_id["x-ai/grok-4.6"]["cache_in"] is None
        assert by_id["x-ai/grok-4.6"]["provider"] == "xAI"
        # 未知前缀厂商：保留原始前缀（非 Unknown）
        assert by_id["weird-vendor/alpha-1"]["provider"] == "weird-vendor"
        # id 无 "/" → Unknown
        assert by_id["plain-model"]["provider"] == "Unknown"
        # 无定价 / 全 0 价格被跳过
        assert "broken/no-pricing" not in by_id
        assert "free/model" not in by_id

    def test_pricing_missing_skipped(self, monkeypatch):
        data = {"data": [{"id": "a/b", "name": "B", "context_length": 1, "pricing": {"prompt": None, "completion": None}}]}
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(data=data))
        assert scraper.fetch_openrouter() == []


class TestFetchThroughputRank:
    def test_rank(self, monkeypatch):
        data = {"data": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(data=data))
        r = scraper.fetch_throughput_rank()
        assert r == {"a": (0, 3), "b": (1, 3), "c": (2, 3)}


# ---- fixture: AA 详情页内嵌转义 JSON ----
AA_HTML = r"""<html><body><script>
window.__DATA__ = {\"models\":[
  {\"slug\":\"gpt-5\",\"outputSpeedVariance\":{\"median\":106.99},\"timeToFirstAnswerToken\":{\"total\":65.27}},
  {\"slug\":\"claude-opus-5\",\"outputSpeedVariance\":{\"median\":54.44},\"timeToFirstAnswerToken\":{\"total\":37.41}},
  {\"slug\":\"gemma-4-31b-it\",\"outputSpeedVariance\":{\"median\":null},\"timeToFirstAnswerToken\":{\"total\":null}}
]};
</script></body></html>"""


class TestFetchAAPerf:
    def test_parse(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text=AA_HTML))
        out = scraper.fetch_aa_perf()
        assert out["gpt5"]["tps"] == 106.99
        assert out["gpt5"]["ttft"] == 65270.0      # 秒 → 毫秒
        assert out["claudeopus5"]["tps"] == 54.44
        assert out["claudeopus5"]["ttft"] == 37410.0
        assert out["gemma431bit"]["tps"] is None
        assert out["gemma431bit"]["ttft"] is None

    def test_no_models_array_raises(self, monkeypatch):
        monkeypatch.setattr(scraper, "_http_get", lambda *a, **k: _Resp(text="<html>nothing</html>"))
        with pytest.raises(ValueError, match="models array not found"):
            scraper.fetch_aa_perf()


class TestFetchAllFallback:
    def test_all_sources_fail_uses_fallback(self, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("network down")

        monkeypatch.setattr(scraper, "fetch_openrouter", boom)
        monkeypatch.setattr(scraper, "scrape_deepseek", boom)
        monkeypatch.setattr(scraper, "scrape_anthropic", boom)
        results, errors = scraper.fetch_all()
        assert len(results) == len(scraper.FALLBACK)
        assert [r["id"] for r in results] == [f["id"] for f in scraper.FALLBACK]
        assert any("all sources failed, using built-in fallback" in e for e in errors)
        # 每条 fallback 都带 updated 时间戳
        assert all(r.get("updated") for r in results)

    def test_partial_failure_keeps_openrouter_and_records_error(self, monkeypatch):
        def ok_openrouter(*a, **k):
            return [{"id": "openai/gpt-5", "input": 1.25, "output": 10.0}]

        def boom_ds(*a, **k):
            raise RuntimeError("ds down")

        def boom_an(*a, **k):
            raise RuntimeError("an down")

        monkeypatch.setattr(scraper, "fetch_openrouter", ok_openrouter)
        monkeypatch.setattr(scraper, "scrape_deepseek", boom_ds)
        monkeypatch.setattr(scraper, "scrape_anthropic", boom_an)
        results, errors = scraper.fetch_all()
        assert [r["id"] for r in results] == ["openai/gpt-5"]
        # 错误消息格式为 "{函数名}: {异常摘要}"
        assert any("boom_ds" in e and "ds down" in e for e in errors)
        assert any("boom_an" in e and "an down" in e for e in errors)
        assert not any("fallback" in e for e in errors)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
