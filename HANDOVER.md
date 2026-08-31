# LLM Token 定价排行榜 - 项目交接文档

> 生成时间: 2026-08-21
> 交接对象: 新会话
> 项目版本: v45

---

## 1. 最终目标 (Final Goal)

构建并维护一个自动化的 LLM Token 定价排行榜系统，定期从多个 LLM 提供商抓取定价数据，生成静态网站并发布到 GitHub Pages，为用户提供清晰的价格对比参考。

**核心功能:**
- 自动抓取多个 LLM 提供商的 Token 定价数据
- 支持多种定价维度 (input/output/cached 等)
- 生成可视化排行榜和价格图表
- 双模式前端: 静态模式 (GitHub Pages) + API 模式 (PythonAnywhere)

---

## 2. 关键背景 (Key Background)

- **项目目录:** `D:\DeepSeek\deepseek harnes\token_rank`（以此为准）
- **GitHub 仓库:** https://github.com/study-hard-racate/token_rank
- **GitHub Pages:** https://study-hard-racate.github.io/token_rank/
- **PythonAnywhere:** https://byj.pythonanywhere.com/ (已停止维护)
- **本地测试端口:** 8081 (8080 被占用)
- **当前版本:** v45
- **数据原则:** 永不伪造数据 (Data honesty principle)

---

## 3. 已经确认的事实 (Confirmed Facts)

### 项目结构（实际目录，以此为准）
```
token_rank/
├── .github/workflows/    # GitHub Actions 定时任务 (update-data.yml)
├── site/                 # 构建产物（= gh-pages 分支根）
├── static/               # 前端静态资源 (app.js, utils.js, style.css, chart.umd.min.js, favicon.svg)
├── templates/            # 页面模板 (index.html 等)
├── tests/                # 测试（80 项：test_scraper / test_scoring / test_scraper_parsers / test_scraper_history / test_aa_match / test_build_static / test_app_api / test_scraper_refresher + share_link_smoke.mjs / calccomp_bridge.mjs）
├── build_static.py       # 静态站点构建脚本（评分逻辑来自 scoring.py）
├── app.py                # Flask API 应用（本地开发调试用；评分逻辑来自 scoring.py）
├── scraper.py            # 数据抓取脚本
├── scoring.py            # 评分逻辑唯一实现（v43 起，ps/pf/sp/comp；前端 calcComp 与其对拍等价）
├── requirements.txt      # Python 依赖
├── requirements-dev.txt  # 开发/测试依赖（pytest）
├── .gitignore            # Git 忽略规则
├── README.md
├── HANDOVER.md           # 本交接文档
├── data.json             # 当前定价数据
├── history.json          # 历史定价数据
└── aa_perf.json          # AA 性能数据
```

### 数据源
- OpenRouter API (主要数据源)
- DeepSeek 官方定价页 (价格覆盖 OpenRouter)
- Artificial Analysis (性能数据 aa_perf)

### GitHub Actions 配置
- **Cron 时间:** `0 22,4,10,16 UTC` (每 6 小时)
- **触发方式:** 定时 + push to main + 手动触发 (push 即部署)
- **错峰策略:** 避开高峰期

### 历史数据缺失
- **永久缺失日期:** 08-13, 08-15, 08-16, 08-17
- **原因:** 项目早期阶段未建立完整的数据抓取机制

### Git 配置
- **SSL 后端:** `openssl` (全局配置)
- **原因:** Windows 环境下解决 Git 操作的 SSL 问题

---

## 4. 长期偏好 (Long-term Preferences)

1. **数据完整性优先:** 宁可缺失数据，也绝不伪造数据
2. **版本迭代记录:** 每次重大更新都更新版本号 (v1, v2, ..., v45)
3. **双模式兼容:** 前端必须同时支持静态模式和 API 模式
4. **错误处理:** 数据抓取失败时记录日志，不影响整体流程
5. **历史数据保留:** 所有历史数据必须持久化保存

---

## 5. 硬性规则 (Hard Rules)

