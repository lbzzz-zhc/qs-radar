/**
 * 通用 HTML 列表适配器 —— 用于监管公告、协会动态、检测机构资讯等结构不固定的信源。
 *
 * 设计要点：政务/协会站点改版极其频繁，因此不写死单一选择器，
 * 而是「多候选入口 URL + 启发式链接抽取 + 标题白名单过滤」，
 * 保证站点小改版时仍能拿到数据，彻底失败时由 crawl.mjs 保留上次快照。
 */
import { getText } from '../lib/http.mjs'
import { makeId, normDate, extractKeywords, nowISO, stripHtml } from '../lib/util.mjs'

/** 从 HTML 中启发式抽取「标题 + 链接 + 日期」三元组 */
export function extractListing(html, baseUrl, opts = {}) {
  const { minTitleLen = 8, keywordFilter } = opts
  const out = []
  const anchorRe = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,240}?)<\/a>/gi
  let m
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1]
    const title = stripHtml(m[2])
    if (title.length < minTitleLen || title.length > 120) continue
    if (/^(首页|更多|下一页|上一页|返回|登录|注册|English|网站地图)/.test(title)) continue
    if (/^(javascript|mailto|tel):/i.test(href)) continue
    if (keywordFilter && !keywordFilter.test(title)) continue

    let url
    try {
      url = new URL(href, baseUrl).href
    } catch {
      continue
    }

    // 在锚点后 260 字符窗口内找日期（列表页日期通常紧随标题）
    const tail = html.slice(m.index, m.index + m[0].length + 260)
    const dm = tail.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
    const date = dm ? normDate(`${dm[1]}-${dm[2]}-${dm[3]}`) : undefined

    out.push({ title, url, date })
  }

  // 按 URL 去重，保留首次出现
  const seen = new Set()
  return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)))
}

/**
 * @param {{id:string,name:string,tier:string,kind:string,entries:string[],keywordFilter?:RegExp,limit?:number}} cfg
 */
export async function fetchGeneric(cfg) {
  const { id, name, tier, kind, entries, keywordFilter, limit = 30 } = cfg
  const items = []
  const errors = []

  for (const entry of entries) {
    try {
      const html = await getText(entry, { retries: 1, timeout: 20000 })
      const rows = extractListing(html, entry, { keywordFilter })
      for (const r of rows.slice(0, limit)) {
        items.push({
          id: makeId(id, r.url),
          sourceId: id,
          sourceName: name,
          tier,
          kind,
          title: r.title,
          url: r.url,
          publishDate: r.date,
          publishedAt: r.date,
          keywords: extractKeywords(r.title),
          fetchedAt: nowISO(),
          raw: { entry },
        })
      }
      if (items.length >= limit) break
    } catch (e) {
      errors.push(`${entry} → ${e.message}`)
    }
  }

  if (items.length === 0 && errors.length) {
    throw new Error(`所有入口均未取到数据：\n${errors.join('\n')}`)
  }
  return items.slice(0, limit)
}
