const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'public');
const CONFIG_PATH = path.join(OUTPUT_DIR, 'config.json');
const JIEKOU_PATH = path.join(OUTPUT_DIR, 'jiekou.json');
const DC_PATH = path.join(OUTPUT_DIR, 'dc.json');
const LINE_DIR = path.join(OUTPUT_DIR, 'api', 'line');
const SRC_EXTERNAL_PATH = path.join(__dirname, '..', 'src', 'external-sites.generated.js');

const GITHUB_RAW = 'https://raw.githubusercontent.com/dlgt7/OmniBox-Spider/refs/heads/main/';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 用户实测较快的固定线路，始终优先尝试（聚合源动态漂移时兜底）
const PINNED_SOURCES = [
  { url: 'https://ztha.top/TVBox/thdjk.json', name: '挺好分享' },
  { url: 'https://6492.kstore.space/xnf/xnf.json', name: '环宇轩线' },
];

const CATEGORIES = [
  '影视/采集', '影视/网盘', '影视/磁力', '影视/解析', '影视/影视库',
  '动漫', '听书', '音乐', '教育', '直播', '短剧',
  '综合', '导航', '流媒体', 'Emby',
];

const AGGREGATOR_URLS = [
  'https://ztha.top/TVBox/GYCK.json',
  'http://xmbjm.fh4u.org/dc.txt',
  'https://xhztv.top/dc',
  'https://qxyc.cc/自用测试'
];

// 伪装成 .jpg 的 jar（PK=ZIP 魔数），已确认为有效 jar，保持直连（国内 CDN）
const SPIDER_URL = "https://oss4liview.moji.com/thd_file/2026/05/08/b216ded4a854a190ce9f6bd280aff779.jpg;md5;448a9f26f33109f6aa148971c3adab46";

const DRPY2_URL = 'https://raw.githubusercontent.com/fantaiying7/EXT/refs/heads/main/drpy2.min.js';
const LIVE_M3U_URL = 'https://raw.githubusercontent.com/iTCoffe/Collect-iTV/main/Internet_iTV.m3u';

// 通过 Worker /proxy 端点加速 GitHub 资源
const viaProxy = (u) => `/proxy?u=${encodeURIComponent(u)}`;

// 去除线路名中的 emoji（保留中文/字母/数字）
function stripEmoji(s) {
  return String(s)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2705}\u{2B50}\u{2728}\u{3297}\u{3299}\u{00A9}\u{00AE}\u{203C}\u{2049}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ============ 构建期静态化：把 /proxy 拉取的文件资源提前下载进 public/static/ ============
// 手机端冷启动不再依赖运行时回源 GitHub，配置里直接引用内容寻址的静态文件（极快 + 长缓存）。
// 直播源 lives 保持 /proxy 动态（列表常变，静态化会过时）。

const crypto = require('crypto');
const STATIC_DIR = path.join(OUTPUT_DIR, 'static');
const STATIC_EXT_RE = /\.(js|mjs|cjs|jar|txt|m3u|m3u8|json|xml|zip|py)$/i;
const GITHUB_MIRRORS = ['https://ghproxy.net/', 'https://gh-proxy.com/'];

