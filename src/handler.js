import { OMNIBOX_SPIDERS } from './external-sites.generated.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_TTL = {
  config: 600,
  proxy: 3600,
};

// GitHub 加速代理列表（已验证可达），并行竞速取最快
const PROXIES = [
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
  'https://git.yylx.win/',
  'https://ghfast.top/',
];

const PROXY_HOSTS = ['ghproxy.net', 'gh-proxy.com', 'gh-proxy.org', 'gh.ddlc.top', 'ghproxy.cc', 'ghfast.top', 'git.yylx.win'];

// 归一化 URL：把路径/查询中的非 ASCII 字符重新百分号编码。
// 影视仓等客户端传回的 u 参数解一次码后可能含中文字面量，直接 fetch 会被上游以 400 拒绝
function normalizeTarget(raw) {
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

function isAlreadyProxied(targetUrl) {
  try {
    return PROXY_HOSTS.includes(new URL(targetUrl).hostname);
  } catch {
    return false;
  }
}

// 按扩展名推断 Content-Type（影视仓识别 JS 爬虫 / jar / m3u 的关键）
const EXT_TO_MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jar': 'application/java-archive',
  '.m3u': 'audio/x-mpegurl',
  '.m3u8': 'audio/x-mpegurl',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

function guessMime(targetUrl) {
  try {
    const path = new URL(targetUrl).pathname.toLowerCase();
    for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
      if (path.endsWith(ext)) return mime;
    }
  } catch { /* fall through */ }
  return null;
}

function addCors(headers) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
}

function json(data, status = 200, cacheSeconds = CACHE_TTL.config) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  });
}

// 并行竞速：直连 + 全部代理同时发起，取第一个成功响应，其余 abort
// 注意不能用 Promise.race 直接收束——失败分支也 resolve(null)，首个"失败"会提前赢下竞速
async function fetchFastest(targetUrl, timeoutMs = 15000) {
  const attempts = isAlreadyProxied(targetUrl)
    ? [targetUrl]
    : [targetUrl, ...PROXIES.map((p) => p + targetUrl)];

  return new Promise((resolve) => {
    let done = false;
    let pending = attempts.length;
    const controllers = new Map();

    const abortOthers = (winnerUrl) => {
      for (const [u, c] of controllers) {
        if (u !== winnerUrl) c.abort();
      }
    };

    for (const url of attempts) {
      const controller = new AbortController();
      controllers.set(url, controller);
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      fetch(url, { signal: controller.signal, redirect: 'follow' })
        .then((res) => {
          if (res && res.ok && !done) {
            done = true;
            resolve({ url, res });
            abortOthers(url);
          }
        })
        .catch(() => {})
        .finally(() => {
          clearTimeout(timer);
          pending -= 1;
          if (!done && pending === 0) {
            done = true;
            resolve(null);
          }
        });
    }
  });
}

// Cloudflare Cache API：边缘缓存代理结果
async function proxyFetch(targetUrl) {
  const cache = caches.default;
  const cacheKey = `https://256-hb-proxy/${targetUrl}`;
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      addCors(headers);
      return new Response(cached.body, { status: 200, headers });
    }
  } catch { /* cache unavailable */ }

  const fast = await fetchFastest(targetUrl);
  if (!fast) return null;
  const res = fast.res;

  const mime = guessMime(targetUrl) || res.headers.get('content-type') || 'application/octet-stream';
  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', mime);
  headers.set('Cache-Control', `public, max-age=${CACHE_TTL.proxy}, s-maxage=${CACHE_TTL.proxy}`);
  const passthrough = new Response(res.body, { status: 200, headers });
  try {
    const clone = passthrough.clone();
    await cache.put(cacheKey, clone);
  } catch { /* cache put failed */ }
  return passthrough;
}

// 通过 ASSETS 绑定读取静态文件并附加 CORS/缓存头
async function serveAsset(env, request, assetPath) {
  const req = new Request(new URL(assetPath, request.url), request);
  const res = await env.ASSETS.fetch(req);
  if (!res || res.status === 404) return null;
  const headers = new Headers(res.headers);
  addCors(headers);
  headers.set('Cache-Control', `public, max-age=${CACHE_TTL.config}, s-maxage=${CACHE_TTL.config}`);
  return new Response(res.body, { status: 200, headers });
}

function getHomePage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OmniBox Spider Worker</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;max-width:800px;margin:50px auto;padding:20px;background:#f5f5f5}
    .c{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
    h1{color:#333;border-bottom:2px solid #4CAF50;padding-bottom:10px}
    .e{background:#f9f9f9;padding:15px;margin:10px 0;border-radius:5px;border-left:4px solid #4CAF50}
    .e h3{margin-top:0;color:#4CAF50}
    code{background:#e8e8e8;padding:2px 6px;border-radius:3px;font-family:"Courier New",monospace}
    a{color:#4CAF50;text-decoration:none}a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="c">
    <h1>🕷️ OmniBox Spider Worker</h1>
    <div class="e"><h3>多仓线路</h3><p><a href="/dc.json"><code>/dc.json</code></a></p></div>
    <div class="e"><h3>单仓配置</h3><p><a href="/config.json"><code>/config.json</code></a></p></div>
    <div class="e"><h3>爬虫列表</h3><p><a href="/api/spiders"><code>/api/spiders</code></a></p></div>
  </div>
</body>
</html>`;
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // 代理端点：加速 GitHub 资源（爬虫脚本、jar、m3u）
  if (path === '/proxy') {
    let target = url.searchParams.get('u');
    if (!target) return new Response('Missing u param', { status: 400, headers: CORS_HEADERS });
    // TVBox/OmniBox 的 ;md5; 校验后缀不是下载地址的一部分，剥离避免上游 404
    target = target.split(';md5;')[0];
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response('Invalid URL', { status: 400, headers: CORS_HEADERS });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return new Response('Invalid protocol', { status: 400, headers: CORS_HEADERS });
    }
    // SSRF 防护：阻止内网/回环地址
    const host = parsed.hostname;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|localhost)/.test(host)) {
      return new Response('Blocked', { status: 403, headers: CORS_HEADERS });
    }
    const res = await proxyFetch(normalizeTarget(target));
    if (!res) return new Response('Upstream failed', { status: 502, headers: CORS_HEADERS });
    return res;
  }

  // 爬虫列表（轻量，内存数据）
  if (path === '/api/spiders') {
    return json(OMNIBOX_SPIDERS);
  }

  // 旧版无后缀线路 URL，重定向到 .json 静态文件（向后兼容）
  const legacyLine = path.match(/^\/api\/line\/(\d+)$/);
  if (legacyLine) {
    const res = await serveAsset(env, request, `/api/line/${legacyLine[1]}.json`);
    if (res) return res;
    return json({ error: '线路不存在' }, 404);
  }

  // 静态配置文件（dc.json / config.json / jiekou.json / api/line/N.json）
  if (path === '/dc.json' || path === '/config.json' || path === '/jiekou.json' || /^\/api\/line\/\d+\.json$/.test(path)) {
    const res = await serveAsset(env, request, path);
    if (res) return res;
    return json({ error: '配置不存在' }, 404);
  }

  // 首页
  if (path === '/' || path === '/index.html') {
    return new Response(getHomePage(), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
}
