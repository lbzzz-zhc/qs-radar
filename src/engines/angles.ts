/**
 * 模块 3-①：选题角度生成（规则版）
 *
 * 规则版保证「断网 / 没配 AI Key 也能出至少 3 个可用角度」，
 * AI 版（src/ai/prompts.ts）在此基础上做语义化改写与扩写。
 */
import type { IntelItem, TopicAngle } from '../types'

interface AngleTemplate {
  perspective: string
  audience: string
  /** 触发条件，命中则该视角优先级提升 */
  triggers: RegExp
  direction: (i: IntelItem, subject: string) => string
  titles: (i: IntelItem, subject: string) => string[]
  keyPoints: (i: IntelItem, subject: string) => string[]
  basePriority: number
}

/** 从标题中提取「主体对象」，剥离标准号与通用后缀 */
export function extractSubject(item: IntelItem): string {
  let t = item.title
    .replace(/^GB[/T\s]*\d+[-—]\d+\s*/i, '')
    .replace(/^[A-Z]{2,4}[/T\s]*\d+[-—]\d+\s*/i, '')
    .replace(/《|》/g, '')
    .trim()
  // 取第一个语义段（标准命名常用空格 / 分隔层级）
  const seg = t.split(/\s{1,}|　|·/).filter((s) => s.length >= 2)
  if (seg.length >= 2 && seg[0].length <= 14) t = seg[0]
  return t.slice(0, 22) || item.title.slice(0, 22)
}

function dateLabel(item: IntelItem) {
  return item.effectiveDate || item.publishDate || item.publishedAt || '近期'
}