// 目标 URL 是否为可静态化的文件（按路径扩展名判断）
function staticExt(target) {
  try {
    const m = new URL(target).pathname.toLowerCase().match(/(\.[a-z0-9]+)$/);
    return m && STATIC_EXT_RE.test(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}

// 下载字节：直连优先，GitHub 镜像兜底。返回 {buf, finalUrl} 用于去重
async function downloadBytes(target, timeout = 25000) {
  for (const url of [target, ...GITHUB_MIRRORS.map((p) => p + target)]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': BROWSER_UA } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 0) return { buf, finalUrl: res.url };
    } catch { /* 试下一个 */ } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// 从 /proxy?u=<encoded>(;md5;xxx|?md5=xxx) 引用还原真实目标 URL（支持 $$$ 多段 ext，如 token.json$$$quarkshare.txt）
// 兼容多 ?u= / &u= 参数，逐个解码并按 $$$ 拆分
function proxySegmentsOf(ref) {
  let p = ref;
  p = p.replace(/;md5;.*$/, '').replace(/\?md5=.*$/, '');
  const segments = [];
  for (const match of p.matchAll(/[?&]u=([^&]+)/g)) {
    try {
      const decoded = decodeURIComponent(match[1]);
      segments.push(...decoded.split('$$$').filter(Boolean));
    } catch { /* ignore malformed */ }
  }
  return segments;
}

function proxyTargetOf(ref) {
  const segs = proxySegmentsOf(ref);
  return segs.length ? segs[0] : null;
}

// 把 /proxy 引用改写为 /static 引用（保留 ;md5; / ?md5= 后缀）。支持 $$$ 多段 ext（逐段改写，失败段保留 /proxy）。
// 下载失败的保持原引用走运行时 /proxy。
function toStaticUrl(ref, staticMap) {
  if (typeof ref !== 'string' || !ref.startsWith('/proxy')) return ref;
  let suffix = '';
  let p = ref;
  const md5m = p.match(/;md5;.*$/);
  if (md5m) { suffix += md5m[0]; p = p.slice(0, md5m.index); }
  const qm = p.match(/\?md5=.*$/);
  if (qm) { suffix += qm[0]; p = p.slice(0, qm.index); }
  const targets = proxySegmentsOf(p);
  if (!targets.length) return ref;
  if (targets.length === 1) {
    const rel = staticMap.get(targets[0]);
    return rel ? rel + suffix : ref;
  }
  // 多段 ext：静态化成功的段改写为 /static，其余段保持原值原样（如 dapanso.com 主站、null 占位符，csp 会自行解析）
  const rewritten = targets.map(t => staticMap.get(t) || t).join('$$$');
  return rewritten + suffix;
}

// 对配置做静态化改写（spider + sites.ext/api；lives 不动）
function rewriteStatic(cfg, staticMap) {
  if (!cfg) return;
  if (typeof cfg.spider === 'string') cfg.spider = toStaticUrl(cfg.spider, staticMap);
  if (Array.isArray(cfg.sites)) {
    for (const s of cfg.sites) {
      if (!s) continue;
      if (typeof s.ext === 'string') s.ext = toStaticUrl(s.ext, staticMap);
      if (typeof s.api === 'string') s.api = toStaticUrl(s.api, staticMap);
      if (typeof s.jar === 'string') s.jar = toStaticUrl(s.jar, staticMap);
    }
  }
}

// 收集配置内所有 /proxy 引用（spider + sites.ext/api/jar）
function collectProxyRefs(cfg, out) {
  if (!cfg) return;
  if (typeof cfg.spider === 'string' && cfg.spider.startsWith('/proxy')) out.add(cfg.spider);
  if (Array.isArray(cfg.sites)) {
    for (const s of cfg.sites) {
      if (!s) continue;
      if (typeof s.ext === 'string' && s.ext.startsWith('/proxy')) out.add(s.ext);
      if (typeof s.api === 'string' && s.api.startsWith('/proxy')) out.add(s.api);
      if (typeof s.jar === 'string' && s.jar.startsWith('/proxy')) out.add(s.jar);
    }
  }
}

// 递归收集配置树中所有 /proxy 引用（含增强字段等嵌套对象）
function collectProxyRefsAll(cfg, out = new Set()) {
  if (!cfg || typeof cfg !== 'object') return out;
  collectProxyRefs(cfg, out);
  for (const v of Object.values(cfg)) {
    if (v && typeof v === 'object') collectProxyRefsAll(v, out);
  }
  return out;
}

// 下载并静态化所有配置引用的资源，返回 target -> /static 路径 的映射
async function staticizeAll(configs) {
  const refs = new Set();
  for (const cfg of configs) collectProxyRefs(cfg, refs);
  const unique = new Map(); // target -> {ext}
  for (const ref of refs) {
    // 支持 $$$ 多段 ext：每段分别静态化
    for (const target of proxySegmentsOf(ref)) {
      if (!target) continue;
      const ext = staticExt(target);
      if (ext) unique.set(target, ext);
    }
  }

  const staticMap = new Map();
  const entries = [...unique.entries()];
  let done = 0;
  const CONC = 12;
  for (let i = 0; i < entries.length; i += CONC) {
    const batch = entries.slice(i, i + CONC);
    await Promise.all(batch.map(async ([target, ext]) => {
      const result = await downloadBytes(target);
      if (!result) { staticMap.set(target, null); return; }
      const { buf, finalUrl } = result;
      const hash = crypto.createHash('sha1').update(finalUrl).digest('hex').slice(0, 16);
      const full = path.join(STATIC_DIR, hash + ext);
      if (fs.existsSync(full)) { staticMap.set(target, `/static/${hash}${ext}`); return; }
      fs.mkdirSync(STATIC_DIR, { recursive: true });
      fs.writeFileSync(full, buf);
      staticMap.set(target, `/static/${hash}${ext}`);
    }));
    done += batch.length;
    process.stdout.write(`\r  静态化下载 ${done}/${entries.length}（成功 ${[...staticMap.values()].filter(Boolean).length}）`);
  }
  const ok = [...staticMap.values()].filter(Boolean).length;
  console.log(`\n✓ 静态化: 成功 ${ok}/${entries.length} 个资源 → public/static/`);
  return staticMap;
}


function encodeGitHubPath(category) {
  return category.split('/').map(encodeURIComponent).join('/');
}

async function fetchGitHubCategory(category) {
  const token = process.env.GITHUB_TOKEN || '';
  const url = `https://api.github.com/repos/dlgt7/OmniBox-Spider/contents/${encodeGitHubPath(category)}`;
  const tokenArg = token ? `-H "Authorization: Bearer ${token}"` : '';
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      `curl.exe -4 -k -s -H "User-Agent: OmniBox-Spider-Worker" -H "Accept: application/vnd.github.v3+json" ${tokenArg} "${url}"`,
      { encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024 }
    );
    const data = JSON.parse(out);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function scanGitHubRepo() {
  console.log('扫描 GitHub OmniBox-Spider 仓库...');
  const spiders = [];
  for (const category of CATEGORIES) {
    const files = await fetchGitHubCategory(category);
    const jsFiles = files.filter(f => f.name.endsWith('.js') || f.name.endsWith('.py'));
    console.log(`  ${category}: ${jsFiles.length} 个`);
    for (const file of jsFiles) {
      spiders.push({
        name: file.name.replace(/\.(js|py)$/, ''),
        category,
        downloadUrl: `${GITHUB_RAW}${category}/${file.name}`,
      });
    }
  }
  console.log(`共 ${spiders.length} 个爬虫脚本\n`);
  return spiders;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 括号配平提取 JSON，避免贪婪正则误截
function extractJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchWithRetry(url, timeout = 20000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': BROWSER_UA } });
      if (!res.ok) {
        if (attempt < retries) await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      const text = await res.text();
      const data = extractJSON(text);
      if (data !== null) return data;
    } catch {
      if (attempt < retries) await sleep(500 * Math.pow(2, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// https 优先，失败回退 http
async function fetchFlexible(url, timeout, retries) {
  let data = null;
  if (url.startsWith('http://')) {
    data = await fetchWithRetry('https://' + url.slice(7), timeout, retries);
  }
  if (!data) data = await fetchWithRetry(url, timeout, retries);
  return data;
}

// 将相对路径的 spider 解析为绝对 URL，并提取 md5 后缀（;md5;xxx 或 ?md5=xxx）
function resolveSpiderPath(spider, sourceUrl) {
  if (typeof spider !== 'string') return spider;
  let suffix = '';
  let p = spider;
  const md5Match = p.match(/;md5;.*$/);
  if (md5Match) {
    suffix = md5Match[0];
    p = p.slice(0, md5Match.index);
  }
  const queryMatch = p.match(/\?.*$/);
  if (queryMatch) {
    suffix = queryMatch[0] + suffix;
    p = p.slice(0, queryMatch.index);
  }
  if (/^\.{1,2}\//.test(p)) {
    try {
      p = new URL(p, sourceUrl).href;
    } catch { /* keep as-is */ }
  }
  return p + suffix;
}

// 将源配置里所有相对路径（spider/lives.url/sites.ext/sites.api）解析为绝对 URL，
// 并把 http(s) 字符串型 ext/api/lives.url 统一改为走 /proxy 加速
function resolveAllRelativePaths(config, sourceUrl) {
  if (!config || typeof config !== 'object') return config;
  if (config.spider) config.spider = resolveSpiderPath(config.spider, sourceUrl);
  if (Array.isArray(config.lives)) {
    config.lives = config.lives.map(l => {
      if (!l || typeof l.url !== 'string') return l;
      let u = l.url;
      if (/^\.{1,2}\//.test(u)) {
        try {
          u = new URL(u, sourceUrl).href;
        } catch { return l; }
      }
      if (/^https?:\/\//.test(u)) {
        return { ...l, url: viaProxy(u) };
      }
      return l;
    });
  }
  if (Array.isArray(config.sites)) {
    config.sites = config.sites.map(s => {
      if (!s) return s;
      const copy = { ...s };
      for (const field of ['ext', 'api', 'jar']) {
        const v = copy[field];
        if (typeof v !== 'string') continue;
        // 支持 $$$ 多段值（如 token.json$$$quarkshare.txt）：逐段解析相对路径
        const parts = v.split('$$$').map(seg => {
          let u = seg;
          if (/^\.{1,2}\//.test(u)) {
            try {
              u = new URL(u, sourceUrl).href;
            } catch {
              return seg;
            }
          }
          return u;
        });
        // 判断是否需要 viaProxy：只要有任一段是 http(s) 且原值不是完整的绝对 URL 组合
        // 策略：若原值包含相对路径段，或全为绝对 URL 但未被代理，则整体 viaProxy
        const hasRelative = v.split('$$$').some(seg => /^\.{1,2}\//.test(seg));
        const allAbsolute = parts.every(p => /^https?:\/\//.test(p));
        if (hasRelative || (allAbsolute && !v.startsWith('/proxy'))) {
          copy[field] = viaProxy(parts.join('$$$'));
        } else {
          copy[field] = parts.join('$$$');
        }
      }
      return copy;
    });
  }
  return config;
}

// 将 spider jar 改为通过 /proxy 加载，保留 md5 校验后缀
function proxySpider(spider) {
  if (typeof spider !== 'string') return spider;
  let suffix = '';
  let p = spider;
  const md5Match = p.match(/;md5;.*$/);
  if (md5Match) {
    suffix = md5Match[0];
    p = p.slice(0, md5Match.index);
  }
  const queryMatch = p.match(/\?.*$/);
  if (queryMatch) {
    suffix = queryMatch[0] + suffix;
    p = p.slice(0, queryMatch.index);
  }
  if (!/^https?:\/\//.test(p)) return spider;
  return viaProxy(p) + suffix;
}

async function fetchExternalSources() {
  console.log('获取聚合源子线路...');
  const results = await Promise.allSettled(
    AGGREGATOR_URLS.map(url => fetchFlexible(url, 30000, 2))
  );

  const sourceMap = new Map();
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value && Array.isArray(result.value.urls)) {
      for (const entry of result.value.urls) {
        if (entry.url && !sourceMap.has(entry.url)) {
          sourceMap.set(entry.url, entry.name || '');
        }
      }
    }
  }
  // 固定线路兜底：聚合源未提供时仍尝试（按 URL 去重）
  for (const p of PINNED_SOURCES) {
    if (!sourceMap.has(p.url)) sourceMap.set(p.url, p.name);
  }

  console.log(`聚合源共 ${sourceMap.size} 个子线路，逐个获取配置...\n`);

  const sources = [];
  const entries = [...sourceMap.entries()];
  const CONCURRENCY = 10;
  let fetched = 0;

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(([url]) => fetchWithRetry(url, 20000, 2))
    );

    for (let j = 0; j < batchResults.length; j++) {
      fetched++;
      const result = batchResults[j];
      const name = entries[i + j][1] || entries[i + j][0];
      const sourceUrl = entries[i + j][0];
      if (result.status === 'fulfilled' && result.value && result.value.sites) {
        const config = result.value;
        // 把配置内所有相对路径解析为绝对 URL（基于该源自己的 URL），再让 spider 走 /proxy
        resolveAllRelativePaths(config, sourceUrl);
        if (config.spider) {
          config.spider = proxySpider(config.spider);
        }
        sources.push({ name, url: sourceUrl, config });
        console.log(`  ✓ [${fetched}/${entries.length}] ${name}`);
      } else {
        console.log(`  ✗ [${fetched}/${entries.length}] ${name}`);
      }
    }
  }

  const totalSites = sources.reduce((sum, s) => sum + (s.config?.sites?.length || 0), 0);
  console.log(`\n获取到 ${sources.length} 个外部源，共 ${totalSites} 个站点\n`);
  return sources;
}

// 聚合高级字段：parses（归一化 type）、doh、flags，去重
function collectEnhancements(externalSources) {
  const parses = [];
  const doh = [];
  const flags = new Set();
  const seenParses = new Set();
  const seenDoh = new Set();

  for (const src of externalSources) {
    const cfg = src.config || {};
    for (const p of cfg.parses || []) {
      const key = (p.name || '') + '|' + (p.url || '');
      if (!seenParses.has(key)) {
        seenParses.add(key);
        parses.push(p);
      }
    }
    for (const d of cfg.doh || []) {
      const key = (d.name || '') + '|' + (d.url || '');
      if (!seenDoh.has(key)) {
        seenDoh.add(key);
        doh.push(d);
      }
    }
    for (const f of cfg.flags || []) flags.add(f);
  }

  // 只保留常规可用解析：http url + 有 name；type 非法或缺失归一到 0
  const usableParses = parses
    .filter(p => typeof p.url === 'string' && p.url.startsWith('http') && p.name)
    .map(p => {
      const type = [0, 1, 2, 3, 4].includes(p.type) ? p.type : 0;
      return { ...p, type };
    })
    .slice(0, 60);

  return {
    parses: usableParses,
    doh: doh.slice(0, 10),
    flags: [...flags].slice(0, 20),
  };
}

async function main() {
  console.log('=== 开始构建 ===\n');

  try {
    const spiders = await scanGitHubRepo();
    const externalSources = await fetchExternalSources();

    if (!fs.existsSync(LINE_DIR)) fs.mkdirSync(LINE_DIR, { recursive: true });

    const lives = [
      { name: "huangbo", type: 1, url: viaProxy(LIVE_M3U_URL) }
    ];

    const enhancements = collectEnhancements(externalSources);

    const omniBoxConfig = {
      spider: SPIDER_URL,
      sites: spiders.map(s => ({
        key: s.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 30),
        name: s.name,
        type: 3,
        ext: viaProxy(s.downloadUrl),
        api: viaProxy(DRPY2_URL),
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
      })),
      lives: lives,
      ...enhancements,
    };

    // 构建期静态化：预下载 /proxy 资源到 public/static/，改写 spider/sites.ext/api/jar 为 /static 引用
    const staticMap = await staticizeAll([omniBoxConfig, ...externalSources.map(s => s.config)]);
    rewriteStatic(omniBoxConfig, staticMap);
    for (const src of externalSources) rewriteStatic(src.config, staticMap);

    // 清理不再被引用的静态文件（内容寻址，按引用回收）
    const keep = new Set([...staticMap.values()].filter(Boolean).map(p => p.split('/').pop()));
    if (fs.existsSync(STATIC_DIR)) {
      for (const f of fs.readdirSync(STATIC_DIR)) {
        if (!keep.has(f)) fs.unlinkSync(path.join(STATIC_DIR, f));
      }
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(omniBoxConfig, null, 2), 'utf-8');
    console.log(`✓ config.json: ${omniBoxConfig.sites.length} 个 OmniBox 站点 + ${enhancements.parses.length} parses + ${enhancements.doh.length} doh + ${enhancements.flags.length} flags`);

    fs.writeFileSync(JIEKOU_PATH, JSON.stringify(omniBoxConfig, null, 2), 'utf-8');
    console.log(`✓ jiekou.json: 同步`);

    // 聚合 url 型直播源（按 url 去重）成独立直播线路
    const seenLives = new Map();
    const collectLive = (name, url, type) => {
      if (!url) return;
      if (!seenLives.has(url)) seenLives.set(url, { name: name || '', type: [0, 1].includes(type) ? type : 0, url });
    };
    for (const src of externalSources) {
      for (const l of src.config?.lives || []) {
        if (l && typeof l.url === 'string' && l.url.startsWith('/proxy')) collectLive(l.name, l.url, l.type);
      }
    }
    collectLive(omniBoxConfig.lives?.[0]?.name, omniBoxConfig.lives?.[0]?.url, omniBoxConfig.lives?.[0]?.type);
    const liveLine = { lives: [...seenLives.values()], sites: [], spider: '' };
    fs.writeFileSync(path.join(LINE_DIR, '16.json'), JSON.stringify(liveLine, null, 2), 'utf-8');
    console.log(`✓ api/line/16.json: 聚合 ${liveLine.lives.length} 个直播源`);

    // 纯夸克高清线路：从所有外部源筛出夸克相关站点（去重），复用道长 pg.jar（内置 QuarkShare/QuarkPanso）做爬虫
    // 过滤规则：
    //   - api 为夸克/网盘搜索类 csp（csp_Quark / csp_Kwps / csp_Funletu / csp_DaPanSo 等）
    //   - 或 name/key 含 夸克/Quark（但排除共享 csp_PgDouban 等非夸克 API 的伪夸克条目）
    const QUARK_NAME_RE = /夸克|Quark|quark/i;
    const QUARK_API_RE = /csp_Quark|csp_Kwps|csp_Funletu|csp_DaPanSo|csp_PanSou/i;
    const quarkSites = [];
    const seenQ = new Set();
    for (const src of externalSources) {
      for (const s of src.config?.sites || []) {
        if (!s) continue;
        const api = String(s.api || '');
        const nameHit = QUARK_NAME_RE.test(s.name || '') || QUARK_NAME_RE.test(s.key || '');
        const apiHit = QUARK_API_RE.test(api);
        const hit = nameHit || apiHit;
        if (!hit) continue;
        // 排除伪夸克：name/key 含夸克但实际是共享非夸克 API 的站点（如 csp_Pg夸克 → csp_PgDouban）
        if (nameHit && !apiHit && /^csp_/i.test(api) && !/夸克|Quark|quark/i.test(api)) continue;
        const k = s.key || s.name;
        if (seenQ.has(k)) continue;
        seenQ.add(k);
        quarkSites.push(s);
      }
    }
    const pgSource = externalSources.find(s => /道长|dzhipy|duomv/i.test(s.name + s.url))
      || externalSources.find(s => /pg\.jar/i.test(s.config?.spider || ''))
      || externalSources[10];
    const quarkLine = {
      spider: pgSource?.config?.spider || '',
      sites: quarkSites,
      lives: [],
      ...enhancements,
    };
    fs.writeFileSync(path.join(LINE_DIR, '17.json'), JSON.stringify(quarkLine, null, 2), 'utf-8');
    console.log(`✓ api/line/17.json: 夸克高清 ${quarkLine.sites.length} 个站点 (spider=${quarkLine.spider.split('?')[0].split(';')[0]})`);

    // 构建产物完整性校验
    function validateBuild() {
      const errors = [];
      // 1. line17 必须包含至少 1 个 csp_DaPanSo 站点
      if (!quarkLine.sites.some(s => s.api === 'csp_DaPanSo')) {
        errors.push('line17 缺少 csp_DaPanSo 站点');
      }
      // 2. QuarkShare ext 必须含 $$$ 且两段均为 /static/ 或有效外链
      const qs = quarkLine.sites.find(s => s.key === 'QuarkShare' || s.name?.includes('QuarkShare'));
      if (qs && typeof qs.ext === 'string') {
        const segs = qs.ext.split('$$$');
        if (segs.length < 2) errors.push('QuarkShare ext 缺少 $$$ 分段');
        else {
          for (const seg of segs) {
            if (!(seg.startsWith('/static/') || seg.startsWith('http'))) {
              errors.push(`QuarkShare ext 段异常: ${seg}`);
            }
          }
        }
      }
      // 3. staticMap 覆盖所有收集到的 target
      const allTargets = new Set();
      for (const cfg of [omniBoxConfig, ...externalSources.map(s => s.config)]) {
        for (const ref of collectProxyRefsAll(cfg)) {
          for (const t of proxySegmentsOf(ref)) {
            if (t) allTargets.add(t);
          }
        }
      }
      for (const t of allTargets) {
        if (!staticMap.has(t)) errors.push(`staticMap 缺失 target: ${t}`);
        else if (!staticMap.get(t)) errors.push(`staticMap target 下载失败: ${t}`);
      }
      if (errors.length) throw new Error('构建校验失败:\n' + errors.join('\n'));
    }
    validateBuild();
    console.log('✓ 构建产物校验通过');

    // dc.json：直播源置顶；挺好分享/环宇轩线（实测访问较快）置前，其余按原序号（按名匹配，防聚合源顺序漂移）
    const PRIORITY_NAMES = ['挺好分享', '环宇轩线'];
    const orderedSources = [...externalSources]
      .map((src, i) => ({
        src, i,
        rank: PRIORITY_NAMES.includes(src.name) ? PRIORITY_NAMES.indexOf(src.name) : 99,
      }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
    const dc = { urls: [{ name: '1.直播源', url: '/api/line/16.json' }] };
    let seq = 2;
    for (const { src, i } of orderedSources) {
      dc.urls.push({ name: `${seq}.${stripEmoji(src.name)}`, url: `/api/line/${i}.json` });
      seq++;
    }
    dc.urls.push({ name: `${seq}.夸克高清`, url: '/api/line/17.json' });
    fs.writeFileSync(DC_PATH, JSON.stringify(dc, null, 2), 'utf-8');
    console.log(`✓ dc.json: ${dc.urls.length} 条线路`);

    // 每条外部线路一个独立静态文件（含已走 /proxy 的 spider）
    externalSources.forEach((src, i) => {
      fs.writeFileSync(
        path.join(LINE_DIR, `${i}.json`),
        JSON.stringify(src.config, null, 2),
        'utf-8'
      );
    });
    console.log(`✓ api/line/: ${externalSources.length} 个线路文件`);

    // external-sites.generated.js：仅保留 OMNIBOX_SPIDERS（瘦身，供 /api/spiders）
    const moduleContent = `// 由 build-config.js 自动生成，勿手动修改
export const OMNIBOX_SPIDERS = ${JSON.stringify(spiders.map(s => ({ name: s.name, category: s.category, downloadUrl: s.downloadUrl })), null, 2)};
`;
    fs.writeFileSync(SRC_EXTERNAL_PATH, moduleContent, 'utf-8');
    console.log(`✓ external-sites.generated.js: ${spiders.length} 个 OmniBox 爬虫`);

    console.log('\n=== 构建完成 ===');
  } catch (error) {
    console.error('构建失败:', error.message);
    const emptyConfig = { spider: '', sites: [] };
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(emptyConfig, null, 2), 'utf-8');
    fs.writeFileSync(JIEKOU_PATH, JSON.stringify(emptyConfig, null, 2), 'utf-8');
  }
}

main();
