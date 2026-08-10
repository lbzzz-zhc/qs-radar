/**
 * 模块 2 · 五维可信度评判引擎（差异化核心）
 *
 * 设计原则：
 * 1. 纯函数、零网络依赖 —— 断网也能跑完整评判，AI 只做增强不做依赖
 * 2. 每一维得分都必须给出可追溯的文字依据，绝不黑箱
 * 3. 评分阈值集中管理，便于团队按实际经验校准
 */
import type {
  CredibilityResult,
  CredibilityScores,
  Grade,
  IntelItem,
} from '../types'

/** 各维度权重，合计 1.0 */
export const DIMENSION_WEIGHTS: Record<keyof CredibilityScores, number> = {
  authority: 0.28,
  freshness: 0.18,
  corroboration: 0.2,
  quantification: 0.18,
  relevance: 0.16,
}

export const DIMENSION_LABELS: Record<keyof CredibilityScores, string> = {
  authority: '来源权威性',
  freshness: '时效新鲜度',
  corroboration: '交叉印证',
  quantification: '量化程度',
  relevance: '受众相关性',
}

/** 评级阈值（加权总分 0-100） */
const GRADE_CUTS: { grade: Grade; min: number }[] = [
  { grade: 'A', min: 80 },
  { grade: 'B', min: 65 },
  { grade: 'C', min: 50 },
  { grade: 'D', min: 0 },
]

/* ------------------------------------------------------------------ */
/* 维度 1：来源权威性                                                    */
/* ------------------------------------------------------------------ */

/** 标准层级权威性：国标 > 行标 > 团标 > 媒体 */
const KIND_AUTHORITY: Record<string, number> = {
  'national-standard': 5,
  regulation: 5,
  'inspection-notice': 4.6,
  'tbt-notification': 4.4,
  'industry-standard': 4.2,
  'local-standard': 3.6,
  'group-standard': 3.2,
  institution: 2.8,
  news: 2,
  other: 2,
}

const TIER_FLOOR: Record<string, number> = { A: 4, B: 2.8, C: 1.5 }

function scoreAuthority(item: IntelItem): [number, string] {
  const byKind = KIND_AUTHORITY[item.kind] ?? 2
  const floor = TIER_FLOOR[item.tier] ?? 1.5
  let s = Math.max(byKind, floor)
  const notes: string[] = [`${item.tier} 级信源`]

  // 强制性国家标准的权威性拉满
  if (item.nature?.includes('强制')) {
    s = 5
    notes.push('强制性标准，法定约束力')
  } else if (item.nature?.includes('推荐')) {
    notes.push('推荐性标准')
  }

  // 有明确标准号视为可精确溯源
  if (item.stdCode) notes.push(`可溯源标准号 ${item.stdCode}`)
  // C 级媒体线索若无原文链接，权威性再降一档
  if (item.tier === 'C' && !item.url) {
    s = Math.max(1, s - 1)
    notes.push('缺少可核验原文链接，降档')
  }

  return [clamp(s), notes.join('；')]
}

/* ------------------------------------------------------------------ */
/* 维度 2：时效新鲜度（是否被替代 / 是否现行有效 / 距今时长）              */
/* ------------------------------------------------------------------ */

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

