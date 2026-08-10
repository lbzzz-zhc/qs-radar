import crypto from 'node:crypto'

/** 稳定去重 ID：同一条目在多次抓取中必须得到相同 id */
export function makeId(sourceId, uniqueKey) {
  return crypto
    .createHash('sha1')
    .update(`${sourceId}::${uniqueKey}`)
    .digest('hex')
    .slice(0, 16)
}

/** 日期规范化为 yyyy-MM-dd，无法解析返回 undefined */
export function normDate(v) {
  if (!v) return undefined
  const s = String(v).trim()
  let m = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  }
  return undefined
}

/** 剥离 HTML 标签与实体，压缩空白 */
export function stripHtml(html) {
  if (!html) return ''
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 标准状态归一化 */
export function normState(v) {
  const s = String(v || '').trim()
  if (!s) return '未知'
  if (s.includes('现行')) return '现行'
  if (s.includes('即将实施') || s.includes('未实施')) return '即将实施'
  if (s.includes('废止')) return '废止'
  if (s.includes('代替') || s.includes('被替代')) return '被代替'
  return '未知'
}

/** 从标准名称中提取关键词，供相关性与检索使用 */
const STOP = new Set([
  '第', '部分', '通用', '技术', '要求', '方法', '规范', '标准', '试验', '测定',
  '及', '与', '的', '和', '或', '通则', '导则',
])
export function extractKeywords(title, limit = 8) {
  if (!title) return []
  const segs = String(title)
    .replace(/[《》()（）【】\[\]，,。.、;；:：/\\-]/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !STOP.has(s) && !/^\d+$/.test(s))
  return [...new Set(segs)].slice(0, limit)
}

/** 识别采标关系：IDT / MOD / NEQ + 国际标准号 */
export function parseAdoption(text) {
  if (!text) return undefined
  const m = String(text).match(
    /(IDT|MOD|NEQ|等同采用|修改采用|非等效采用)[\s:：]*((ISO|IEC|EN|ASTM|JIS|ANSI)[\s\w:.\-/]+)/i,
  )
  if (m) return `${m[1].toUpperCase()} ${m[2].trim()}`
  const m2 = String(text).match(/((ISO|IEC|EN)\s?\d{3,5}(-\d+)?(:\d{4})?)/i)
  return m2 ? m2[1] : undefined
}

/** 识别替代关系 */
export function parseReplace(text) {
  if (!text) return undefined
  const m = String(text).match(/(代替|替代|废止)\s*((GB|GB\/T|[A-Z]{2}\/T|[A-Z]{2})\s?\d+(\.\d+)?[-—]\d{4}[^；;，,。]*)/)
  return m ? `代替 ${m[2].trim()}` : undefined
}

export function nowISO() {
  return new Date().toISOString()
}

/** 简易并发限流器 */
export async function pMap(list, worker, concurrency = 4) {
  const out = []
  let idx = 0
  const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (idx < list.length) {
      const i = idx++
      try {
        out[i] = await worker(list[i], i)
      } catch (e) {
        out[i] = { __error: e.message }
      }
    }
  })
  await Promise.all(runners)
  return out
}
