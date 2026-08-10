/**
 * A 级信源：WTO/TBT 技术性贸易措施通报
 * 实测可达入口：http://www.tbtsps.cn/
 * 价值：出海合规选题的一手来源，通报评议期是企业可参与的窗口。
 */
import { fetchGeneric } from './generic-html.mjs'

export const meta = {
  id: 'tbt-notification',
  name: 'WTO/TBT 技术性贸易措施通报',
  tier: 'A',
  kind: 'tbt-notification',
}

/**
 * 入口按可达性排序。已知情况（2026-08 实测）：
 *   - tbtsps.cn 首页为 JS 动态渲染，静态抓取取不到列表 → 保留作兜底
 *   - epingalert.org 为 WTO 官方平台，境外 runner 访问更稳
 * 若全部失败，crawl 会保留上次快照，并可通过前端「手动导入」补录。
 */
const ENTRIES = [
  'https://epingalert.org/en/Search/Index?domain=TBT',
  'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bzjss/',
  'http://www.tbtsps.cn/',
]

const FILTER = /(通报|TBT|SPS|技术法规|评议|措施|草案|标准|认证|限制|禁止|要求|notification|G\/TBT)/i

export async function fetchItems(opts = {}) {
  return fetchGeneric({
    ...meta,
    entries: ENTRIES,
    keywordFilter: FILTER,
    limit: opts.limit ?? 30,
  })
}
