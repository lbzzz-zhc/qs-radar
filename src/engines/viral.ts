/**
 * 模块 3-②：爆款潜力评估
 *
 * 两阶段设计（按需求确认的路线）：
 *   V1 规则引擎  —— 标题公式库 + 题材热度权重 + 发布时段权重，零数据即可用
 *   V2 样本校准  —— 注入真实公众号爆款样本后，自动切换到 basis='sample'，
 *                   用样本分布回归修正基线，接口已预留 calibrate()
 */
import type { IntelItem, ViralAssessment, ViralSample } from '../types'

/* ---------------- 标题公式库 ---------------- */

export interface TitleFormula {
  name: string
  pattern: RegExp
  lift: number // 相对基线的点击率提升倍数
  hint: string
}

export const TITLE_FORMULAS: TitleFormula[] = [
  { name: '数字清单型', pattern: /(\d+\s*(个|条|种|招|点|件|类|大))/, lift: 1.28, hint: '「3 件事 / 5 个坑」结构，读者预期成本低' },
  { name: '时间紧迫型', pattern: /(即将|马上|下月|下周|\d+月\d+日起|正式实施|明天起|今起|倒计时)/, lift: 1.35, hint: '实施日临近是标准类内容最强的点击驱动' },
  { name: '损失规避型', pattern: /(别再|千万别|小心|警惕|避坑|踩坑|吃亏|被坑|白花钱|罚款|下架|召回)/, lift: 1.42, hint: '损失厌恶带来的打开率显著高于收益表述' },
  { name: '身份对号型', pattern: /(企业|家长|老板|从业者|你家|你买的|这些人|干这行)/, lift: 1.22, hint: '让特定人群产生「说的就是我」的代入' },
  { name: '悬念反差型', pattern: /(其实|竟然|没想到|真相|原来|意外|反而|第一名)/, lift: 1.18, hint: '制造认知缺口，但要防止标题党反噬' },
  { name: '权威背书型', pattern: /(国家标准|国标|强制性|市场监管总局|官方|新规|新国标|正式发布)/, lift: 1.25, hint: '质量与标准化赛道的天然优势，权威即流量' },
  { name: '实操指南型', pattern: /(怎么|如何|指南|清单|对照表|一图|教程|手把手|附)/, lift: 1.2, hint: '强收藏属性，利于长尾与二次传播' },
  { name: '疑问互动型', pattern: /(\?|？|吗|还是|哪个|谁)/, lift: 1.12, hint: '提问式提升评论区活跃度' },
]

/* ---------------- 题材热度权重 ---------------- */

const TOPIC_HEAT: { re: RegExp; delta: number; note: string }[] = [
  { re: /(食品|饮用水|婴幼儿|儿童|玩具|奶粉|添加剂)/, delta: 14, note: '食品与母婴是全网最高热度品类' },
  { re: /(电动自行车|锂电池|充电|燃气|消防|电梯)/, delta: 12, note: '公共安全类事件驱动强，易被大号转载' },
  { re: /(化妆品|护肤|美妆|口红|防晒)/, delta: 9, note: '美妆消费关注度高，女性读者活跃' },
  { re: /(家电|空调|冰箱|洗衣机|净水|空气净化)/, delta: 8, note: '耐用消费品选购刚需' },
  { re: /(甲醛|重金属|有害物质|致癌|辐射|微塑料)/, delta: 13, note: '健康风险关键词天然高唤醒' },
  { re: /(新能源|光伏|储能|充电桩|智能网联|自动驾驶)/, delta: 7, note: '产业热点，B 端读者关注' },
  { re: /(人工智能|大模型|算法|数据安全|个人信息)/, delta: 8, note: '科技议题外溢流量大' },
  { re: /(双碳|碳足迹|绿色|节能|能效)/, delta: 5, note: '政策向议题，稳定但不爆' },
  { re: /(建筑|钢材|水泥|机械|轴承|管材|试验方法)/, delta: -6, note: '工业窄众题材，需强化科普转译' },
  { re: /(术语|符号|词汇|分类与代码|通则|导则)/, delta: -10, note: '纯基础性标准，缺乏叙事抓手' },
]

/* ---------------- 发布时段权重（公众号经验值，V2 用真实样本覆盖） ---------------- */

