/**
 * 质标雷达 · 全局类型契约
 * 抓取脚本(scripts/) 与前端(src/) 共用同一套数据形状，
 * 任何字段变更都必须同时更新 scripts/schema.mjs 中的校验逻辑。
 */

/** 信源分级：A=强制采信 B=重要参考 C=线索参考 */
export type SourceTier = 'A' | 'B' | 'C'

/** 综合评级 */
export type Grade = 'A' | 'B' | 'C' | 'D'

/** 条目大类 */
export type ItemKind =
  | 'national-standard' // 国家标准
  | 'industry-standard' // 行业标准
  | 'group-standard' // 团体标准
  | 'local-standard' // 地方标准
  | 'tbt-notification' // WTO/TBT 通报
  | 'inspection-notice' // 监管抽检公告
  | 'regulation' // 法规/规章
  | 'institution' // 检测机构/行业协会动态
  | 'news' // 媒体新闻
  | 'other'

/** 标准状态 */
export type StdState = '现行' | '即将实施' | '废止' | '被代替' | '未知'

/** 信源定义 */
export interface SourceDef {
  id: string
  name: string
  tier: SourceTier
  kind: ItemKind
  homepage: string
  /** 抓取适配器标识，对应 scripts/sources/<adapter>.mjs */
  adapter: string
  enabled: boolean
  /** 权威性基准分 1-5，供可信度引擎使用 */
  authorityBase: number
  note?: string
}

/** 标准化后的情报条目 —— 全系统流通的基本单位 */
export interface IntelItem {
  /** 稳定去重 ID：sha1(sourceId + 原始唯一键) 前 16 位 */
  id: string
  sourceId: string
  sourceName: string
  tier: SourceTier
  kind: ItemKind

  title: string
  url: string
  summary?: string

  /** ---- 标准类元数据（模块1 规范要求） ---- */
  stdCode?: string // 标准号 GB/T 30751-2026
  publishDate?: string // 发布日期 ISO yyyy-MM-dd
  effectiveDate?: string // 实施日期
  state?: StdState // 现行/即将实施/废止
  nature?: string // 强制性 / 推荐性 / 指导性
  administration?: string // 归口部门
  issuingDept?: string // 发布部门
  ics?: string // ICS 分类号
  ccs?: string // 中国标准分类号
  adoptionRelation?: string // 采标关系 IDT/MOD/NEQ ISO xxxx
  replaceRelation?: string // 替代关系（代替 GB/T xxx）
  relatedRegulations?: string[] // 关联法规

  /** ---- 通用元数据 ---- */
  publishedAt?: string // 条目时间（新闻发布时间等）
  keywords?: string[]
  /** 抓取时间戳 */
  fetchedAt: string
  /** 原始载荷片段，便于溯源核对 */
  raw?: Record<string, unknown>
}

/** 五维可信度得分（每维 1-5） */
export interface CredibilityScores {
  authority: number // 来源权威性
  freshness: number // 时效新鲜度
  corroboration: number // 交叉印证
  quantification: number // 量化程度
  relevance: number // 受众相关性
}

export interface CredibilityResult {
  scores: CredibilityScores
  /** 加权总分 0-100 */
  total: number
  grade: Grade
  /** 每一维的判定依据，全部可追溯，不做黑箱 */
  reasons: Record<keyof CredibilityScores, string>
  /** 交叉印证命中的其他条目 id */
  corroboratedBy: string[]
  /** 是否进入选题池（>= C 级） */
  admitted: boolean
  /** 评判来源：规则引擎 / AI 增强 */
  engine: 'rule' | 'rule+ai'
}

/** 选题角度 */
export interface TopicAngle {
  /** 视角标识 */
  perspective: string
  /** 一句话选题方向 */
  direction: string
  /** 建议标题（3 个候选） */
  titles: string[]
  /** 目标读者 */
  audience: string
  /** 核心论点 */
  keyPoints: string[]
}

/** 爆款潜力评估 */
export interface ViralAssessment {
  /** 综合潜力分 0-100 */
  score: number
  /** 预测点击率区间，如 "3.2% - 5.8%" */
  ctrRange: string
  /** 命中的标题公式 */
  titleFormula: string
  /** 建议发布时段 */
  bestSlot: string
  /** 建议首图类型 */
  coverType: string
  /** 加减分明细 */
  breakdown: { factor: string; delta: number; note: string }[]
  /** 数据依据：rule=规则引擎推演，sample=真实样本校准 */
  basis: 'rule' | 'sample'
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

export interface RiskFlag {
  category: '涉政' | '涉外' | '敏感品牌' | '商业纠纷' | '医疗健康' | '数据合规' | '绝对化用语'
  level: RiskLevel
  hits: string[]
  advice: string
}

export interface RiskReport {
  overall: RiskLevel
  flags: RiskFlag[]
  /** 是否建议人工复核后再发 */
  needsReview: boolean
}

/** 完整选题包：一个条目走完全链路的产物 */
export interface TopicPackage {
  item: IntelItem
  credibility: CredibilityResult
  angles: TopicAngle[]
  viral: ViralAssessment
  risk: RiskReport
  generatedAt: string
  /** AI 生成的正文大纲（可选，按需生成） */
  outline?: string
}

/** 抓取产物数据集 */
export interface DataSet {
  version: string
  generatedAt: string
  /** 各信源抓取结果统计 */
  stats: {
    sourceId: string
    sourceName: string
    tier: SourceTier
    ok: boolean
    count: number
    error?: string
    durationMs: number
  }[]
  items: IntelItem[]
}

/** 爆款样本（模块3 第二阶段接入真实数据用） */
export interface ViralSample {
  title: string
  publishedAt: string
  /** 阅读量档位 */
  readBucket: '10w+' | '5w+' | '1w+' | '5k+' | 'below'
  coverType?: string
  account?: string
  topicTags?: string[]
}

/** AI 配置 */
export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  enabled: boolean
}
