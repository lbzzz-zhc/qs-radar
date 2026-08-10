/**
 * 提示词工程 —— 全部围绕「质量与标准化」垂类做了角色与约束设定。
 *
 * 关键约束（写进 system prompt，防止 AI 编造）：
 *   1. 不得虚构标准号、限值、日期
 *   2. 信息不足时必须显式标注「需核实」
 *   3. 输出必须是可直接使用的成品，不要过程性废话
 */
import type { CredibilityResult, IntelItem, TopicAngle } from '../types'

const ROLE = `你是「质量与标准化」领域的资深科普内容主编，有 10 年国标/行标解读与合规传播经验。
你的读者是企业质量负责人、监管从业者和关注消费安全的大众。

铁律：
1. 绝不虚构标准号、限值数据、发布日期、归口部门。原文没有的信息，写「需核实」。
2. 不使用「最」「第一」「唯一」「100%」等《广告法》第九条禁止的绝对化用语。
3. 不点名具体企业品牌；确需指代时使用「某品牌」「涉事企业」。
4. 涉政、涉外内容只做技术层面陈述，不做价值判断和国别优劣评价。
5. 输出直接可用，不要写「好的，我来帮您…」这类过程话术。`

function itemBrief(item: IntelItem) {
  const rows = [
    ['标题', item.title],
    ['标准号', item.stdCode],
    ['信源', `${item.sourceName}（${item.tier} 级）`],
    ['性质', item.nature],
    ['状态', item.state],
    ['发布日期', item.publishDate],
    ['实施日期', item.effectiveDate],
    ['归口部门', item.administration],
    ['ICS', item.ics],
    ['采标关系', item.adoptionRelation],
    ['替代关系', item.replaceRelation],
    ['摘要', item.summary?.slice(0, 400)],
    ['原文链接', item.url],
  ].filter(([, v]) => v)
  return rows.map(([k, v]) => `- ${k}：${v}`).join('\n')
}

/** ① 五维可信度 AI 复核（在规则引擎结果之上做校正） */
export function credibilityReviewPrompt(item: IntelItem, rule: CredibilityResult) {
  return [
    { role: 'system' as const, content: ROLE },
    {
      role: 'user' as const,
      content: `以下是一条待评判的质量与标准化情报，以及规则引擎给出的五维初评。
请你以专业编辑视角复核，对明显偏离的维度做出修正（每维 1-5 分，可为小数）。

【情报】
${itemBrief(item)}

【规则引擎初评】
- 来源权威性 ${rule.scores.authority}（${rule.reasons.authority}）
- 时效新鲜度 ${rule.scores.freshness}（${rule.reasons.freshness}）
- 交叉印证 ${rule.scores.corroboration}（${rule.reasons.corroboration}）
- 量化程度 ${rule.scores.quantification}（${rule.reasons.quantification}）
- 受众相关性 ${rule.scores.relevance}（${rule.reasons.relevance}）

只输出 JSON，不要任何解释文字：
{
  "authority": 数字, "freshness": 数字, "corroboration": 数字,
  "quantification": 数字, "relevance": 数字,
  "adjustments": [{"dim":"维度中文名","from":原分,"to":新分,"why":"修正理由，30字内"}],
  "verdict": "一句话总体判断，40字内"
}`,
    },
  ]
}

/** ② 选题角度头脑风暴（要求 ≥3 个不同切入角度） */
export function anglesPrompt(item: IntelItem, existing: TopicAngle[]) {
  return [
    { role: 'system' as const, content: ROLE },
    {
      role: 'user' as const,
      content: `基于以下情报，头脑风暴出 4 个**切入角度互不重复**的选题方案。
必须覆盖至少三类视角：消费者维权视角、企业合规视角、产业升级视角（可再加国际贸易/监管执法/科普视角）。

【情报】
${itemBrief(item)}

【规则引擎已给出的角度，请勿简单重复，要更具体、更有画面感】
${existing.map((a) => `- ${a.perspective}：${a.direction}`).join('\n')}

只输出 JSON 数组，不要任何解释文字：
[
  {
    "perspective": "视角名称",
    "direction": "这个角度要讲什么，60字内，要具体到可执行",
    "titles": ["标题1", "标题2", "标题3"],
    "audience": "目标读者画像",
    "keyPoints": ["核心论点1", "核心论点2", "核心论点3", "核心论点4"]
  }
]

标题要求：22 字以内；至少一条用数字清单结构；至少一条用损失规避结构；不得使用绝对化用语。`,
    },
  ]
}

/** ③ 正文大纲与开头段生成 */
export function outlinePrompt(item: IntelItem, angle: TopicAngle) {
  return [
    { role: 'system' as const, content: ROLE },
    {
      role: 'user' as const,
      content: `为以下选题写一份可直接开写的**公众号文章大纲**。

【情报】
${itemBrief(item)}

【选定角度】
- 视角：${angle.perspective}
- 方向：${angle.direction}
- 读者：${angle.audience}
- 论点：${angle.keyPoints.join('；')}

输出 Markdown，包含：
1. **推荐标题**（3 选 1，标注推荐理由）
2. **开头 150 字**（直接可用的成稿，要有场景感，不要套话）
3. **正文结构**（4-6 个小标题，每个标题下 2-3 条要点，标注该段落需要引用的原文数据位置）
4. **结尾行动指引**（读者看完能立刻做的 2-3 件事）
5. **事实核查清单**（列出本文所有需要回原文核对的数据点，逐条列出）

约束：所有涉及具体限值、日期的地方，如果上面情报中没有给出，一律写成「【待核实：需查阅原文第 X 章】」，绝不编造。`,
    },
  ]
}

/** ④ 风险复核（在规则扫描之上做语义级判断） */
export function riskPrompt(item: IntelItem, titles: string[]) {
  return [
    { role: 'system' as const, content: ROLE },
    {
      role: 'user' as const,
      content: `对以下选题与候选标题做发布前风险复核。

【情报】${item.title}
【候选标题】
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

排查维度：涉政表述、涉外对抗性措辞、点名品牌的商誉风险、未决商业纠纷的事实认定、
医疗健康因果断言、《广告法》绝对化用语、数据引用可溯源性。

只输出 JSON：
{
  "overall": "none|low|medium|high",
  "issues": [{"category":"类别","level":"low|medium|high","hit":"具体命中的表述","suggestion":"改写建议"}],
  "safeTitles": ["改写后的安全标题1","改写后的安全标题2"]
}`,
    },
  ]
}