export const SLOT_WEIGHTS: { slot: string; weight: number }[] = [
  { slot: '工作日 07:00-08:30（早高峰通勤）', weight: 1.24 },
  { slot: '工作日 11:40-13:00（午休）', weight: 1.16 },
  { slot: '工作日 17:30-19:00（晚高峰）', weight: 1.2 },
  { slot: '工作日 20:30-22:00（睡前黄金档）', weight: 1.3 },
  { slot: '周末 09:00-11:00', weight: 1.08 },
]

/* ---------------- 首图类型建议 ---------------- */

function suggestCover(item: IntelItem): string {
  const t = `${item.title} ${item.summary ?? ''}`
  if (/(食品|婴幼儿|玩具|化妆品|家电)/.test(t)) return '实物场景图 + 大字号红色数字（限值/日期），高对比度'
  if (/(抽检|不合格|通报|处罚)/.test(t)) return '数据条形图截图 + 「不合格」红章元素，制造信息密度感'
  if (/(即将实施|新规|发布)/.test(t)) return '日历/倒计时视觉 + 标准号大字，突出时间紧迫'
  if (/(出口|欧盟|国际|TBT)/.test(t)) return '地图/集装箱意象 + 中外标准对比双栏'
  return '深色底 + 标准号白色大字的「文件感」封面，强化权威调性'
}

/* ---------------- 主评估 ---------------- */

let SAMPLE_CALIBRATION: {
  active: boolean
  formulaLift: Record<string, number>
  slotBoost: Record<string, number>
  baseCtr: number
  sampleSize: number
} = { active: false, formulaLift: {}, slotBoost: {}, baseCtr: 3.1, sampleSize: 0 }

/**
 * V2：注入真实爆款样本做校准。
 * 样本来自「公众号热门原创文章」数据源，落盘在 public/data/viral-samples.json。
 */
export function calibrate(samples: ViralSample[]) {
  if (!samples || samples.length < 20) {
    SAMPLE_CALIBRATION.active = false
    return SAMPLE_CALIBRATION
  }
  const bucketScore: Record<ViralSample['readBucket'], number> = {
    '10w+': 5,
    '5w+': 4,
    '1w+': 3,
    '5k+': 2,
    below: 1,
  }

  // 统计每个标题公式在高阅读样本中的富集程度
  const formulaLift: Record<string, number> = {}
  for (const f of TITLE_FORMULAS) {
    const hit = samples.filter((s) => f.pattern.test(s.title))
    if (hit.length < 5) continue
    const hitAvg = avg(hit.map((s) => bucketScore[s.readBucket]))
    const allAvg = avg(samples.map((s) => bucketScore[s.readBucket]))
    if (allAvg > 0) formulaLift[f.name] = Number((hitAvg / allAvg).toFixed(3))
  }

  // 统计发布时段富集
  const slotBoost: Record<string, number> = {}
  for (const s of samples) {
    const h = new Date(s.publishedAt).getHours()
    if (Number.isNaN(h)) continue
    const key = slotKeyOfHour(h)
    slotBoost[key] = (slotBoost[key] ?? 0) + bucketScore[s.readBucket]
  }
  const maxSlot = Math.max(...Object.values(slotBoost), 1)
  for (const k of Object.keys(slotBoost)) slotBoost[k] = slotBoost[k] / maxSlot

  SAMPLE_CALIBRATION = {
    active: true,
    formulaLift,
    slotBoost,
    baseCtr: 3.1,
    sampleSize: samples.length,
  }
  return SAMPLE_CALIBRATION
}

export function calibrationState() {
  return SAMPLE_CALIBRATION
}

