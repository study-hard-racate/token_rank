# LLM Token 定价排行榜

> 当前版本：v42（版本历史见 HANDOVER.md）

用 Python 实时爬取各大模型 API 的 Token 费用，前端渲染出一个可筛选、可排序的排行榜网页。

## 功能

- 实时爬取 [OpenRouter 公开 API](https://openrouter.ai/docs/api-reference/list-models) 中数百个模型的价格，并补充抓取 DeepSeek 官方定价页
- 价格统一换算为 **$/100 万 tokens**
- 排行默认按输入价格从低到高，可切换按输出价格 / 上下文长度 / 名称排序
- 支持按厂商、价格上限过滤和关键字搜索
- 每 6 小时后台自动刷新，缓存到本地 `data.json`
- **价格历史**：每次抓取自动记录每日快照（`history.json`，保留 45 天）；模型名后的"历史"按钮可查看近 1 周 / 近 1 月输入、输出价格走势折线图；表格价格旁显示近 7 天涨跌幅徽章（▲/▼x%）
- **综合推荐**：价格/能力/速度按权重档位（均衡/性价比/性能优先）合成综合分；场景切换（通用/编程/智能体）决定能力分取哪个指数；点击综合分可查看明细构成
- **实惠榜**：暂无能力指数数据的模型单独成榜，按输入价从低到高推荐，不参与综合评分（诚实标注数据限制）
- **模型对比**：勾选最多 6 个模型，底部对比栏弹出横向字段对比（价格/缓存价/上下文/能力指数/速度/综合分）
- 服务器端尽力从 Wayback Machine 回补官方定价页近一个月的存档（失败自动跳过，不影响主功能）
- 提供厂商概览统计与 Top 10 价格柱状图（Chart.js）

## 本地运行

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt      # Windows
# 或 source .venv/bin/pip install -r requirements.txt  # Linux/macOS

.venv\Scripts\python app.py                        # 启动（本地开发调试用，默认端口 8081）
```

打开 http://127.0.0.1:8081 即可。

## 免费部署到公网

### 方案一：Render（推荐，有配套 render.yaml）

1. 把本项目推到你的 GitHub 仓库
2. 打开 https://render.com → New → Blueprint，选择该仓库
3. Render 会自动读取 `render.yaml` 部署到免费 Web Service 并生成公网地址（如 `https://token-rank.onrender.com`）

注意：Render 免费实例在长时间无访问后会休眠，下一个请求时自动唤醒（首次约 30–60 秒）。

### 方案二：Hugging Face Spaces（免费，支持 Docker，永不休眠同 Render 也免费但有冷却）

本项目自带 `Dockerfile`，可直接:

1. 创建 Space → `Docker` → SDK 选 Docker，填 `python:3.12-slim`
2. `git add .` 并 push 上去，几分钟后即获得 `https://<名字>hf.space` 公网地址
3. 需要把端口改为 `7860`：在 HF 上把它额外暴露的端口设成 7860（Space 需以 `$PORT` 为准，已支持）

### 方案三：Cloudflare Workers 后端 + 免费域名

不适用本项目（需要管理后台），请使用上面两种方案。

> **注意：** PythonAnywhere 已停止维护，不再作为部署选项。当前主要部署方式为 GitHub Pages（静态模式）。

## 说明

- 因为各官网多采用 JS 动态渲染，稳定抓取官方页有时会失败；代码会自动回退到内置的常用模型价格清单（`scraper.py` 的 `FALLBACK`），保证页面始终有数据。
- 如需修改刷新间隔，改 `scraper.py` 里的 `REFRESH_INTERVAL`（单位秒）。