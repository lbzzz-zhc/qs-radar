/**
 * A 级信源：全国标准信息公共服务平台 · 行业标准 / 地方标准
 * 接口：GET https://std.samr.gov.cn/hb/search/hbPage （已验证）
 *       GET https://std.samr.gov.cn/db/search/dbPage （已验证）
 * 该接口字段最全：含归口部门 CHARGE_DEPT、适用范围 SUIT_SCOPE、标准类别。
 */
import { getJSON, tryUrls } from '../lib/http.mjs'
import {
  makeId, normDate, normState, extractKeywords, nowISO, stripHtml, parseAdoption, parseReplace,
} from '../lib/util.mjs'

const BASE = 'https://std.samr.gov.cn'

export const meta = {
  id: 'samr-std-hb',
  name: '全国标准信息公共服务平台 · 行业标准',
  tier: 'A',
  kind: 'industry-standard',
}

/** 平台改版会换路径，这里保留候选列表做自动回退 */
const CANDIDATES = {
  hb: [`${BASE}/hb/search/hbPage`, `${BASE}/hb/search/hbQueryPage`],
  db: [`${BASE}/db/search/dbPage`, `${BASE}/db/search/dbQueryPage`],
}

function mapRow(r, sourceId, sourceName, kind) {
  const title = String(r.C_C_NAME || r.STD_NAME || '').trim()
  if (!title) return null
  const stdCode = String(r.STD_CODE3 || r.STD_CODE2 || r.C_STD_CODE || '').trim()
  const scope = stripHtml(r.SUIT_SCOPE || '')

  return {
    id: makeId(sourceId, r.id || stdCode || title),
    sourceId,
    sourceName,
    tier: 'A',
    kind,
    title,
    url: r.id ? `${BASE}/${kind === 'local-standard' ? 'db' : 'hb'}/gjbzgkSearchPage?id=${r.id}` : BASE,
    summary: scope ? scope.slice(0, 300) : undefined,
    stdCode,
    nature: r.STD_NATURE || r.STD_CATEGORY || undefined,
    publishDate: normDate(r.ISSUE_DATE || r.CREATE_TIME || r.SYS_INPUTIME),
    effectiveDate: normDate(r.ACT_DATE),
    state: normState(r.STATE),
    administration: r.CHARGE_DEPT || r.TRADE_DEPT || undefined,
    issuingDept: r.CHARGE_DEPT || undefined,
    ics: r.ICS_CODE || undefined,
    ccs: r.CCS_CODE || undefined,
    adoptionRelation: parseAdoption(`${title} ${scope}`),
    replaceRelation: parseReplace(`${r.REMARK ?? ''} ${scope}`),
    keywords: extractKeywords(title),
    publishedAt: normDate(r.ISSUE_DATE || r.CREATE_TIME || r.SYS_INPUTIME),
    fetchedAt: nowISO(),
    raw: { domain: r.STD_DOMAIN, category: r.STD_CATEGORY, tradeDept: r.TRADE_DEPT },
  }
}

async function fetchGroup(kindKey, sourceId, sourceName, kind, pages, pageSize, keyword) {
  const items = []
  for (let p = 1; p <= pages; p++) {
    const query =
      `?searchText=${encodeURIComponent(keyword)}` +
      `&sortOrder=desc&sortField=circulation_date&pageSize=${pageSize}&pageNumber=${p}`
    const { data } = await tryUrls(
      CANDIDATES[kindKey].map((u) => u + query),
      getJSON,
      { referer: `${BASE}/${kindKey}` },
    )
    const rows = data?.rows ?? []
    if (!rows.length) break
    for (const r of rows) {
      const m = mapRow(r, sourceId, sourceName, kind)
      if (m) items.push(m)
    }
    if (rows.length < pageSize) break
  }
  return items
}

export async function fetchItems(opts = {}) {
  const { pages = 2, pageSize = 25, keyword = '' } = opts
  const out = []

  // 行业标准
  out.push(
    ...(await fetchGroup('hb', meta.id, meta.name, 'industry-standard', pages, pageSize, keyword)),
  )

  // 地方标准（同一适配器顺带抓取，失败不影响行标结果）
  try {
    out.push(
      ...(await fetchGroup(
        'db',
        'samr-std-db',
        '全国标准信息公共服务平台 · 地方标准',
        'local-standard',
        1,
        pageSize,
        keyword,
      )),
    )
  } catch (e) {
    console.warn(`  [samr-std-hb] 地方标准抓取失败（不影响行标）：${e.message}`)
  }

  return out
}
