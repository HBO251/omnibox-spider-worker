import { OMNIBOX_SPIDERS, EXTERNAL_SOURCES, LIVES, ENHANCEMENTS } from './external-sites.generated.js';

const SPIDER_URL = "https://oss4liview.moji.com/thd_file/2026/05/08/b216ded4a854a190ce9f6bd280aff779.jpg;md5;448a9f26f33109f6aa148971c3adab46";

const DRPY2_URL = 'https://raw.githubusercontent.com/fantaiying7/EXT/refs/heads/main/drpy2.min.js';

// 通过 Worker /proxy 端点加载 GitHub 资源，加速国内访问
function viaProxy(url) {
  return `/proxy?u=${encodeURIComponent(url)}`;
}

function makeSites(spiders) {
  return spiders.map(spider => ({
    key: spider.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 30),
    name: spider.name,
    type: 3,
    ext: viaProxy(spider.downloadUrl),
    api: viaProxy(DRPY2_URL),
    searchable: 1,
    quickSearch: 1,
    filterable: 1
  }));
}

function makeConfig(sites) {
  return {
    spider: SPIDER_URL,
    wallpaper: "https://深色壁纸.xxooo.cf/",
    sites: sites,
    lives: LIVES,
    ...ENHANCEMENTS
  };
}

export function generateConfig() {
  const sites = makeSites(OMNIBOX_SPIDERS);
  return makeConfig(sites);
}

export function generateSourceConfig(sourceIndex) {
  if (sourceIndex < 0 || sourceIndex >= EXTERNAL_SOURCES.length) return null;
  return EXTERNAL_SOURCES[sourceIndex].config;
}

export function getExternalSources() {
  return EXTERNAL_SOURCES;
}
