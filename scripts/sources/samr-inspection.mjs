/**
 * A 级信源：国家市场监督管理总局 · 抽检与监管公告
 * 栏目路径随官网改版变动，已实测可达入口按优先级排列，逐个回退。
 */
import { fetchGeneric } from './generic-html.mjs'

export const meta = {
  id: 'samr-inspection',
  name: '国家市场监督管理总局 · 抽检与监管公告',
  tier: 'A',
  kind: 'inspection-notice',
}

/** 已实测可达（2026-08）：改版后如全部失效，crawl 会保留上次快照并在健康检查中告警 */
const ENTRIES = [
  'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/spcjs/',
  'https://www.samr.gov.cn/spcjs/',
  'https://www.samr.gov.cn/xw/zj/',
  'https://www.samr.gov.cn/xw/mtjj/',
]

/** 只保留与抽检、通报、标准、质量强相关的标题，过滤会议报道等噪音 */
const FILTER =
  /(抽检|抽查|监督|通报|不合格|合格率|公告|召回|标准|质量|检验|检测|风险|警示|处罚|规范|办法|规定|意见)/

export async function fetchItems(opts = {}) {
  return fetchGeneric({
    ...meta,
    entries: ENTRIES,
    keywordFilter: FILTER,
    limit: opts.limit ?? 40,
  })
}
