/**
 * 模块 3-③：发布前风险扫描
 *
 * 定位：**预警器**，不是审查器。命中只代表「该点需要人工确认」，
 * 不代表内容违规。所有规则均基于公开法规与平台运营常识：
 *   - 《广告法》第九条：绝对化用语
 *   - 《反不正当竞争法》：商业诋毁
 *   - 平台通用运营规范：涉政 / 涉外 / 医疗健康表述审慎
 */
import type { IntelItem, RiskFlag, RiskLevel, RiskReport } from '../types'

interface RiskRule {
  category: RiskFlag['category']
  words: string[]
  level: RiskLevel
  advice: string
}

const RULES: RiskRule[] = [
  {
    category: '涉政',
    level: 'medium',
    words: [
      '中央', '国务院', '政治', '领导人', '换届', '两会', '批示', '讲话精神',
      '体制改革', '意识形态', '维稳', '举报腐败', '官员',
    ],
    advice:
      '涉及政策与机构表述时，只引用官方原文与官方通稿口径，不做延伸解读、不做政策动机揣测，不使用非官方简称。',
  },
  {
    category: '涉外',
    level: 'medium',
    words: [
      '美国', '日本', '欧盟', '韩国', '印度', '贸易战', '制裁', '脱钩', '断供',
      '卡脖子', '反倾销', '关税壁垒', '国别对比', '技术封锁',
    ],
    advice:
      '涉外内容坚持「就技术论技术」：只比较标准条款与技术指标差异，不做国别优劣评价、不带对抗性措辞，不引用境外未经核实的信息源。',
  },
  {
    category: '敏感品牌',
    level: 'high',
    words: [], // 由用户自定义品牌词表注入，默认空
    advice:
      '点名具体品牌存在商誉与法律风险。建议改为「某品牌」「抽检通报中的 X 类产品」等匿名表述；若必须点名，须完整引用官方通报原文并附来源链接。',
  },
  {
    category: '商业纠纷',
    level: 'medium',
    words: [
      '起诉', '诉讼', '索赔', '侵权', '假冒', '打假', '维权事件', '纠纷',
      '曝光', '黑幕', '内幕', '举报', '欺诈', '造假',
    ],
    advice:
      '涉及未决纠纷时，仅陈述已生效的官方结论（判决书、行政处罚决定书、监管通报），对进行中的争议使用「涉嫌」「据通报」等限定语，不做事实认定。',
  },
  {
    category: '医疗健康',
    level: 'medium',
    words: [
      '致癌', '治疗', '疗效', '药效', '治愈', '抗癌', '排毒', '增强免疫',
      '中毒', '致畸', '致命', '有毒',
    ],
    advice:
      '健康风险表述必须锚定标准限值与权威风险评估结论，避免「吃了会致癌」式因果断言；剂量与暴露条件必须交代清楚。',
  },
  {
    category: '数据合规',
    level: 'low',
    words: ['个人信息', '人脸识别', '数据出境', '隐私', '生物识别', '用户画像'],
    advice: '引用数据类案例时避免展示真实个人信息，截图需打码，统计数据注明口径与来源。',
  },
  {
    category: '绝对化用语',
    level: 'high',
    words: [
      '国家级', '最高级', '最佳', '第一品牌', '唯一', '顶级', '极品', '最好',
      '最强', '最优', '最安全', '100%', '绝对', '永久', '根治', '史上最',
    ],
    advice:
      '《广告法》第九条禁用绝对化用语。改为「较高」「在本次抽检中排名靠前」「依据 XX 标准判定为合格」等可验证表述。',
  },
]

const LEVEL_ORDER: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 }

export interface RiskScanOptions {
  /** 用户自定义敏感品牌词表 */
  brandWatchlist?: string[]
  /** 附加待扫描文本（如 AI 生成的标题、大纲） */
  extraText?: string
}

export function scanRisk(item: IntelItem, opts: RiskScanOptions = {}): RiskReport {
  const text = [item.title, item.summary, opts.extraText].filter(Boolean).join('\n')
  const flags: RiskFlag[] = []

  for (const rule of RULES) {
    const words =
      rule.category === '敏感品牌'
        ? (opts.brandWatchlist ?? []).filter(Boolean)
        : rule.words
    if (words.length === 0) continue

    const hits = words.filter((w) => text.includes(w))
    if (hits.length === 0) continue

    // 命中越多，风险等级越高
    let level = rule.level
    if (hits.length >= 3 && level === 'low') level = 'medium'
    if (hits.length >= 3 && level === 'medium') level = 'high'

    flags.push({ category: rule.category, level, hits: [...new Set(hits)].slice(0, 8), advice: rule.advice })
  }

  // A 级官方信源原文引用，涉政/涉外风险实际可控，自动降一档
  if (item.tier === 'A') {
    for (const f of flags) {
      if ((f.category === '涉政' || f.category === '涉外') && f.level === 'medium') {
        f.level = 'low'
        f.advice = `【来自 A 级官方信源，风险可控】${f.advice}`
      }
    }
  }

  const overall = flags.reduce<RiskLevel>(
    (acc, f) => (LEVEL_ORDER[f.level] > LEVEL_ORDER[acc] ? f.level : acc),
    'none',
  )

  return {
    overall,
    flags: flags.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]),
    needsReview: LEVEL_ORDER[overall] >= LEVEL_ORDER.medium,
  }
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  none: '无明显风险',
  low: '低风险',
  medium: '中风险 · 建议复核',
  high: '高风险 · 必须复核',
}