1. **永不伪造数据:** 如果无法获取真实数据，必须标记为缺失，不能编造
2. **Git SSL 配置:** 必须保持 `sslBackend = openssl` 全局配置
3. **端口使用:** 本地测试使用 8081，不得使用 8080
4. **版本更新:** 每次重大修改必须更新版本号
5. **历史数据不可删除:** 已保存的历史数据文件不能删除或覆盖
6. **Actions 定时任务:** Cron 时间不得随意更改，需评估错峰策略

---

## 6. 输出格式 (Output Format)

> 以下为**实际数据结构**（与旧交接版假想的 `date/version/models` + `input_price/output_price/cached_price` 不同，以此为准）。价格单位为 **USD / 1M tokens**；字段可能为 `null`（表示该项缺失，绝不伪造）。

### 数据文件: `data.json`（当前定价快照）
```json
{
  "updated": "2026-08-23T07:41:38.846306+00:00",
  "errors": [],
  "aa_perf_at": "2026-08-10T12:03:02.061024+00:00",
  "items": [
    {
      "id": "inclusionai/ling-2.6-flash",
      "name": "inclusionAI: Ling-2.6-flash (InclusionAI)",
      "provider": "InclusionAI",
      "input": 0.01,
      "output": 0.03,
      "cache_in": 0.002,
      "context": 262144,
      "intel": 14.2,
      "code": 25.3,
      "agentic": 2.3,
      "tps": null,
      "ttft": null,
      "updated": "2026-08-23T07:41:37.059455+00:00",
      "speed_rank": 70,
      "speed_pct": 83.6,
      "ps": 100.0,
      "pf": {"general": {"v": 14.2, "src": "intel"}, "code": {"v": 25.3, "src": "code"}, "agent": {"v": 2.3, "src": "agentic"}},
      "sp": 83.6
    }
  ]
}
```

`items[]` 字段说明:
- `id` / `name` / `provider`: 模型标识（形如 `provider/model`）、显示名、提供商
- `input` / `output` / `cache_in`: 价格（USD / 1M tokens），`null` 表示该项缺失
- `context`: 上下文窗口（tokens）
- `intel` / `code` / `agentic`: 三类任务的性能评分
- `tps` / `ttft`: 每秒 tokens / 首 token 延迟
- `speed_rank` / `speed_pct`: 速度排名与百分位
- `ps` / `sp`: 价格分 / 速度分
- `pf`: 各维度性能取值及来源（`src` = intel / code / agentic）
- `official_price`（可选布尔）: 该条目已被 DeepSeek 官方价覆盖

### 数据文件: `history.json`（历史价，按键模型索引）
```json
{
  "deepseek/deepseek-chat": [
    {"date": "2026-08-07", "input": 0.27, "output": 1.10},
    {"date": "2026-08-08", "input": 0.27, "output": 1.10}
  ]
}
```
键为模型 `id`，值为按日期升序的 `{date, input, output}` 记录数组（仅含 input/output，无 cache）。

### 前端输出
- 构建产物: `build_static.py` 生成 `site/`（即 gh-pages 分支根），含 `data.json`、`history.json`、`aa_perf.json`、`static/*`、`index.html`、`about.html`
- 静态模式: 读取 `site/data.json` + `site/history.json`
- API 模式: Flask 接口 `/api/pricing`（PythonAnywhere，已弃用）

---

## 7. 已完成的工作 (Completed Work)

