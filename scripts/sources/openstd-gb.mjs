/**
 * A 级信源：国家标准全文公开系统 openstd.samr.gov.cn
 * 价值：提供国标全文在线预览/下载深链（hcno），并可补全归口部门、ICS、CCS 等元数据。
 *
 * 抓取策略：
 *   1. 解析分类列表页拿 hcno + 标准号 + 名称 + 状态 + 日期（一次请求拿一页）
 *   2. 仅对前 detailLimit 条抓详情页补全归口部门等（避免高频请求触发风控）
 */
import { getText } from '../lib/http.mjs'
import { makeId, normDate, normState, extractKeywords, nowISO, stripHtml, pMap } from '../lib/util.mjs'

const BASE = 'https://openstd.samr.gov.cn'

export const meta = {
  id: 'openstd-gb',
  name: '国家标准全文公开系统',
  tier: 'A',
  kind: 'national-standard',
}

/** p.p1: 0=全部 1=强制性国标 2=推荐性国标 3=指导性技术文件 */
function listUrl(type = 0, page = 1) {
  return `${BASE}/bzgk/gb/std_list_type?p.p1=${type}&p.p90=circulation_date&p.p91=desc&p.p2=&page=${page}`
}

export function detailUrl(hcno) {
  return `${BASE}/bzgk/gb/newGbInfo?hcno=${hcno}`
}

/** 解析列表页表格行
 *  注意：hcno 出现在「标准号」单元格的 onclick 中，因此必须以整个 <tr> 为切片单位，
 *  否则会丢掉标准号列。列结构（实测）：
 *  [0]序号 [1]标准号 [2]中文名称 [3]性质(强标/推标) [4]状态 [5]发布日期 [6]实施日期 [7]操作
 */
function parseList(html) {
  const out = []
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1]
    const hm = row.match(/showInfo\('([A-F0-9]{16,})'\)/i)
    if (!hm) continue
    const hcno = hm[1]

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripHtml(c[1]))
    if (cells.length < 4) continue

    const stdCode = cells.find((c) => /^(GB|GB\/T|GB\/Z)\s?\d+/i.test(c) || /^[A-Z]{2,3}[\s/]?T?\s?\d{2,6}([.-]\d+)?[-—]\d{4}/i.test(c))
    const dates = cells
      .filter((c) => /^\d{4}-\d{1,2}-\d{1,2}/.test(c))
      .map((c) => c.slice(0, 10))
    const state = cells.find((c) => /^(现行|即将实施|废止|废除|被代替)$/.test(c.trim()))
    const natureCell = cells.find((c) => /^(强标|推标|指导性技术文件|强制|推荐)$/.test(c.trim()))

    // 中文名称：排除标准号、日期、状态、性质、纯英文、纯数字的最长中文单元格
    const title = cells
      .filter(
        (c) =>
          c.length > 3 &&
          c !== stdCode &&
          !/^\d{4}-/.test(c) &&
          !/^(现行|即将实施|废止|废除|被代替|强标|推标|查看详细|指导性技术文件)$/.test(c.trim()) &&
          /[\u4e00-\u9fa5]/.test(c),
      )
      .sort((a, b) => b.length - a.length)[0]

    if (!title) continue
    out.push({
      hcno,
      stdCode: stdCode?.replace(/\s+/g, ' ').trim(),
      title: title.trim(),
      state: state?.trim(),
      natureShort: natureCell?.trim(),
      publishDate: dates[0],
      effectiveDate: dates[1],
    })
  }
  return out
}

/** 解析详情页补全元数据 */
export function parseDetail(html) {
  const text = stripHtml(html)
  const pick = (label, stop) => {
    const re = new RegExp(`${label}[：:\\s]+([^\\n]{1,80}?)\\s*(?=${stop})`)
    const m = text.match(re)
    return m ? m[1].trim() : undefined
  }
  const STOP = '中国标准分类号|国际标准分类号|发布日期|实施日期|主管部门|归口部门|发布单位|备注|在线预览|下载标准|标准状态|英文标准名称|中文标准名称|$'
  return {
    ccs: pick('中国标准分类号（CCS）', STOP),
    ics: pick('国际标准分类号（ICS）', STOP),
    administration: pick('归口部门', STOP),
    competentDept: pick('主管部门', STOP),
    issuingDept: pick('发布单位', STOP),
    remark: pick('备注', STOP),
  }
}

export async function fetchItems(opts = {}) {
  const { types = [1, 2], detailLimit = 10, pages = 1 } = opts
  const collected = []

  for (const t of types) {
    for (let p = 1; p <= pages; p++) {
      try {
        const html = await getText(listUrl(t, p), { referer: `${BASE}/bzgk/gb/` })
        const rows = parseList(html)
        for (const r of rows) {
          collected.push({ ...r, nature: t === 1 ? '强制性国家标准' : t === 2 ? '推荐性国家标准' : '指导性技术文件' })
        }
      } catch (e) {
        console.warn(`  [openstd-gb] 列表 type=${t} page=${p} 抓取失败：${e.message}`)
      }
    }
  }

  // 去重
  const seen = new Set()
  const uniq = collected.filter((r) => (seen.has(r.hcno) ? false : (seen.add(r.hcno), true)))

  // 详情补全（限量，避免触发风控）
  const needDetail = uniq.slice(0, detailLimit)
  const details = await pMap(
    needDetail,
    async (r) => {
      const html = await getText(detailUrl(r.hcno), { referer: `${BASE}/bzgk/gb/`, retries: 1 })
      return parseDetail(html)
    },
    3,
  )
  const detailMap = new Map()
  needDetail.forEach((r, i) => {
    const d = details[i]
    if (d && !d.__error) detailMap.set(r.hcno, d)
  })

  return uniq.map((r) => {
    const d = detailMap.get(r.hcno) || {}
    return {
      id: makeId(meta.id, r.hcno),
      sourceId: meta.id,
      sourceName: meta.name,
      tier: meta.tier,
      kind: meta.kind,
      title: r.title,
      url: detailUrl(r.hcno),
      stdCode: r.stdCode,
      nature: r.nature,
      publishDate: normDate(r.publishDate),
      effectiveDate: normDate(r.effectiveDate),
      state: normState(r.state),
      administration: d.administration,
      issuingDept: d.issuingDept,
      ics: d.ics,
      ccs: d.ccs,
      replaceRelation: d.remark && /代替/.test(d.remark) ? d.remark : undefined,
      keywords: extractKeywords(r.title),
      publishedAt: normDate(r.publishDate),
      fetchedAt: nowISO(),
      raw: { hcno: r.hcno, competentDept: d.competentDept, fullTextAvailable: true },
    }
  })
}
