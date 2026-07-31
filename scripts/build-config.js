const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'config.json');
const SRC_EXTERNAL_PATH = path.join(__dirname, '..', 'src', 'external-sites.generated.js');

const GITHUB_RAW = 'https://raw.githubusercontent.com/dlgt7/OmniBox-Spider/refs/heads/main/';

const CATEGORIES = [
  '影视/采集', '影视/网盘', '影视/磁力', '影视/解析',
  '动漫', '听书', '音乐', '教育', '直播', '短剧',
  '综合', '导航', '流媒体', 'Emby',
];

const AGGREGATOR_URLS = [
  'http://ztha.top/TVBox/GYCK.json',
  'http://xmbjm.fh4u.org/dc.txt',
  'http://xhztv.top/dc',
  'http://qxyc.cc/自用测试'
];

const SPIDER_URL = "https://oss4liview.moji.com/thd_file/2026/05/08/b216ded4a854a190ce9f6bd280aff779.jpg;md5;448a9f26f33109f6aa148971c3adab46";

async function fetchGitHubCategory(category) {
  const token = process.env.GITHUB_TOKEN || '';
  const url = `https://api.github.com/repos/dlgt7/OmniBox-Spider/contents/${encodeURIComponent(category)}`;
  try {
    const headers = {
      'User-Agent': 'OmniBox-Spider-Worker',
      'Accept': 'application/vnd.github.v3+json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function scanGitHubRepo() {
  console.log('扫描 GitHub OmniBox-Spider 仓库...');
  const spiders = [];
  for (const category of CATEGORIES) {
    try {
      const files = await fetchGitHubCategory(category);
      const jsFiles = files.filter(f => f.name.endsWith('.js') || f.name.endsWith('.py'));
      console.log(`  ${category}: ${jsFiles.length} 个`);
      for (const file of jsFiles) {
        spiders.push({
          name: file.name.replace(/\.(js|py)$/, ''),
          category,
          downloadUrl: `https://gh-proxy.org/${GITHUB_RAW}/${category}/${file.name}`,
        });
      }
    } catch (err) {
      console.log(`  ${category}: 失败 - ${err.message}`);
    }
  }
  console.log(`共 ${spiders.length} 个爬虫脚本\n`);
  return spiders;
}

async function fetchJSON(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchExternalSources() {
  console.log('获取聚合源子线路...');
  const results = await Promise.allSettled(
    AGGREGATOR_URLS.map(url => fetchJSON(url, 30000))
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
  const CONCURRENCY = 5;
  let fetched = 0;

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(([url]) => fetchJSON(url, 20000))
    );

    for (let j = 0; j < batchResults.length; j++) {
      fetched++;
      const result = batchResults[j];
      const name = entries[i + j][1] || entries[i + j][0];
      if (result.status === 'fulfilled' && result.value && result.value.sites) {
        sources.push({ name, config: result.value });
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

async function main() {
  console.log('=== 开始构建 ===\n');

  try {
    const spiders = await scanGitHubRepo();
    const externalSources = await fetchExternalSources();

    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // config.json：仅 OmniBox 爬虫（Worker 也只服务这些）
    const lives = [
      { name: "电视直播", type: 1, url: "https://raw.githubusercontent.com/iTCoffe/Collect-iTV/main/Internet_iTV.m3u" }
    ];

    const omniBoxConfig = {
      spider: SPIDER_URL,
      wallpaper: 'https://深色壁纸.xxooo.cf/',
      sites: spiders.map(s => ({
        key: s.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 30),
        name: s.name,
        type: 3,
        ext: s.downloadUrl,
        api: 'https://git.yylx.win/https://raw.githubusercontent.com/fantaiying7/EXT/refs/heads/main/drpy2.min.js',
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
      })),
      lives: lives,
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(omniBoxConfig, null, 2), 'utf-8');
    console.log(`✓ config.json: ${omniBoxConfig.sites.length} 个 OmniBox 站点`);

    fs.writeFileSync(path.join(outputDir, 'jiekou.json'), JSON.stringify(omniBoxConfig, null, 2), 'utf-8');
    console.log(`✓ jiekou.json: 同步`);

    // external-sites.generated.js：外部源原始配置 + OmniBox 爬虫列表
    const moduleContent = `// 由 build-config.js 自动生成，勿手动修改
export const EXTERNAL_SOURCES = ${JSON.stringify(externalSources, null, 2)};

export const OMNIBOX_SPIDERS = ${JSON.stringify(spiders.map(s => ({ name: s.name, category: s.category, downloadUrl: s.downloadUrl })), null, 2)};

export const LIVES = ${JSON.stringify(lives, null, 2)};
`;
    fs.writeFileSync(SRC_EXTERNAL_PATH, moduleContent, 'utf-8');
    console.log(`✓ external-sites.generated.js: ${externalSources.length} 个外部源 + ${spiders.length} 个 OmniBox 爬虫`);

    console.log('\n=== 构建完成 ===');
  } catch (error) {
    console.error('构建失败:', error.message);
    const emptyConfig = { spider: '', wallpaper: '', sites: [] };
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(emptyConfig, null, 2), 'utf-8');
    fs.writeFileSync(path.join(outputDir, 'jiekou.json'), JSON.stringify(emptyConfig, null, 2), 'utf-8');
  }
}

main();