### v34-v45 完成内容
| 版本 | 内容 |
|------|------|
| v34 | 清理 PythonAnywhere 引用，完善 `.gitignore` |
| v35 | 高优先级优化（删除废弃配置、修复 app.py 说明） |
| v36 | 三项 UX 优化（URL 分享、深色模式自动切换、固定表头） |
| v37 | Actions 增加 push 触发，推送即部署 |
| v38 | 修复 3 处 providerChips 空引用 Bug |
| v39 | 移动端适配 + 三项 UX 优化 |
| v40 | 添加 Python 单元测试（6/6 通过） |
| v41 | Phase 1 低风险卫生项（清理残留/开发依赖/CI 测试门禁/文档统一/死代码清理） |
| v42 | 修复「分享链接」按钮失效（事件绑定缺失）；新增前端冒烟测试并接入 CI |
| v43 | Phase 2 评分逻辑去重（scoring.py 唯一实现，Python/JS 对拍锁等价） |
| v44 | Phase 3 测试覆盖补齐（fixture 解析/历史回补/AA 合并/构建/API 契约/Refresher，80 项） |
| v45 | Phase 4 数据可靠性（sort 实证、DeepSeek context 解析 + vision-exp、aa_perf 陈旧标记） |

### 上轮改动（提交号：94d5218 → 3f749fb；项目版本 v40）
| 类型 | 内容 |
|------|------|
| 运维 | 短期三项核查通过：GitHub Pages 部署正常、定时任务（cron `0 22,4,10,16`）全部成功、数据完整性无伪造/无缺失 |
| 数据 | AA 性能缓存 TTL 由 30 天改 **24 小时**，修复 `aa_perf_at` 长期滞留 08-10 的问题；同步/合并 gh-pages 数据到本地 |
| 抓取 | 新增 **Anthropic 官方定价页**解析（官方价覆盖 OpenRouter，仅覆盖已有 id 避免幻影行，保留 DeepSeek 行为）；重构 `fetch_all` 为通用官方源覆盖 |
| 前端 | 修复主表格纵向滚动；模型列 sticky；表头排序高亮+点击排序；工具栏窄屏折叠；新手教学改非阻塞式侧边抽屉 |
| 前端 | 视觉打磨（渐变标题+眉标、卡片标题强调条、控件聚焦/悬浮反馈、更宽布局）；缓存版本 `?v=36` |
| 前端 | 模块化：拆分纯工具层 `static/utils.js`（app.js 保留页面编排） |
| 文档 | 修正 §6 schema 为真实结构；更新目录/结构；补 v34–v40 记录 |

### 上轮改动（v41：Phase 1 低风险卫生项，2026-08-25）
| 类型 | 内容 |
|------|------|
| 清理 | 删除根目录 9 个空 `pytest-cache-files-*` 残留目录；`.gitignore` 增加 `pytest-cache-files-*/`、`.pytest_cache/` |
| 工具链 | 新增 `requirements-dev.txt`（pytest），开发依赖与生产依赖分离 |
| CI | `update-data.yml` 构建前增加 pytest 测试步骤，**测试失败即中止，不发布** |
| 测试 | 修复 `TestCollect` 测试污染：未 patch 的 `fetch_aa_perf` 会让测试真实抓取 AA 页面（约 3MB）并**写入 aa_perf.json**；已补 patch，测试完全离线（0.14s 完成、不落盘），为 CI 门禁扫清障碍 |
| 文档 | README 端口统一为 8081；HANDOVER 修正实际项目路径（`D:\DeepSeek\deepseek harnes\token_rank`） |
| 代码 | `app.py` 默认端口改为 8081（与硬规则一致，仅本地开发用）；删除死代码 `_parse_usd` |
| 版本 | v40 → v41 |

### 上轮改动（v42：分享链接按钮修复，2026-08-25）
| 类型 | 内容 |
|------|------|
| Bug | **「分享链接」按钮完全失效**：`#share-link` 在 app.js 中无任何事件绑定（v36 加入 URL 分享后，后续前端重构丢失了点击处理器）；已补：先 `saveStateToURL()` 同步当前筛选到 URL，再复制 `location.href` 到剪贴板，按钮显示「✓ 已复制」反馈 |
| 兼容 | 复制支持两种路径：安全上下文（https，GitHub Pages）用 `navigator.clipboard`；非安全上下文（本地 http://127.0.0.1）降级 `execCommand` |
| 缓存 | `app.js` 缓存版本号 `?v=36` → `?v=37`（避免旧版缓存导致修复不生效） |
| 测试 | 新增 `tests/share_link_smoke.mjs` 无头 Node 冒烟测试：加载真实 app.js，模拟点击，断言剪贴板收到含筛选参数的 URL（安全/降级双路径），并接入 CI（`node tests/share_link_smoke.mjs`） |
| 版本 | v41 → v42 |

