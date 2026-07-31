import { generateConfig, generateSourceConfig, getExternalSources } from './config-generator.js';
import { OMNIBOX_SPIDERS } from './external-sites.generated.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// GitHub 加速代理列表，按优先级尝试
const PROXIES = [
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
  'https://gh.ddlc.top/',
  'https://git.yylx.win/',
];

// 判断 URL 是否已带代理前缀（避免代理套代理）
const PROXY_HOSTS = ['ghproxy.net', 'gh-proxy.com', 'gh-proxy.org', 'gh.ddlc.top', 'git.yylx.win', 'ghproxy.cc', 'ghfast.top'];

function isAlreadyProxied(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname;
    return PROXY_HOSTS.includes(host);
  } catch {
    return false;
  }
}

// 直连 + 代理，全部失败才算失败
async function fetchWithFallback(rawTarget) {
  let targetUrl;
  try {
    // 标准化 URL：自动把中文路径等非 ASCII 转成百分号编码，避免 fetch 携带原始中文
    targetUrl = new URL(rawTarget).toString();
  } catch {
    return null;
  }
  let attempts;
  if (isAlreadyProxied(targetUrl)) {
    // 已带代理前缀：只尝试直连该代理
    attempts = [targetUrl];
  } else {
    attempts = [targetUrl, ...PROXIES.map(p => p + targetUrl)];
  }
  for (const url of attempts) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
      if (res.ok) return res;
    } catch {
      // 尝试下一个
    }
  }
  return null;
}

function getBaseUrl(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // 多仓格式索引
  if (path === '/dc.json') {
    const base = getBaseUrl(request);
    const sources = getExternalSources();
    return json({
      urls: [
        { name: '🚀OmniBox全站', url: `${base}/config.json` },
        ...sources.map((src, i) => ({
          name: src.name,
          url: `${base}/api/line/${i}`,
        })),
      ],
    });
  }

  // 单线路（原样返回外部源的完整原始配置）
  const lineMatch = path.match(/^\/api\/line\/(\d+)$/);
  if (lineMatch) {
    const config = generateSourceConfig(parseInt(lineMatch[1], 10));
    if (!config) return json({ error: '线路不存在' }, 404);
    return json(config);
  }

  // 单仓：仅 OmniBox 爬虫
  if (path === '/config.json' || path === '/jiekou.json') {
    return json(generateConfig());
  }

  // 爬虫列表
  if (path === '/api/spiders') {
    return json(OMNIBOX_SPIDERS);
  }

  // 代理端点：加速访问 GitHub 资源（爬虫脚本、jar 等）
  if (path === '/proxy') {
    const target = url.searchParams.get('u');
    if (!target) return new Response('Missing u param', { status: 400, headers: CORS_HEADERS });
    // 仅允许 http/https，防止 SSRF 到内网
    let parsed;
    try { parsed = new URL(target); } catch {
      return new Response('Invalid URL', { status: 400, headers: CORS_HEADERS });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return new Response('Invalid protocol', { status: 400, headers: CORS_HEADERS });
    }
    // 阻止访问内网地址
    const host = parsed.hostname;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|localhost)/.test(host)) {
      return new Response('Blocked', { status: 403, headers: CORS_HEADERS });
    }
    return fetchWithFallback(target).then(res => {
      if (!res) return new Response('Upstream failed', { status: 502, headers: CORS_HEADERS });
      const newHeaders = new Headers(CORS_HEADERS);
      const ct = res.headers.get('content-type');
      if (ct) newHeaders.set('Content-Type', ct);
      return new Response(res.body, { status: 200, headers: newHeaders });
    });
  }

  // 首页
  if (path === '/' || path === '/index.html') {
    return new Response(getHomePage(), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
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
