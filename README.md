# OmniBox-Spider-Worker

TVBox / 影视仓 多仓配置生成器 - 部署到 Cloudflare Workers

## 功能特性

- 🕷️ **OmniBox 全站**: 扫描 GitHub 仓库 120+ 个爬虫脚本，生成 TVBox 格式配置
- 📦 **多仓线路**: 聚合 4 个公开聚合源的子线路，每条线路原样保留原始配置
- 📺 **电视直播**: 内置 3000+ 频道直播源（M3U）
- 🚀 **Cloudflare 部署**: 部署到 Cloudflare Workers，全球加速
- 💰 **完全免费**: Cloudflare 免费套餐完全够用

## 快速开始

### 本地部署

1. 安装依赖:

```bash
npm install
```

2. 设置 GitHub Token（避免 API 限流）:

```bash
# Windows PowerShell
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxx"
# Linux/Mac
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

3. 构建配置文件（扫描爬虫 + 获取聚合源）:

```bash
node scripts/build-config.js
```

4. 登录 Cloudflare 并部署:

```bash
wrangler login
wrangler deploy
```

### 使用地址

| 地址 | 说明 |
| ---- | ---- |
| `https://你的域名/dc.json` | **多仓配置**（影视仓/TVBox 导入这个） |
| `https://你的域名/config.json` | 单仓配置（仅 OmniBox 全站） |
| `https://你的域名/api/spiders` | 爬虫列表 API |

## 项目结构

```
OmniBox-Spider-Worker/
├── src/                          # 源代码目录
│   ├── index.js                  # Worker 入口
│   ├── handler.js                # 请求处理器（路由分发）
│   ├── config-generator.js       # 配置生成器
│   └── external-sites.generated.js # 构建脚本自动生成（勿手动修改）
├── scripts/
│   └── build-config.js           # 配置构建脚本
├── public/                       # 生成的静态配置
│   ├── config.json               # OmniBox 单仓配置
│   └── jiekou.json               # 同步副本
├── package.json
├── wrangler.toml                 # Cloudflare Worker 配置
└── README.md
```

## API 接口

| 路径 | 说明 |
| ---- | ---- |
| `/dc.json` | 多仓索引（21 条线路） |
| `/config.json` | OmniBox 单仓（121 个站点 + 直播源） |
| `/api/line/0~19` | 各外部源原版配置 |
| `/api/spiders` | OmniBox 爬虫列表 |

## 常见问题

### Q: 为什么有些线路导入后没有内容？

A: 聚合源中有部分子线路在国内网络环境下无法访问，构建时会自动跳过。已获取的线路都是可用的。

### Q: 如何更新配置？

A: 重新运行 `node scripts/build-config.js` 后 `wrangler deploy` 即可。构建脚本会重新扫描爬虫仓库和聚合源。

### Q: 国内网络打不开 workers.dev 域名？

A: `*.workers.dev` 在国内可能被屏蔽，建议绑定自己的自定义域名。

## License

MIT
