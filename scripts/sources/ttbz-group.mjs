/**
 * B 级信源：全国团体标准信息平台
 * 团标反映行业前沿动向，常先于国标出现，是「趋势预判」类选题的富矿，
 * 但权威性低于国标行标，在可信度引擎中权重相应下调。
 */
import { fetchGeneric } from './generic-html.mjs'

export const meta = {
  id: 'ttbz-group',
  name: '全国团体标准信息平台',
  tier: 'B',
  kind: 'group-standard',
}

const ENTRIES = ['https://www.ttbz.org.cn/Home/Standard', 'https://www.ttbz.org.cn/']

const FILTER = /(标准|规范|要求|技术|评价|导则|指南|管理|服务|检测|试验)/

export async function fetchItems(opts = {}) {
  return fetchGeneric({
    ...meta,
    entries: ENTRIES,
    keywordFilter: FILTER,
    limit: opts.limit ?? 30,
  })
}