### 上轮改动（v43：Phase 2 评分逻辑去重，2026-08-29）
| 类型 | 内容 |
|------|------|
| 重构 | 新增 **`scoring.py`** 作为评分逻辑唯一实现（`SCENES`/`SCENE_ORDER`/`WEIGHTS`/`scene_index`/`add_scores`/`composite`）；`build_static.py` 与 `app.py` 删除各自重复的 `_add_scores`/`_composite`/`scene_index` 等，统一调用 scoring |
| 结构 | 统一 `pf` 数据形态：data.json 持久化为 3 场景 dict（原 build_static 结构不变，前端静态模式零改动）；API 模式由 `api_data` 按请求场景展平为标量（响应形状与 v42 完全一致） |
| 修复 | **对拍测试抓到两处真实分歧并修复**：① Python `round()` 银行家舍入 vs JS `Math.round` 半进位，在 .x5 边界差 0.1 → composite 改半进位；② CPython 3.12+ 内置 `sum()` 对 float 做补偿求和，在 .x5 边界与 JS 朴素累加差 1 ulp（真实数据 3330 组对拍曾现 17 处分歧）→ composite 改朴素顺序累加，现与 JS **逐位一致** |
| 测试 | 新增 `tests/test_scoring.py`（29 项：scene_index/add_scores/composite 单测 + 对拍测试），新增 `tests/calccomp_bridge.mjs`（从真实 app.js 提取 calcComp 供 pytest 对拍）；全套 29/29 通过 |
| 验证 | 重构后构建与 v42 产物对比：共同 id 的 ps/pf **零差异**（sp 差异为数据漂移，非逻辑）；真实数据 3330 组 Python/JS 对拍**零分歧**；app.py API 端到端形状不变；8081 静态服务正常 |
| 版本 | v42 → v43 |

### 上轮改动（v44：Phase 3 测试覆盖补齐，2026-08-29）
| 类型 | 内容 |
|------|------|
| 测试 | 新增 6 个测试文件、51 项用例，全套 **80/80 通过**（1.2s，无网络、不落盘） |
| 解析 | `test_scraper_parsers.py`：DeepSeek/Anthropic 官方页 **fixture HTML** 解析（含缺表/缺行异常路径）、OpenRouter JSON（价格换算/厂商映射/0 缓存价/无 `/` 厂商）、吞吐排名、AA 内嵌 JSON 解析（秒→毫秒）、`fetch_all` 全源失败 → FALLBACK 降级 + 部分失败保数据 |
| 历史 | `test_scraper_history.py`：record_history 同日替换 + 45 天裁剪、get_history 过滤、**Wayback backfill**（CDX + 快照 HTML 全链路，tmp_path 隔离）、maybe_backfill 标记/门限、_row_model_id/_monies、cache/history 文件往返 |
| AA | `test_aa_match.py`：_aa_bare/_aa_de_suffix/_aa_or_attempts 边界（连续剥后缀、日期后缀、冒号变体）、merge_aa_perf（仅补缺失 + aa_perf 标记 + 空值不补） |
| 构建 | `test_build_static.py`：write_data 结构、copy_frontend 相对路径化 + about 段落替换、**main 离线全流程**（SITE 重定向 tmp，不触碰受保护数据） |
| API | `test_app_api.py`：Flask test_client 锁定 Phase 2 响应契约（ps/pf 标量/pf_src/sp/comp）、实惠榜排序、筛选/排序/未知权重回退 |
| 线程 | `test_scraper_refresher.py`：Refresher 陈旧触发/新鲜跳过/并发去重/阻塞刷新 |
| 说明 | 新增用例均为行为锁定（fixture 与解析逻辑严格对应）；期间修正 5 处测试自身预期错误（输出顺序、Unknown 语义、连续剥后缀、_last_backfill 读取、bound method 名称） |
| 版本 | v43 → v44 |