function slotKeyOfHour(h: number) {
  if (h >= 6 && h < 9) return '早高峰'
  if (h >= 11 && h < 14) return '午休'
  if (h >= 17 && h < 19) return '晚高峰'
  if (h >= 19 && h < 23) return '睡前'
  return '其他'
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/**
 * @param item 情报条目
 * @param credibilityTotal 可信度总分（0-100），权威度会正向影响标准类内容的传播
 * @param candidateTitle 可选：待评估的具体标题；不传则用条目原标题
 */
export function assessViral(
  item: IntelItem,
  credibilityTotal: number,
  candidateTitle?: string,
): ViralAssessment {
  const title = candidateTitle || item.title
  const text = `${title} ${item.summary ?? ''}`
  const breakdown: ViralAssessment['breakdown'] = []

  // 基线
  let score = 42
  breakdown.push({ factor: '基线分', delta: 42, note: '质量与标准化赛道平均水位' })

  // 1) 标题公式
  const matched = TITLE_FORMULAS.filter((f) => f.pattern.test(title))
  let liftProduct = 1
  for (const f of matched) {
    const lift = SAMPLE_CALIBRATION.active
      ? SAMPLE_CALIBRATION.formulaLift[f.name] ?? f.lift
      : f.lift
    liftProduct *= lift
    const d = Math.round((lift - 1) * 100 * 0.55)
    score += d
    breakdown.push({ factor: `标题公式·${f.name}`, delta: d, note: f.hint })
  }
  if (matched.length === 0) {
    score -= 8
    breakdown.push({
      factor: '标题公式·未命中',
      delta: -8,
      note: '原标题为标准正式名称，建议按公式库改写后再评估',
    })
  }

  // 2) 题材热度
  for (const h of TOPIC_HEAT) {
    if (h.re.test(text)) {
      score += h.delta
      breakdown.push({ factor: '题材热度', delta: h.delta, note: h.note })
      break // 只取命中的最高优先级题材，避免叠加虚高
    }
  }

  // 3) 时效窗口
  if (item.state === '即将实施' && item.effectiveDate) {
    const left = Math.round(
      (new Date(item.effectiveDate).getTime() - Date.now()) / 86400000,
    )
    if (left > 0 && left <= 60) {
      score += 12
      breakdown.push({ factor: '实施倒计时', delta: 12, note: `距实施 ${left} 天，处于最佳预告窗口` })
    } else if (left > 60 && left <= 180) {
      score += 6
      breakdown.push({ factor: '实施倒计时', delta: 6, note: `距实施 ${left} 天，可做前瞻解读` })
    }
  }
  if (item.state === '废止' || item.state === '被代替') {
    score -= 15
    breakdown.push({ factor: '标准已失效', delta: -15, note: '失效标准仅适合做对比复盘，不宜作主推选题' })
  }

  // 4) 权威度加成（本赛道权威即流量）
  const credDelta = Math.round((credibilityTotal - 60) * 0.22)
  score += credDelta
  breakdown.push({
    factor: '可信度联动',
    delta: credDelta,
    note: `可信度 ${credibilityTotal} 分，权威信源在本赛道具备额外转发势能`,
  })

  // 5) 标题长度惩罚（公众号列表页截断约 20-24 字）
  const len = title.replace(/\s/g, '').length
  if (len > 26) {
    score -= 6
    breakdown.push({ factor: '标题过长', delta: -6, note: `${len} 字，列表页会被截断，建议压到 22 字内` })
  } else if (len < 10) {
    score -= 4
    breakdown.push({ factor: '标题过短', delta: -4, note: `${len} 字，信息量不足以支撑点击决策` })
  }

  score = Math.max(5, Math.min(98, Math.round(score)))

  // 点击率区间：以赛道基线 CTR 为锚，按 lift 与得分推演
  const base = SAMPLE_CALIBRATION.baseCtr
  const center = base * (0.55 + score / 100) * Math.min(1.6, liftProduct)
  const lo = Math.max(0.4, center * 0.72)
  const hi = center * 1.34

  const bestSlot = pickSlot(item)

  return {
    score,
    ctrRange: `${lo.toFixed(1)}% - ${hi.toFixed(1)}%`,
    titleFormula: matched.length ? matched.map((m) => m.name).join(' + ') : '未命中（建议改写）',
    bestSlot,
    coverType: suggestCover(item),
    breakdown,
    basis: SAMPLE_CALIBRATION.active ? 'sample' : 'rule',
  }
}

function pickSlot(item: IntelItem): string {
  if (SAMPLE_CALIBRATION.active) {
    const entries = Object.entries(SAMPLE_CALIBRATION.slotBoost).sort((a, b) => b[1] - a[1])
    if (entries.length) {
      const map: Record<string, string> = {
        早高峰: '工作日 07:00-08:30（早高峰通勤）',
        午休: '工作日 11:40-13:00（午休）',
        晚高峰: '工作日 17:30-19:00（晚高峰）',
        睡前: '工作日 20:30-22:00（睡前黄金档）',
        其他: '工作日 20:30-22:00（睡前黄金档）',
      }
      return `${map[entries[0][0]] ?? entries[0][0]} · 基于 ${SAMPLE_CALIBRATION.sampleSize} 条真实样本`
    }
  }
  // 企业向内容走通勤档，消费者向内容走睡前档
  const t = item.title
  if (/(企业|生产|检验|抽查|合规|认证|许可)/.test(t)) return SLOT_WEIGHTS[0].slot
  return SLOT_WEIGHTS[3].slot
}
