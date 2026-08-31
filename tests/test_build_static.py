#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_static.py 测试：write_data / copy_frontend / main 离线构建。

所有写操作重定向到 tmp_path（SITE 被替换），读取仍用真实 ROOT 下的
模板、静态资源与 data.json（只读，不触碰受保护数据文件）。
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_static


class TestWriteData:
    def test_structure(self, monkeypatch, tmp_path):
        monkeypatch.setattr(build_static, "SITE", str(tmp_path))
        items = [{"id": "a", "input": 1.0, "ps": 100.0, "pf": {"general": {"v": 5.0, "src": "intel"}}, "sp": 50.0}]
        build_static.write_data(items, {"updated": "t", "errors": ["e"], "aa_perf_at": None,
                                        "aa_perf_stale": True, "aa_perf_error": "aa down"})
        data = json.loads((tmp_path / "data.json").read_text(encoding="utf-8"))
        assert data["updated"] == "t"
        assert data["errors"] == ["e"]
        assert data["items"][0]["ps"] == 100.0
        assert data["aa_perf_stale"] is True
        assert data["aa_perf_error"] == "aa down"


class TestCopyFrontend:
    def test_relativizes_paths(self, monkeypatch, tmp_path):
        monkeypatch.setattr(build_static, "SITE", str(tmp_path))
        build_static.copy_frontend()
        index = (tmp_path / "index.html").read_text(encoding="utf-8")
        assert 'src="static/app.js?v=37"' in index
        assert 'href="static/style.css?v=35"' in index
        assert 'href="about.html"' in index
        assert 'src="/static/' not in index
        for name in ("app.js", "utils.js", "style.css", "chart.umd.min.js", "favicon.svg"):
            assert (tmp_path / "static" / name).exists()

    def test_about_paragraph_replaced(self, monkeypatch, tmp_path):
        monkeypatch.setattr(build_static, "SITE", str(tmp_path))
        build_static.copy_frontend()
        about = (tmp_path / "about.html").read_text(encoding="utf-8")
        assert "本站由 GitHub Actions 定时任务每 6 小时自动爬取记录" in about
        assert "免费托管层无常驻定时任务" not in about
        assert "本站部署于 GitHub Pages，由 Actions 定时更新，无 off-peak 时段限制" in about


class TestMainOffline:
    def test_offline_build(self, monkeypatch, tmp_path):
        monkeypatch.setattr(build_static, "SITE", str(tmp_path))
        monkeypatch.setattr(build_static, "fetch_online_data", lambda: None)
        monkeypatch.setattr(sys, "argv", ["build_static.py", "--offline"])
        build_static.main()
        data = json.loads((tmp_path / "data.json").read_text(encoding="utf-8"))
        assert len(data["items"]) > 100          # 真实 data.json 的模型数
        it = data["items"][0]
        assert "ps" in it and "sp" in it         # 评分字段已写入
        assert set(it["pf"].keys()) == {"general", "code", "agent"}
        assert (tmp_path / "index.html").exists()
        assert (tmp_path / "history.json").exists()
        hist = json.loads((tmp_path / "history.json").read_text(encoding="utf-8"))
        assert all(isinstance(v, list) for v in hist.values())   # 非数组键（_last_backfill）已清理


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