### 本轮（本会话）改动（v45：Phase 4 数据可靠性，2026-08-31）
| 类型 | 内容 |
|------|------|
| 实证① | **OpenRouter `sort=throughput-high-to-low` 参数确认有效**：实测 396 个模型 id 集合一致但顺序完全重排，头部为 mercury-2 / nova-micro 等高吞吐模型；`fetch_throughput_rank` 逻辑维持不变，代码注释固化验证结论与失效预案 |
| 实证② | **DeepSeek 官方页已升级为三列**（新增 `deepseek-v4-flash-vision-exp`），且有 `CONTEXT LENGTH | 1M` 行；据此：`scrape_deepseek` 从硬编码 `context=1000000` 改为**解析页面值**（`_parse_context` 支持 1M/128K/裸数字，行缺失兜底 1000000），并**新增 vision-exp 官方条目**（此前被静默丢弃） |
| 健壮性 | `scrape_deepseek` 增加价格列越界保护：价格行短于模型列时跳过该列而非整源崩溃（页面结构变化时保底降级） |
| 陈旧策略 | `collect()` 产出新增 `aa_perf_stale` / `aa_perf_error` 字段：**抓取失败回退旧缓存时如实标记**（此前前端只能靠「>30 天」启发式猜测）；build_static / app.py 透传；前端 renderMeta 与模型详情展示「⚠ AA 性能抓取失败，当前用缓存」+ 缓存数据时间 |
| 测试 | 新增 9 项（`_parse_context`、context 解析/兜底、三列全模型、越界保护、collect 三路径 stale 标记、build_static/app 透传断言），全套 **89/89 通过**；`node --check` 通过 |
| 版本 | v44 → v45 |

### 核心功能
- ✅ 多数据源定价抓取 (DeepSeek, OpenRouter 等)
- ✅ 静态网站生成 (`build_static.py`)
- ✅ 双模式前端 (静态 + API)
- ✅ GitHub Pages 自动部署
- ✅ 定时数据更新 (GitHub Actions)
- ✅ 历史数据存储和查询

---

## 8. 重要决策及其理由 (Key Decisions and Rationale)

| 决策 | 理由 |
|------|------|
| 使用 GitHub Pages 作为主要部署平台 | 免费、稳定、与 GitHub Actions 无缝集成 |
| 采用双模式前端架构 | 兼顾免费部署 (GitHub Pages) 和动态数据 (PythonAnywhere) |
| DeepSeek 官方价格覆盖 OpenRouter | 官方价格更准确，避免第三方加价 |
| AA 性能缓存 24 小时 TTL（本轮） | 30 天→24 小时，避免性能数据长期滞留；超期才重新抓取 |
| Anthropic 官方价覆盖 OpenRouter（本轮） | 官方价更准；仅覆盖已有 id 避免幻影行；Google（分档/模态价）与 OpenAI（JS 渲染）暂不抓取 |
| 定时任务每 6 小时执行一次 | 平衡数据时效性和 API 调用限制 |
| SSL 使用 openssl 后端 | 解决 Windows 环境下的 SSL 兼容性问题 |
| 本地测试使用 8081 端口 | 8080 端口已被占用 |

---

## 9. 被否定的方案 (Rejected Approaches)

| 方案 | 否定原因 |
|------|----------|
| PythonAnywhere 作为主要部署平台 | 已停止维护，不适合长期使用 |
| 实时爬取所有数据源 | API 调用限制和成本问题 |
| 单一前端模式 | 无法同时满足免费部署和动态数据需求 |
| 使用 worktree 恢复历史数据 | 机制复杂且容易损坏，改用 git show |
| 前端 ES-module 全量拆分 | app.js 大量函数经共享 state/全局 helper 强耦合且站点已部署，回归风险高；此前一次拆分曾损坏该文件；已改为低风险的工具层拆分（utils.js） |

---

## 10. 当前进度 (Current Progress)

**版本:** v45
**状态:** ✅ 稳定运行

