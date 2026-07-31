const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'public');
const CONFIG_PATH = path.join(OUTPUT_DIR, 'config.json');
const JIEKOU_PATH = path.join(OUTPUT_DIR, 'jiekou.json');
const DC_PATH = path.join(OUTPUT_DIR, 'dc.json');
const LINE_DIR = path.join(OUTPUT_DIR, 'api', 'line');
const SRC_EXTERNAL_PATH = path.join(__dirname, '..', 'src', 'external-sites.generated.js');

const GITHUB_RAW = 'https://raw.githubusercontent.com/dlgt7/OmniBox-Spider/refs/heads/main/';

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
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
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
      for (const field of ['ext', 'api']) {
        const v = copy[field];
        if (typeof v !== 'string') continue;
        let u = v;
        if (/^\.{1,2}\//.test(u)) {
          try {
            u = new URL(u, sourceUrl).href;
          } catch {
            continue;
          }
        }
        if (/^https?:\/\//.test(u)) {
          copy[field] = viaProxy(u);
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

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(omniBoxConfig, null, 2), 'utf-8');
    console.log(`✓ config.json: ${omniBoxConfig.sites.length} 个 OmniBox 站点 + ${enhancements.parses.length} parses + ${enhancements.doh.length} doh + ${enhancements.flags.length} flags`);

    fs.writeFileSync(JIEKOU_PATH, JSON.stringify(omniBoxConfig, null, 2), 'utf-8');
    console.log(`✓ jiekou.json: 同步`);

    // dc.json：多仓索引（相对路径，影视仓按当前 host 解析）
    const dc = {
      urls: [
        { name: '🚀OmniBox全站', url: '/config.json' },
        ...externalSources.map((src, i) => ({
          name: src.name,
          url: `/api/line/${i}.json`,
        })),
      ],
    };
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