const TEMPLATES: AngleTemplate[] = [
  {
    perspective: '消费者维权视角',
    audience: '普通消费者、家长、关注生活品质的大众读者',
    triggers: /(食品|儿童|玩具|婴幼儿|化妆品|家电|家具|电动自行车|服装|纺织|安全|有害|甲醛|重金属|添加剂|消费|召回|缺陷|计量|电池)/,
    basePriority: 3,
    direction: (_i, s) =>
      `把「${s}」的技术条款翻译成消费者能直接用的选购与维权动作：买之前看什么、出问题怎么举证、依据哪一条。`,
    titles: (_i, s) => [
      `新规实施后，买${s}认准这几个数字就够了`,
      `${s}出问题怎么维权？这份国家标准就是你的证据`,
      `别再被导购忽悠，${s}的国家底线其实写得明明白白`,
    ],
    keyPoints: (i, _s) => [
      `用「货架场景」开篇：消费者最容易踩坑的 3 个环节`,
      `把标准中的限值 / 判定规则转成一张可保存的自查清单`,
      `明确维权路径：12315 投诉话术 + 引用${i.stdCode || '该标准'}具体条款`,
      `提醒生效时间：${dateLabel(i)}前后市面产品的差异`,
    ],
  },
  {
    perspective: '企业合规视角',
    audience: '生产企业质量负责人、体系工程师、供应链与采购',
    triggers: /(强制性|生产|制造|检验|抽查|抽检|认证|许可|标识|包装|工艺|设备|管理体系|安全生产|职业健康|计量|检测方法)/,
    basePriority: 3,
    direction: (_i, s) =>
      `拆解「${s}」对企业的合规冲击：新增了哪些条款、改造成本落在哪、留给整改的时间窗还有多久。`,
    titles: (i, s) => [
      `${dateLabel(i)}实施：${s}新规，企业要改的其实是这 3 件事`,
      `${s}标准更新，别等抽检了才发现产线不合规`,
      `一张对照表看懂${s}新旧标准差异，附整改优先级`,
    ],
    keyPoints: (i, _s) => [
      `新旧版差异对照：${i.replaceRelation || '替代关系需核查原文'}`,
      `按「设计 / 采购 / 生产 / 出厂检验」四段列出受影响环节`,
      `倒排整改时间轴，锚定实施日 ${i.effectiveDate || '待确认'}`,
      `不合规后果：监督抽查通报、下架、行政处罚的真实案例`,
    ],
  },
  {
    perspective: '产业升级视角',
    audience: '行业从业者、投研分析、政策研究、企业战略岗',
    triggers: /(绿色|低碳|双碳|碳|能效|节能|智能|数字化|人工智能|新能源|循环|回收|再生|高质量|产业|升级|先进|国际互认)/,
    basePriority: 2,
    direction: (_i, s) =>
      `从「${s}」这一条标准反推产业信号：标准抬高门槛之后，谁被淘汰、谁吃到红利。`,
    titles: (_i, s) => [
      `${s}标准提级，这轮洗牌谁会先出局`,
      `读懂${s}新标，就读懂了这个行业下一步往哪走`,
      `标准即门槛：${s}背后的产业升级逻辑`,
    ],
    keyPoints: (_i, _s) => [
      `标准指标变化 → 技术路线变化 → 成本结构变化的传导链`,
      `对照国际同类标准，判断是追赶还是领跑`,
      `点名受益 / 承压的环节（不点具体企业名，规避商誉风险）`,
      `给出 12 个月内的观察指标`,
    ],
  },
  {
    perspective: '国际贸易与出海视角',
    audience: '外贸企业、跨境电商、出口合规负责人',
    triggers: /(TBT|WTO|出口|进口|欧盟|CE|RoHS|REACH|通报|技术性贸易|海关|国际标准|ISO|IEC|采标|IDT|MOD)/,
    basePriority: 2,
    direction: (_i, s) =>
      `把「${s}」放进国际互认框架里看：采标关系决定了出口时能否一证通行。`,
    titles: (_i, s) => [
      `${s}与国际标准的差距，决定你的货能不能出关`,
      `采标不等于等同：${s}出海前必须确认的一件事`,
      `TBT 通报预警：${s}相关市场准入要变了`,
    ],
    keyPoints: (i, _s) => [
      `采标关系解读：${i.adoptionRelation || '需核查是否 IDT/MOD/NEQ 采用国际标准'}`,
      `国内合规 ≠ 目标市场合规，列出常见差异点`,
      `给出「一图流」出口合规检查清单`,
      `提示 TBT 通报评议期，企业可提意见的窗口`,
    ],
  },
  {
    perspective: '标准科普视角',
    audience: '标准化从业新人、质量管理入门者、泛知识读者',
    triggers: /.*/,
    basePriority: 1,
    direction: (_i, s) =>
      `用「${s}」做案例，讲清一条标准是怎么诞生、怎么落地、怎么影响每个人的。`,
    titles: (_i, s) => [
      `一条${s}标准的一生：从立项到贴在你家产品上`,
      `强制性、推荐性、团体标准，${s}属于哪一种？`,
      `${s}标准里那些看不懂的符号，其实一句话就能说明白`,
    ],
    keyPoints: (i, _s) => [
      `拆解标准号结构：${i.stdCode || 'GB/T XXXXX-YYYY'} 每一段代表什么`,
      `解释${i.nature || '标准性质'}的法律效力边界`,
      `用生活化类比解释核心技术指标`,
      `结尾给出「去哪查、怎么免费下载」的实操指引`,
    ],
  },
  {
    perspective: '监管执法视角',
    audience: '基层监管人员、检验检测机构、法务合规',
    triggers: /(抽检|抽查|监督|执法|不合格|通报|公告|处罚|召回|风险监测|判定)/,
    basePriority: 2,
    direction: (_i, s) =>
      `以「${s}」为切口，说明监管口径怎么变、判定依据是什么、企业最容易被抓的项目在哪。`,
    titles: (_i, s) => [
      `${s}抽检不合格项 TOP 榜，第一名年年都是它`,
      `监管口径变了：${s}的判定依据现在按这条走`,
      `一次抽检不合格要付多少代价？以${s}为例算笔账`,
    ],
    keyPoints: (_i, _s) => [
      `列出高频不合格项及其技术成因`,
      `明确判定依据条款与检测方法标准`,
      `复盘典型通报案例（做匿名化处理）`,
      `给企业的自检建议与留样规范`,
    ],
  },
]

/**
 * 生成选题角度，保证 ≥3 个不同切入角度。
 * @param count 期望角度数量，默认 4
 */
export function generateAngles(item: IntelItem, count = 4): TopicAngle[] {
  const subject = extractSubject(item)
  const text = `${item.title} ${item.summary ?? ''} ${(item.keywords ?? []).join(' ')}`

  const ranked = TEMPLATES.map((t) => {
    const hit = t.triggers.test(text)
    // 命中触发词 +3，A 级信源让合规/监管视角再加权
    let p = t.basePriority + (hit ? 3 : 0)
    if (item.tier === 'A' && /合规|监管/.test(t.perspective)) p += 1
    if (item.state === '即将实施' && t.perspective === '企业合规视角') p += 2
    return { t, p }
  })
    .sort((a, b) => b.p - a.p)
    .map((x) => x.t)

  // 「标准科普视角」作为兜底永远保留，保证角度多样性
  const picked = ranked.slice(0, Math.max(3, count))
  return picked.map((t) => ({
    perspective: t.perspective,
    audience: t.audience,
    direction: t.direction(item, subject),
    titles: t.titles(item, subject),
    keyPoints: t.keyPoints(item, subject),
  }))
}
