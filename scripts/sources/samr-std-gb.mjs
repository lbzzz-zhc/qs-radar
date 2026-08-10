/**
 * A 级信源：全国标准信息公共服务平台 · 国家标准
 * 接口：GET https://std.samr.gov.cn/gb/search/gbQueryPage
 * 已验证可用，返回 JSON，收录 7.8 万余项国标。
 */
import { getJSON } from '../lib/http.mjs'
import { makeId, normDate, normState, extractKeywords, nowISO, parseReplace, parseAdoption } from '../lib/util.mjs'

const BASE = 'https://std.samr.gov.cn'
const ENDPOINT = `${BASE}/gb/search/gbQueryPage`

export const meta = {
  id: 'samr-std-gb',
  name: '全国标准信息公共服务平台 · 国家标准',
  tier: 'A',
  kind: 'national-standard',
}

/**
 * @param {{pages?:number, pageSize?:number, keyword?:string}} opts
 */
export async function fetchItems(opts = {}) {
  const { pages = 3, pageSize = 30, keyword = '' } = opts
  const items = []

  for (let p = 1; p <= pages; p++) {
    const url =
      `${ENDPOINT}?searchText=${encodeURIComponent(keyword)}` +
      `&sortOrder=desc&sortField=circulation_date&pageSize=${pageSize}&pageNumber=${p}`
    const json = await getJSON(url, { referer: `${BASE}/gb` })
    const rows = json?.rows ?? []
    if (rows.length === 0) break

    for (const r of rows) {
      const title = String(r.C_C_NAME || '').trim()
      if (!title) continue
      const stdCode = String(r.C_STD_CODE || '').trim()

      items.push({
        id: makeId(meta.id, r.id || stdCode || title),
        sourceId: meta.id,
        sourceName: meta.name,
        tier: meta.tier,
        kind: meta.kind,
        title,
        url: r.id
          ? `${BASE}/gb/search/gbDetailed?id=${r.id}`
          : `${BASE}/gb/search/gbQueryPage?searchText=${encodeURIComponent(stdCode)}`,
        stdCode,
        nature: r.STD_NATURE || undefined,
        publishDate: normDate(r.ISSUE_DATE),
        effectiveDate: normDate(r.ACT_DATE),
        state: normState(r.STATE),
        administration: r.CHARGE_DEPT || undefined,
        issuingDept: '国家市场监督管理总局、国家标准化管理委员会',
        adoptionRelation: parseAdoption(`${title} ${r.REMARK ?? ''}`),
        replaceRelation: parseReplace(`${r.REMARK ?? ''} ${r.REPLACE_STD ?? ''}`),
        keywords: extractKeywords(title),
        publishedAt: normDate(r.ISSUE_DATE),
        fetchedAt: nowISO(),
        raw: {
          projectId: r.PROJECT_ID,
          platformId: r.id,
        },
      })
    }
    if (rows.length < pageSize) break
  }

  return items
}