- [x] 核心数据抓取功能完成
- [x] 静态网站构建完成
- [x] 双模式前端实现完成
- [x] GitHub Pages 部署配置完成
- [x] GitHub Actions 定时任务配置完成
- [x] v34-v40 修复和优化完成
- [x] 短期三项核查通过（部署/定时任务/数据完整性）
- [x] 上轮改动：AA TTL 修复、Anthropic 官方源、前端多轮打磨、utils.js 模块化
- [x] Python 单元测试完成（11/11 通过）
- [x] v41：Phase 1 低风险卫生项完成（清理残留/requirements-dev/CI 测试门禁/文档统一/死代码清理）
- [x] v42：分享链接按钮修复 + 前端冒烟测试接入 CI
- [x] v43：Phase 2 评分逻辑去重完成（scoring.py 唯一实现；Python/JS 对拍 3330 组零分歧；29/29 测试通过）
- [x] v44：Phase 3 测试覆盖补齐完成（fixture 解析/历史回补/AA 合并/构建/API 契约/Refresher；80/80 测试通过）
- [x] v45：Phase 4 数据可靠性完成（sort 参数实证、DeepSeek context 解析 + vision-exp、aa_perf_stale 标记；89/89 测试通过）

---

## 11. 尚未完成的任务 (Pending Tasks)

### 短期（本轮已完成，后续按需抽查）
- [x] 监控 GitHub Pages 部署状态
- [x] 验证定时任务执行日志
- [x] 检查数据完整性

### 中期
- [x] 优化数据抓取脚本（新增 Anthropic 官方定价源）
- [x] 改进前端 UI/UX 设计（多轮迭代）
- [ ] 添加数据导出功能（CSV 已支持，待加 Excel .xlsx）

### 长期
- [ ] 考虑替代 PythonAnywhere 的方案 (如 Vercel/Netlify)
- [ ] 实现历史数据恢复补全
- [ ] 添加价格趋势分析功能

---

## 12. 不能随意修改的内容 (Protected Items)

1. **历史数据文件:** 根目录下 `data.json` / `history.json` / `aa_perf.json`（不可删除或覆盖）
2. **版本号:** 当前版本为 v45，修改需有明确理由
3. **Git 全局配置:** `sslBackend = openssl`
4. **GitHub Actions Cron 时间:** `0 22,4,10,16 UTC`
5. **数据原则:** 永不伪造数据
6. **端口配置:** 本地测试使用 8081
7. **DeepSeek 价格覆盖逻辑:** 官方价格必须覆盖 OpenRouter 价格

---

## 13. 新会话接下来应该先做什么 (Next Steps for New Session)

### 第一步: 验证环境
```bash
cd "D:\DeepSeek\deepseek harnes\token_rank"
git status
git log --oneline -10
python --version
```

### 第二步: 检查项目状态
- 查看根目录 `data.json` / `history.json` / `aa_perf.json` 的最新数据
- 检查 `static/` 目录下的网站文件
- 验证 `build_static.py` 能否正常运行

### 第三步: 测试本地运行
```bash
python build_static.py
python -m http.server 8081 --directory site
```

### 第四步: 检查 GitHub Actions
- 访问 https://github.com/study-hard-racate/token_rank/actions
- 查看最近的 workflow 执行状态
- 验证定时任务是否正常运行

### 第五步: 根据用户需求执行任务
- 如果是功能开发，先阅读现有代码结构
- 如果是 bug 修复，先复现问题并定位原因
- 如果是数据问题，检查数据抓取脚本和历史数据文件

---

## 附录: 常用命令速查

```bash
# 查看当前版本
git log --oneline -1

# 运行静态站点构建
python build_static.py

# 启动本地服务器 (端口 8081)
python -m http.server 8081 --directory site

# 检查数据文件
ls -la data.json history.json aa_perf.json

# 查看 GitHub Actions 日志
gh run list --limit 5

# 提交更改
git add .
git commit -m "v41: description"
git push origin main
```

---

*文档结束*
