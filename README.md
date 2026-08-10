# 质标雷达 · 选题中央处理器

> 面向「质量与标准化」科普自媒体团队的一台 AI 选题中央处理器：
> **权威信源追踪 → 信息可信度评判 → 选题方向策划 → 内容生产辅助**，全链路打通。

零服务器成本：纯静态 SPA，托管在 **GitHub Pages**，由 **GitHub Actions** 每日定时抓取权威信源、重新生成数据并自动部署。

---

## 三大模块

### 模块 1 · 权威信源抓取与入库
- **信源分级**：A 级（强制采信：国家标准全文公开系统、WTO/TBT 通报、监管总局抽检公告）、B 级（重要参考：行业协会、头部检测机构、学术期刊）、C 级（线索参考：头部媒体、企业声明）。
- **抓取方式**：API 优先，辅以 HTTP/RSS 适配器；每源独立容错，失败保留上次快照。
- **元数据规范**：标准号、发布/实施日期、归口部门、采标关系、替代关系、关联法规等。

### 模块 2 · 信息可信度评判（差异化核心）
- **五维雷达**：来源权威性 / 时效新鲜度 / 交叉印证 / 量化程度 / 受众相关性，每维 1–5 分。
- **综合评级 A/B/C/D**（加权总分 0–100），**低于 C 级不进入选题池**。
- 每一维评分都给出**可追溯的文字依据**，绝不黑箱；废止/被代替条目硬性降档。

### 模块 3 · 选题方向策划（三段式）
- **选题角度生成**：≥3 个不同切入视角（消费者维权 / 企业合规 / 产业升级 / 国际贸易 / 标准科普 / 监管执法）。
- **爆款潜力评估**：标题公式库 + 题材热度权重 + 发布时段建议；导入真实爆款样本后自动切换为数据校准模式。
- **风险扫描**：涉政 / 涉外 / 敏感品牌 / 商业纠纷 / 医疗健康 / 数据合规 / 绝对化用语预警。

> AI 增强为**可选增强**而非依赖：没配 Key、断网也能跑完整规则引擎链路；配了 Key 可做 AI 复核、头脑风暴与大纲生成。

---

## 技术栈
- **前端**：Vite 5 + React 18 + TypeScript + Tailwind CSS 3 + Zustand
- **引擎**：三大纯 TS 引擎，零网络依赖，可追溯、可单元测试
- **抓取**：Node.js 适配器（`scripts/`），政务站点容错设计
- **托管**：GitHub Pages + Actions（每日定时）

---

## 本地运行
```bash
npm install
npm run dev          # 开发预览 http://localhost:5173
npm run crawl        # 抓取最新情报 → public/data/dataset.json
npm run build        # 产物输出到 dist/
npm run preview      # 预览构建产物
```

---

## 部署到 GitHub Pages（自用）

1. 在 GitHub 新建仓库（建议名 `qs-radar`）。
2. 推送代码：`git remote add origin <你的仓库地址> && git push -u origin main`。
3. 仓库 **Settings → Pages → Build and deployment → Source 选择 “GitHub Actions”**。
4. 完成。此后每天北京时间 06:00 自动抓取并部署；也可在 Actions 页手动 **Run workflow** 触发。

> 部署子路径由 `VITE_BASE_PATH` 自动注入（= `/<仓库名>/`），无需手改配置。

---

## AI 设置（用户自带 Key）
点击右上角「AI 设置」，填入任意 **OpenAI 协议**服务的 Key 即可（DeepSeek / 通义 / Kimi / 智谱 / OpenAI / 硅基流动均已预设）。
- **密钥仅存于你本机浏览器 localStorage，直连模型厂商，不经过任何中间服务器。**
- 未配置 Key 时，规则引擎照常工作，仅 AI 增强类功能不可用。

---

## 数据来源与免责声明
- 数据来自公开权威信源（国家标准全文公开系统、市场监管总局、WTO/TBT 通报等），通过官方/公开接口抓取。
- 工具输出为**选题辅助参考**，最终发布前请核对引用数据与原文一致性，并遵守平台规范与广告法等相关法规。
- 风险扫描为「预警而非审查」，命中项代表需人工确认，不代表内容违规。

---

## 微信公众号集成（内容资产库 → 草稿箱）

> **状态：UI 推送入口已摘除（2026-08-10）**。本账号没有自己的公众号，无法直接调微信接口，故网页上的「↗公众号」按钮和「同步」里的微信 Worker 设置组已移除。代码仍保留，待拥有**已认证**公众号后启用。

内容资产库里的文章可**单向推送**到公众号**草稿箱**（编辑到后台复核发布）。纯静态站点无法直接调微信接口（CORS + `appsecret` 安全），故两条路线：

### 路线 A · 本地一键发布（当前可用）

1. 安装：`npm install -g @wenyan-md/cli`
2. 配置环境变量（公众号后台「开发 → 基本配置」取 `appid`/`appsecret`，并把运行机器公网 IP 加入 **IP 白名单**）：
   ```bash
   export WECHAT_APP_ID=xxx
   export WECHAT_APP_SECRET=xxx
   ```
3. 在内容资产库文章点 **⬇MD** 导出 Markdown（已自动带 `title`/`cover` frontmatter）。
4. `wenyan publish -f 文章.md -t lapis -h solarized-light` → 进草稿箱。

### 路线 B · 网页内一键推送（需已认证公众号 + Cloudflare Worker，代码保留待用）

1. 部署代理：`cd workers/wechat-proxy && wrangler login && wrangler secret put APPID && wrangler secret put APPSECRET && wrangler deploy`（详见该目录 `README.md`）。
2. 届时在「同步」设置恢复 **微信 Worker 地址**、默认作者、默认封面，文章点推送即进草稿箱；正文里的外链图片会自动上传到微信图床。

> 前置：已**认证**的公众号；`draft/add` 仅支持认证号。仅做单向推送，不回拉已发布内容。

---

## License
MIT
