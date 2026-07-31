# OmniBox-Spider-Worker

TVBox / 影视仓 多仓配置自动生成器，部署在 Cloudflare Workers 上，零服务器成本。

自动扫描 OmniBox-Spider 仓库的 120+ 爬虫脚本，聚合多个公开 TVBox 源的子线路，生成可直接导入影视仓 / TVBox 的多仓配置。

## 目录

- [功能特性](#功能特性)
- [工作原理](#工作原理)
- [环境要求](#环境要求)
- [快速部署](#快速部署)
- [使用方式](#使用方式)
- [API 接口](#api-接口)
- [项目结构](#项目结构)
- [构建脚本说明](#构建脚本说明)
- [自定义配置](#自定义配置)
- [部署脚本](#部署脚本)
- [常见问题](#常见问题)
- [License](#license)

---

## 功能特性

- **OmniBox 全站**：扫描 GitHub 仓库 `dlgt7/OmniBox-Spider` 全部 14 个分类，共 121 个爬虫脚本，自动生成 TVBox 格式配置
- **多仓聚合**：内置 4 个公开聚合源，聚合出 85 条子线路，运行时自动过滤不可达线路
- **原始配置透传**：每条外部线路原样返回该源的完整原始配置（spider + sites），保证与原源解析器完全兼容，线路不因字段丢失而失效
- **电视直播**：内置 3000+ 频道 M3U 直播源（央视 / 卫视 / 地方台 / 海外）
- **静态预构建**：爬虫列表和外部源配置在构建时写入 Worker 模块，运行时零外部 API 调用，Worker 启动时间 1ms
- **完全免费**：Cloudflare 免费套餐足够支撑

## 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    构建阶段 (本地执行)                        │
│                                                             │
│  GitHub API ──► 扫描 OmniBox-Spider 仓库 121 个爬虫         │
│  (GITHUB_TOKEN)                                              │
│                                                             │
│  4 个聚合源 ──► 获取 85 条子线路地址                         │
│  (20s 超时)    │                                             │
│                ▼                                             │
│        逐个请求子线路，保留配置可达的源                        │
│                                                             │
│  ──► 生成文件:                                               │
│       public/config.json          (OmniBox 单仓配置)        │
│       public/jiekou.json          (同步副本)                 │
│       src/external-sites.generated.js  (外部源 + 爬虫 + 直播) │
└─────────────────────────────────────────────────────────────┘
                              │ wrangler deploy
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 运行时 (Cloudflare Worker)                   │
│                                                             │
│  /dc.json       多仓索引，列出所有线路                        │
│  /config.json   单仓配置（OmniBox 全站，直接生成）            │
│  /api/line/N    外部线路原版配置（从模块读取，原样返回）       │
│  /api/spiders   爬虫列表                                     │
└─────────────────────────────────────────────────────────────┘
```

**关键设计**：构建阶段就把数据打包进 Worker 模块（`external-sites.generated.js`），运行时 Worker 只读内存数据，不发起任何外部请求。因此：

- 速度快（Worker 启动 1ms）
- 不依赖 GitHub API 可用性
- 不消耗免费额度（GitHub API 未认证限 60 次/小时，已通过 token 和预构建规避）

## 环境要求

| 依赖 | 版本 | 说明 |
| ---- | ---- | ---- |
| Node.js | 16+ | 运行构建脚本 |
| Cloudflare 账号 | - | 免费即可 |
| GITHUB_TOKEN（推荐） | - | 避免 GitHub API 限流 |

## 快速部署

### 1. 克隆仓库

```bash
git clone https://github.com/HBO251/omnibox-spider-worker.git
cd omnibox-spider-worker
npm install
```

### 2. 配置 GitHub Token（强烈推荐）

构建脚本会扫描 GitHub 仓库目录。未认证的 GitHub API 限流为 **60 次/小时**，可能不够完成扫描（14 个分类 + 子线路共 85+ 次请求）。

获取方式：GitHub → Settings → Developer settings → Personal access tokens → 生成 token（不需要任何权限 scope）。

```bash
# Windows PowerShell
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxxxxxx"

# Linux / macOS
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxx"
```

### 3. 构建配置文件

```bash
node scripts/build-config.js
```

构建成功会输出：

```
共 121 个爬虫脚本
获取到 20 个外部源，共 1885 个站点
✓ config.json: 121 个 OmniBox 站点
✓ external-sites.generated.js: 20 个外部源 + 121 个 OmniBox 爬虫
```

> **注意**：外部源数量每次构建会波动（国内网络下部分子线路 CDN 不可达，构建脚本会跳过）。这是正常现象，不影响已获取线路的使用。

### 4. 登录并部署

```bash
wrangler login   # 首次需要，浏览器授权
wrangler deploy
```

部署成功后输出：

```
Deployed omnibox-spider-worker triggers
  https://omnibox-spider-worker.你的账户.workers.dev
```

### 5. 绑定自定义域名（国内用户强烈建议）

`*.workers.dev` 域名在国内网络下可能无法访问。建议绑定自定义域名：

1. Cloudflare Dashboard → Workers & Pages → 选择 Worker → Settings → Domains & Routes
2. Add Custom Domain → 填写你的域名（如 `tvbox.example.com`）
3. 等待 DNS 生效

## 使用方式

在影视仓 / TVBox 中添加配置地址：

```
https://你的域名/dc.json
```

导入后会出现线路列表：

| 线路 | 说明 |
| ---- | ---- |
| OmniBox全站 | 121 个爬虫站点 + 电视直播，本站生成 |
| 其余线路 | 各公开聚合源的原版配置，原样透传 |

## API 接口

| 路径 | 说明 | 响应 |
| ---- | ---- | ---- |
| `/dc.json` | 多仓索引 | `{ urls: [{ name, url }] }` |
| `/config.json` | OmniBox 单仓配置 | `{ spider, sites, lives }` |
| `/jiekou.json` | 单仓配置别名 | 同上 |
| `/api/line/{N}` | 外部源原版配置 | 该源完整原始 JSON |
| `/api/spiders` | 爬虫列表 | `[{ name, category, downloadUrl }]` |
| `/` | 首页 | HTML 导航页 |

所有接口支持 CORS，可跨域调用。

## 项目结构

```
omnibox-spider-worker/
├── src/                              # Worker 源码
│   ├── index.js                      # Worker 入口
│   ├── handler.js                    # 请求路由分发
│   ├── config-generator.js           # 配置生成逻辑
│   └── external-sites.generated.js   # 构建自动生成（勿手改）
├── scripts/
│   └── build-config.js               # 构建脚本（扫描 + 聚合 + 生成）
├── public/                           # 生成的静态配置
│   ├── config.json                   # OmniBox 单仓配置
│   └── jiekou.json                   # 同步副本
├── deploy.bat                        # Windows 一键部署
├── deploy-smart.bat                  # Windows 智能部署（环境检测）
├── deploy.sh                         # Linux/macOS 部署
├── package.json
├── wrangler.toml                     # Cloudflare Worker 配置
└── wrangler.toml.example             # 配置示例
```

## 构建脚本说明

`scripts/build-config.js` 做三件事：

1. **扫描爬虫**：通过 GitHub API 列出 `dlgt7/OmniBox-Spider` 仓库 14 个分类目录下的 `.js` / `.py` 文件，生成站点列表
2. **聚合子线路**：请求 4 个聚合源（`ztha.top`、`xmbjm.fh4u.org`、`xhztv.top`、`qxyc.cc`），提取全部子线路地址，再逐个获取配置（并发 5，超时 20s）
3. **生成产物**：
   - `public/config.json` + `public/jiekou.json`：OmniBox 单仓配置（含直播源）
   - `src/external-sites.generated.js`：导出 `EXTERNAL_SOURCES`（外部源原配置）、`OMNIBOX_SPIDERS`（爬虫列表）、`LIVES`（直播源），打包进 Worker

修改聚合源或爬虫仓库，直接编辑脚本顶部的 `AGGREGATOR_URLS` 和 `CATEGORIES` 常量即可。

## 自定义配置

| 想改什么 | 在哪里改 |
| ---- | ---- |
| 聚合源列表 | `scripts/build-config.js` → `AGGREGATOR_URLS` |
| 爬虫分类 | `scripts/build-config.js` → `CATEGORIES` |
| 爬虫仓库 | `scripts/build-config.js` → `GITHUB_RAW` |
| 直播源 | `scripts/build-config.js` → `lives` 数组 |
| Spider 地址 | `scripts/build-config.js` → `SPIDER_URL` |

## 部署脚本

项目提供三个部署脚本，免手动敲命令：

| 脚本 | 平台 | 说明 |
| ---- | ---- | ---- |
| `deploy.bat` | Windows | 基础版：检查环境 → 构建 → 部署 |
| `deploy-smart.bat` | Windows | 增强版：额外检测 Node/wrangler 版本、依赖安装 |
| `deploy.sh` | Linux/macOS | 基础版 |

> 这些脚本内部会调用 `node scripts/build-config.js`，所以运行前仍需设置 `GITHUB_TOKEN` 环境变量。

## 常见问题

### Q: 为什么导入后部分线路没有内容？

聚合源中有部分子线路在国内网络下无法访问（CDN 被墙或超时），构建时已自动跳过。已生成的线路都是构建时验证可达的。可以多构建几次，网络好的时候能获取更多线路。

### Q: 如何更新配置？

```bash
node scripts/build-config.js   # 重新扫描 + 聚合
wrangler deploy                # 重新部署
```

### Q: 不设置 GITHUB_TOKEN 会怎样？

GitHub API 未认证限流 60 次/小时，扫描 14 个分类目录可能不足，部分分类会为空。建议设置 token。

### Q: workers.dev 域名国内打不开？

`*.workers.dev` 在国内可能被屏蔽。绑定自定义域名即可解决（见「绑定自定义域名」）。

### Q: 直播源在哪里配置？

直播源在 `scripts/build-config.js` 的 `lives` 数组中，随构建写入配置。导入 `dc.json` 后选择「OmniBox全站」线路即可看到直播。

### Q: `external-sites.generated.js` 为什么这么大？

该文件包含所有外部源（约 20 个）的完整原始配置，每个源含 spider 和全部站点，约 800KB。这是为了保证线路原样透传、兼容性最好的代价，可考虑加入 `.gitignore`。

## License

MIT