export function parseDate(v?: string): Date | null {
  if (!v) return null
  const t = v.trim().replace(/[./]/g, '-')
  const m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function scoreFreshness(item: IntelItem, now = new Date()): [number, string] {
  const notes: string[] = []

  // 失效状态是硬性一票否决项
  if (item.state === '废止' || item.state === '被代替') {
    return [1, `标准已${item.state}，仅可作历史对照，不宜作为现行依据`]
  }

  const anchor =
    parseDate(item.publishDate) ?? parseDate(item.publishedAt) ?? parseDate(item.fetchedAt)
  if (!anchor) return [2.5, '缺少可靠时间字段，按中位数保守计分']

  const age = daysBetween(now, anchor)
  let s: number
  if (age <= 7) {
    s = 5
    notes.push('7 天内发布，处于传播黄金窗口')
  } else if (age <= 30) {
    s = 4.5
    notes.push('30 天内发布，热度仍在')
  } else if (age <= 90) {
    s = 3.8
    notes.push('90 天内发布')
  } else if (age <= 365) {
    s = 3
    notes.push('一年内发布')
  } else if (age <= 365 * 3) {
    s = 2.2
    notes.push('发布超过 1 年，需确认是否已有新版')
  } else {
    s = 1.5
    notes.push('发布超过 3 年，替代风险高')
  }

  // 即将实施 = 强预告价值，是自媒体最好的选题窗口
  const eff = parseDate(item.effectiveDate)
  if (eff && item.state === '即将实施') {
    const left = daysBetween(eff, now)
    if (left > 0 && left <= 180) {
      s = Math.min(5, s + 1)
      notes.push(`距实施仅 ${left} 天，具备强预告价值`)
    } else if (left > 180) {
      s = Math.min(5, s + 0.5)
      notes.push(`将于 ${item.effectiveDate} 实施`)
    }
  }
  if (item.state === '现行') notes.push('现行有效')

  return [clamp(s), notes.join('；')]
}

/* ------------------------------------------------------------------ */
/* 维度 3：交叉印证（是否被 ≥2 个独立信源证实）                           */
/* ------------------------------------------------------------------ */

/** 抽取用于比对的指纹：标准号优先，其次标题主干词 */
function fingerprints(item: IntelItem): string[] {
  const fps: string[] = []
  if (item.stdCode) fps.push(normalizeStdCode(item.stdCode))
  const core = item.title
    .replace(/[《》（）()【】\[\]“”"',，。.、\s]/g, '')
    .slice(0, 40)
  if (core.length >= 6) fps.push(core)
  return fps
}

export function normalizeStdCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, '').replace(/—/g, '-')
}

function scoreCorroboration(
  item: IntelItem,
  pool: IntelItem[],
): [number, string, string[]] {
  const myFps = fingerprints(item)
  if (myFps.length === 0) return [2, '无可比对指纹（缺标准号与有效标题主干）', []]

  const hits: string[] = []
  const independentSources = new Set<string>()

  for (const other of pool) {
    if (other.id === item.id) continue
    const otherFps = fingerprints(other)
    const matched = myFps.some((f) =>
      otherFps.some((g) => f === g || (f.length > 8 && g.includes(f)) || (g.length > 8 && f.includes(g))),
    )
    if (matched) {
      hits.push(other.id)
      independentSources.add(other.sourceId)
    }
  }

  const n = independentSources.size
  let s: number
  let note: string
  if (n >= 3) {
    s = 5
    note = `被 ${n} 个独立信源印证，可信度高`
  } else if (n === 2) {
    s = 4.5
    note = '被 2 个独立信源印证，达到交叉验证门槛'
  } else if (n === 1) {
    s = 3
    note = '仅 1 个其他信源提及，建议补充核验'
  } else {
    // A 级官方信源即使孤证，本身也具备权威性，不应过度惩罚
    s = item.tier === 'A' ? 3 : 1.5
    note =
      item.tier === 'A'
        ? '暂无其他信源印证，但属官方一手发布，单源即可采信'
        : '孤证，未被任何独立信源印证，需人工核验'
  }
  return [clamp(s), note, hits.slice(0, 8)]
}

/* ------------------------------------------------------------------ */
/* 维度 4：量化程度（具体限值 / 检测方法 / 判定规则）                      */
/* ------------------------------------------------------------------ */

const QUANT_PATTERNS: { re: RegExp; label: string; weight: number }[] = [
  { re: /(≤|≥|<|>|不大于|不小于|不得超过|不低于|最大值|最小值|限值|限量)/, label: '含明确限值表述', weight: 1.4 },
  { re: /\d+(\.\d+)?\s*(mg\/kg|mg\/L|μg\/kg|ug\/kg|ppm|%|℃|°C|kPa|MPa|N\/mm|dB|mm|kg|小时|h\b)/i, label: '含具体量化指标与单位', weight: 1.3 },
  { re: /(试验方法|检测方法|测试方法|检验规则|测定|抽样方案)/, label: '含检测/试验方法', weight: 1.2 },
  { re: /(判定规则|合格判定|判定依据|符合性判定|不合格项)/, label: '含判定规则', weight: 1.1 },
  { re: /(技术要求|性能要求|安全要求|卫生要求)/, label: '含技术/安全要求', weight: 0.8 },
  { re: /(标识|标志|标签|包装|运输|贮存)要求/, label: '含标识标签要求', weight: 0.5 },
]

function scoreQuantification(item: IntelItem): [number, string] {
  const text = [item.title, item.summary, item.stdCode, item.nature]
    .filter(Boolean)
    .join(' ')
  let s = 1
  const hits: string[] = []
  for (const p of QUANT_PATTERNS) {
    if (p.re.test(text)) {
      s += p.weight
      hits.push(p.label)
    }
  }
  // 标准类文本天然含技术条款，给予基础加成
  if (
    item.kind === 'national-standard' ||
    item.kind === 'industry-standard' ||
    item.kind === 'group-standard'
  ) {
    s += 1
    hits.push('标准正文天然含技术条款')
  }
  if (hits.length === 0) return [1, '未识别到限值、检测方法或判定规则，偏定性描述']
  return [clamp(s), hits.join('；')]
}

/* ------------------------------------------------------------------ */
/* 维度 5：受众相关性（企业合规 / 消费者权益 / 行业升级）                  */
/* ------------------------------------------------------------------ */

export const RELEVANCE_DICT: { axis: string; words: string[]; weight: number }[] = [
  {
    axis: '企业合规',
    weight: 1.35,
    words: ['强制性', '监督抽查', '抽检', '合规', '备案', '认证', '许可', '处罚', '召回', '整改', 'market surveillance', '生产许可', 'CCC', '3C'],
  },
  {
    axis: '消费者权益',
    weight: 1.3,
    words: ['食品', '儿童', '玩具', '化妆品', '婴幼儿', '家电', '电动自行车', '安全', '有害物质', '甲醛', '重金属', '添加剂', '消费', '维权', '虚假宣传', '缺陷'],
  },
  {
    axis: '行业升级',
    weight: 1.15,
    words: ['碳达峰', '碳中和', '双碳', '绿色', '低碳', '能效', '智能制造', '数字化', '人工智能', '新能源', '循环利用', '高质量发展', '产业链', '出海', '国际互认'],
  },
  {
    axis: '贸易与出口',
    weight: 1.1,
    words: ['TBT', 'WTO', '出口', '欧盟', 'CE', 'RoHS', 'REACH', '通报', '技术性贸易', '海关', '国际标准', 'ISO', 'IEC'],
  },
]

function scoreRelevance(item: IntelItem): [number, string] {
  const text = `${item.title} ${item.summary ?? ''} ${(item.keywords ?? []).join(' ')}`
  let s = 1.4
  const axes: string[] = []
  for (const g of RELEVANCE_DICT) {
    const hit = g.words.filter((w) => text.toLowerCase().includes(w.toLowerCase()))
    if (hit.length) {
      s += g.weight * Math.min(1.6, 0.75 + (hit.length - 1) * 0.28)
      axes.push(`${g.axis}(${hit.slice(0, 3).join('/')})`)
    }
  }
  if (axes.length === 0) {
    return [1.6, '未命中核心受众关切词，属专业窄众议题，科普转化难度大']
  }
  return [clamp(s), `命中受众维度：${axes.join('，')}`]
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

function clamp(n: number, min = 1, max = 5) {
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10
}

export function gradeOf(total: number): Grade {
  return GRADE_CUTS.find((g) => total >= g.min)!.grade
}

/**
 * 评判单个条目。
 * @param pool 用于交叉印证的候选池（通常是全量数据集）
 */
export function evaluateCredibility(
  item: IntelItem,
  pool: IntelItem[] = [],
  now = new Date(),
): CredibilityResult {
  const [authority, aWhy] = scoreAuthority(item)
  const [freshness, fWhy] = scoreFreshness(item, now)
  const [corroboration, cWhy, corroboratedBy] = scoreCorroboration(item, pool)
  const [quantification, qWhy] = scoreQuantification(item)
  const [relevance, rWhy] = scoreRelevance(item)

  const scores: CredibilityScores = {
    authority,
    freshness,
    corroboration,
    quantification,
    relevance,
  }

  const total = Math.round(
    (Object.keys(scores) as (keyof CredibilityScores)[]).reduce(
      (acc, k) => acc + (scores[k] / 5) * DIMENSION_WEIGHTS[k] * 100,
      0,
    ),
  )

  const grade = gradeOf(total)

  return {
    scores,
    total,
    grade,
    reasons: {
      authority: aWhy,
      freshness: fWhy,
      corroboration: cWhy,
      quantification: qWhy,
      relevance: rWhy,
    },
    corroboratedBy,
    // 需求明确：低于 C 的不进选题池
    admitted: grade !== 'D',
    engine: 'rule',
  }
}

/** 批量评判，内部复用同一候选池以保证交叉印证一致 */
export function evaluateAll(items: IntelItem[], now = new Date()) {
  return items.map((it) => ({ item: it, credibility: evaluateCredibility(it, items, now) }))
}
