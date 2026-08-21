# LLM Token 定价排行榜 - 项目交接文档

> 生成时间: 2026-08-21
> 交接对象: 新会话 (opencode)
> 项目版本: v33

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

- **项目目录:** `D:\opencode_demo\token_rank`
- **GitHub 仓库:** https://github.com/study-hard-racate/token_rank
- **GitHub Pages:** https://study-hard-racate.github.io/token_rank/
- **PythonAnywhere:** https://byj.pythonanywhere.com/ (已停止维护)
- **本地测试端口:** 8081 (8080 被占用)
- **当前版本:** v33
- **数据原则:** 永不伪造数据 (Data honesty principle)

---

## 3. 已经确认的事实 (Confirmed Facts)

### 项目结构
```
token_rank/
├── .github/workflows/    # GitHub Actions 定时任务
├── data/                 # 历史定价数据
├── static/               # 静态网站文件
├── scripts/              # 数据抓取脚本
├── build_static.py       # 静态站点构建脚本
├── app.py                # Flask API 应用 (PythonAnywhere)
├── app.js                # 前端 JavaScript (双模式)
├── index.html            # 前端页面
└── requirements.txt      # Python 依赖
```

### 数据源
- DeepSeek (官方页面解析，覆盖 OpenRouter 价格)
- OpenRouter
- 其他 LLM 提供商

### GitHub Actions 配置
- **Cron 时间:** `0 22,4,10,16 UTC` (每 6 小时)
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
2. **版本迭代记录:** 每次重大更新都更新版本号 (v1, v2, ..., v33)
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

### 数据文件格式
```json
{
  "date": "2026-08-21",
  "version": "v33",
  "models": [
    {
      "provider": "DeepSeek",
      "model": "deepseek-chat",
      "input_price": 0.14,
      "output_price": 0.28,
      "cached_price": 0.014,
      "unit": "per 1M tokens"
    }
  ]
}
```

### 前端输出
- 静态模式: `static/data.json` + `static/history.json`
- API 模式: Flask 接口 `/api/pricing`

---

## 7. 已完成的工作 (Completed Work)

### v33 修复内容
- **Actions 历史数据恢复机制:** 使用 `git show` 替代损坏的 worktree 机制
- **验证:** v33 工作正常，历史恢复机制功能正常

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

---

## 10. 当前进度 (Current Progress)

**版本:** v33
**状态:** ✅ 稳定运行

- [x] 核心数据抓取功能完成
- [x] 静态网站构建完成
- [x] 双模式前端实现完成
- [x] GitHub Pages 部署配置完成
- [x] GitHub Actions 定时任务配置完成
- [x] v33 修复和验证完成

---

## 11. 尚未完成的任务 (Pending Tasks)

### 短期
- [ ] 监控 GitHub Pages 部署状态
- [ ] 验证定时任务执行日志
- [ ] 检查数据完整性

### 中期
- [ ] 优化数据抓取脚本 (添加更多数据源)
- [ ] 改进前端 UI/UX 设计
- [ ] 添加数据导出功能 (CSV/Excel)

### 长期
- [ ] 考虑替代 PythonAnywhere 的方案 (如 Vercel/Netlify)
- [ ] 实现历史数据恢复补全
- [ ] 添加价格趋势分析功能

---

## 12. 不能随意修改的内容 (Protected Items)

1. **历史数据文件:** `data/` 目录下所有 JSON 文件
2. **版本号:** 当前版本为 v33，修改需有明确理由
3. **Git 全局配置:** `sslBackend = openssl`
4. **GitHub Actions Cron 时间:** `0 22,4,10,16 UTC`
5. **数据原则:** 永不伪造数据
6. **端口配置:** 本地测试使用 8081
7. **DeepSeek 价格覆盖逻辑:** 官方价格必须覆盖 OpenRouter 价格

---

## 13. 新会话接下来应该先做什么 (Next Steps for New Session)

### 第一步: 验证环境
```bash
cd D:\opencode_demo\token_rank
git status
git log --oneline -10
python --version
```

### 第二步: 检查项目状态
- 查看 `data/` 目录下的最新数据文件
- 检查 `static/` 目录下的网站文件
- 验证 `build_static.py` 能否正常运行

### 第三步: 测试本地运行
```bash
python build_static.py
python app.py  # 测试 Flask API
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
python -m http.server 8081 --directory static

# 检查数据文件
ls -la data/

# 查看 GitHub Actions 日志
gh run list --limit 5

# 提交更改
git add .
git commit -m "v34: description"
git push origin main
```

---

*文档结束*
