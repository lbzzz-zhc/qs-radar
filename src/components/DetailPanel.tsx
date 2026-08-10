import { useCallback, useMemo, useRef, useState } from 'react'
import type { CredibilityResult, IntelItem, TopicAngle } from '../types'
import { DIMENSION_LABELS, evaluateCredibility } from '../engines/credibility'
import { generateAngles } from '../engines/angles'
import { assessViral, calibrationState } from '../engines/viral'
import { RISK_LEVEL_LABEL, scanRisk } from '../engines/risk'
import { useStore } from '../store'
import { chat, chatStream, extractJSON, AIError } from '../ai/client'
import { anglesPrompt, credibilityReviewPrompt, outlinePrompt, riskPrompt } from '../ai/prompts'
import RadarChart from './RadarChart'
import { GradeBadge, RiskBadge, ScoreBar, Section, TierBadge } from './ui'

interface Props {
  item: IntelItem
  pool: IntelItem[]
}

type Tab = 'credibility' | 'angles' | 'viral' | 'risk' | 'compose'

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'credibility', label: '可信度评判', hint: '五维雷达 + 综合评级' },
  { key: 'angles', label: '选题角度', hint: '多视角切入方案' },
  { key: 'viral', label: '爆款潜力', hint: '点击率区间预测' },
  { key: 'risk', label: '风险扫描', hint: '发布前雷区排查' },
  { key: 'compose', label: '内容生产', hint: 'AI 大纲与开头' },
]

export default function DetailPanel({ item, pool }: Props) {
  const [tab, setTab] = useState<Tab>('credibility')
  const { ai, brandWatchlist, starred, toggleStar } = useStore()

  const [aiAngles, setAiAngles] = useState<TopicAngle[] | null>(null)
  const [aiCred, setAiCred] = useState<CredibilityResult | null>(null)
  const [aiRisk, setAiRisk] = useState<{ overall: string; issues: any[]; safeTitles: string[] } | null>(null)
  const [outline, setOutline] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const ruleCred = useMemo(() => evaluateCredibility(item, pool), [item, pool])
  const credibility = aiCred ?? ruleCred
  const ruleAngles = useMemo(() => generateAngles(item, 4), [item])
  const angles = aiAngles ?? ruleAngles

  const [titleUnderTest, setTitleUnderTest] = useState<string>('')
  const viral = useMemo(
    () => assessViral(item, credibility.total, titleUnderTest || undefined),
    [item, credibility.total, titleUnderTest],
  )
  const risk = useMemo(
    () =>
      scanRisk(item, {
        brandWatchlist,
        extraText: angles.flatMap((a) => a.titles).join('\n'),
      }),
    [item, brandWatchlist, angles],
  )

  const runAI = useCallback(
    async (kind: string, fn: () => Promise<void>) => {
      setErr(null)
      setBusy(kind)
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      try {
        await fn()
      } catch (e) {
        setErr(e instanceof AIError ? e.message : `调用失败：${(e as Error).message}`)
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const doAICredibility = () =>
    runAI('cred', async () => {
      const raw = await chat(ai, credibilityReviewPrompt(item, ruleCred), abortRef.current?.signal)
      const j = extractJSON<any>(raw)
      const scores = {
        authority: num(j.authority, ruleCred.scores.authority),
        freshness: num(j.freshness, ruleCred.scores.freshness),
        corroboration: num(j.corroboration, ruleCred.scores.corroboration),
        quantification: num(j.quantification, ruleCred.scores.quantification),
        relevance: num(j.relevance, ruleCred.scores.relevance),
      }
      const weights = { authority: 0.28, freshness: 0.18, corroboration: 0.2, quantification: 0.18, relevance: 0.16 }
      const total = Math.round(
        (Object.keys(scores) as (keyof typeof scores)[]).reduce(
          (acc, k) => acc + (scores[k] / 5) * weights[k] * 100,
          0,
        ),
      )
      const grade = total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D'
      const reasons = { ...ruleCred.reasons }
      for (const adj of j.adjustments ?? []) {
        const key = Object.entries(DIMENSION_LABELS).find(([, v]) => v === adj.dim)?.[0]
        if (key) (reasons as any)[key] = `【AI 修正 ${adj.from}→${adj.to}】${adj.why}`
      }
      setAiCred({
        ...ruleCred,
        scores,
        total,
        grade,
        reasons,
        admitted: grade !== 'D',
        engine: 'rule+ai',
        // @ts-expect-error 附加展示字段
        verdict: j.verdict,
      })
    })

  const doAIAngles = () =>
    runAI('angles', async () => {
      const raw = await chat(ai, anglesPrompt(item, ruleAngles), abortRef.current?.signal)
      const arr = extractJSON<TopicAngle[]>(raw)
      if (!Array.isArray(arr) || arr.length === 0) throw new AIError('AI 未返回有效角度数组。')
      setAiAngles(
        arr.map((a) => ({
          perspective: String(a.perspective ?? '未命名视角'),
          direction: String(a.direction ?? ''),
          titles: (a.titles ?? []).map(String).slice(0, 3),
          audience: String(a.audience ?? ''),
          keyPoints: (a.keyPoints ?? []).map(String),
        })),
      )
    })

  const doAIRisk = () =>
    runAI('risk', async () => {
      const titles = angles.flatMap((a) => a.titles).slice(0, 8)
      const raw = await chat(ai, riskPrompt(item, titles), abortRef.current?.signal)
      setAiRisk(extractJSON(raw))
    })

  const doOutline = (angle: TopicAngle) =>
    runAI('outline', async () => {
      setOutline('')
      setTab('compose')
      await chatStream(
        ai,
        outlinePrompt(item, angle),
        (d) => setOutline((p) => p + d),
        abortRef.current?.signal,
      )
    })

  const isStar = starred.includes(item.id)

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="card mb-4 animate-fade-up p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <TierBadge tier={item.tier} />
          <GradeBadge grade={credibility.grade} total={credibility.total} />
          {item.state && (
            <span className={`chip ${item.state === '即将实施' ? 'border-grade-c/50 text-grade-c' : ''}`}>
              {item.state}
            </span>
          )}
          {item.nature && <span className="chip">{item.nature}</span>}
          {credibility.engine === 'rule+ai' && <span className="chip border-brand/50 text-brand">AI 已复核</span>}
          <button
            onClick={() => toggleStar(item.id)}
            className="ml-auto btn-ghost !px-2 !py-1 text-xs"
            title={isStar ? '取消收藏' : '收藏到选题池'}
          >
            {isStar ? '★ 已收藏' : '☆ 收藏'}
          </button>
        </div>

        <h2 className="text-lg font-semibold leading-snug tracking-tight">{item.title}</h2>

        <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5 text-xs sm:grid-cols-3">
          <Meta k="标准号" v={item.stdCode} mono />
          <Meta k="发布日期" v={item.publishDate} mono />
          <Meta k="实施日期" v={item.effectiveDate} mono highlight={item.state === '即将实施'} />
          <Meta k="归口部门" v={item.administration} />
          <Meta k="ICS 分类" v={item.ics} mono />
          <Meta k="CCS 分类" v={item.ccs} mono />
          <Meta k="采标关系" v={item.adoptionRelation} />
          <Meta k="替代关系" v={item.replaceRelation} />
          <Meta k="信息来源" v={item.sourceName} />
        </div>

        {item.summary && (
          <p className="mt-3 border-l-2 border-brand/40 pl-3 text-xs leading-relaxed text-muted">
            {item.summary}
          </p>
        )}

        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            查看原文 / 全文下载 →
          </a>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-elevated/50 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            title={t.hint}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              tab === t.key
                ? 'bg-brand text-white shadow-[0_4px_14px_-6px_rgb(var(--c-brand))]'
                : 'text-muted hover:bg-brand/10 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && (
        <div className="mb-3 rounded-xl border border-grade-d/40 bg-grade-d/10 px-3 py-2 text-xs text-grade-d">
          {err}
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto pb-8">
        {tab === 'credibility' && (
          <Section
            title="五维可信度评判"
            desc={`加权总分 ${credibility.total} / 100 · ${credibility.admitted ? '已进入选题池' : '低于 C 级，不建议进入选题池'}`}
            right={
              <button
                className="btn-ghost text-xs"
                disabled={!ai.apiKey || busy === 'cred'}
                onClick={doAICredibility}
                title={ai.apiKey ? '用 AI 复核规则引擎的初评' : '请先在右上角配置 API Key'}
              >
                {busy === 'cred' ? '复核中…' : 'AI 复核'}
              </button>
            }
          >
            <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start">
              <div className="shrink-0">
                <RadarChart scores={credibility.scores} grade={credibility.grade} size={268} />
              </div>
              <div className="w-full space-y-3">
                {(Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]).map((k) => (
                  <div key={k}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium">{DIMENSION_LABELS[k]}</span>
                      <span className="font-mono text-xs font-bold text-brand">
                        {credibility.scores[k].toFixed(1)}
                      </span>
                    </div>
                    <ScoreBar value={credibility.scores[k]} max={5} />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">{credibility.reasons[k]}</p>
                  </div>
                ))}
                {credibility.corroboratedBy.length > 0 && (
                  <p className="rounded-lg bg-brand/8 px-2 py-1.5 text-[11px] text-muted">
                    交叉印证命中 {credibility.corroboratedBy.length} 条关联记录
                  </p>
                )}
              </div>
            </div>
          </Section>
        )}

        {tab === 'angles' && (
          <Section
            title={`选题角度（${angles.length} 个切入视角）`}
            desc={aiAngles ? 'AI 头脑风暴生成' : '规则引擎生成，可用 AI 进一步扩写'}
            right={
              <button
                className="btn-ghost text-xs"
                disabled={!ai.apiKey || busy === 'angles'}
                onClick={doAIAngles}
              >
                {busy === 'angles' ? '生成中…' : 'AI 头脑风暴'}
              </button>
            }
          >
            <div className="space-y-3">
              {angles.map((a, i) => (
                <article key={i} className="card card-hover p-4">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="chip border-brand/45 text-brand">{a.perspective}</span>
                    <span className="text-[11px] text-muted">{a.audience}</span>
                    <button
                      className="ml-auto btn-ghost !px-2 !py-1 text-[11px]"
                      disabled={!ai.apiKey || busy === 'outline'}
                      onClick={() => doOutline(a)}
                      title="用这个角度生成完整文章大纲"
                    >
                      生成大纲 →
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed text-ink/85">{a.direction}</p>

                  <div className="mt-2.5 space-y-1">
                    {a.titles.map((t, j) => (
                      <button
                        key={j}
                        onClick={() => {
                          setTitleUnderTest(t)
                          setTab('viral')
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors hover:bg-brand/10"
                        title="点击测算这条标题的爆款潜力"
                      >
                        <span className="font-mono text-[10px] text-muted">{j + 1}</span>
                        <span className="flex-1">{t}</span>
                        <span className="text-[10px] text-brand opacity-0 transition-opacity group-hover:opacity-100">
                          测爆款 →
                        </span>
                      </button>
                    ))}
                  </div>

                  <ul className="mt-2 space-y-0.5 border-t border-line/70 pt-2">
                    {a.keyPoints.map((p, j) => (
                      <li key={j} className="flex gap-1.5 text-[11px] leading-relaxed text-muted">
                        <span className="text-brand">·</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </Section>
        )}

        {tab === 'viral' && (
          <Section
            title="爆款潜力评估"
            desc={
              viral.basis === 'sample'
                ? `已用 ${calibrationState().sampleSize} 条真实爆款样本校准`
                : '规则引擎推演（导入真实爆款样本后自动切换为数据校准模式）'
            }
          >
            <div className="mb-4">
              <label className="mb-1 block text-[11px] text-muted">待测标题（留空则用条目原标题）</label>
              <input
                className="field"
                value={titleUnderTest}
                placeholder={item.title}
                onChange={(e) => setTitleUnderTest(e.target.value)}
              />
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="潜力分" value={String(viral.score)} accent />
              <Stat label="预测点击率" value={viral.ctrRange} />
              <Stat label="命中公式" value={viral.titleFormula} small />
              <Stat label="数据依据" value={viral.basis === 'sample' ? '真实样本' : '规则推演'} small />
            </div>

            <div className="mb-4">
              <ScoreBar
                value={viral.score}
                color={
                  viral.score >= 70
                    ? 'rgb(var(--c-grade-a))'
                    : viral.score >= 50
                      ? 'rgb(var(--c-grade-b))'
                      : 'rgb(var(--c-grade-c))'
                }
              />
            </div>

            <div className="mb-4 grid gap-2 sm:grid-cols-2">
              <InfoRow k="建议发布时段" v={viral.bestSlot} />
              <InfoRow k="建议首图" v={viral.coverType} />
            </div>

            <h4 className="mb-2 text-xs font-semibold">加减分明细</h4>
            <div className="space-y-1">
              {viral.breakdown.map((b, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-elevated/50 px-2.5 py-1.5">
                  <span
                    className={`w-11 shrink-0 text-right font-mono text-xs font-bold ${
                      b.delta > 0 ? 'text-grade-a' : b.delta < 0 ? 'text-grade-d' : 'text-muted'
                    }`}
                  >
                    {b.delta > 0 ? '+' : ''}
                    {b.delta}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium">{b.factor}</div>
                    <div className="text-[11px] leading-relaxed text-muted">{b.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {tab === 'risk' && (
          <Section
            title="发布前风险扫描"
            desc="预警而非审查：命中项代表需要人工确认，不代表内容违规"
            right={
              <button className="btn-ghost text-xs" disabled={!ai.apiKey || busy === 'risk'} onClick={doAIRisk}>
                {busy === 'risk' ? '复核中…' : 'AI 语义复核'}
              </button>
            }
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-muted">规则引擎结论</span>
              <RiskBadge level={risk.overall} label={RISK_LEVEL_LABEL[risk.overall]} />
              {risk.needsReview && <span className="text-[11px] text-grade-c">建议人工复核后再发</span>}
            </div>

            {risk.flags.length === 0 ? (
              <p className="rounded-xl border border-grade-a/30 bg-grade-a/8 px-3 py-2.5 text-xs text-grade-a">
                未命中预设雷区。仍建议核对引用数据与原文一致性。
              </p>
            ) : (
              <div className="space-y-2">
                {risk.flags.map((f, i) => (
                  <div key={i} className="rounded-xl border border-line bg-elevated/50 p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <RiskBadge level={f.level} label={f.category} />
                      <span className="font-mono text-[11px] text-muted">{f.hits.join('、')}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted">{f.advice}</p>
                  </div>
                ))}
              </div>
            )}

            {aiRisk && (
              <div className="mt-4 border-t border-line pt-3">
                <h4 className="mb-2 text-xs font-semibold">AI 语义复核结果</h4>
                {(aiRisk.issues ?? []).map((it: any, i: number) => (
                  <div key={i} className="mb-1.5 rounded-lg bg-elevated/50 px-2.5 py-1.5 text-[11px]">
                    <span className="font-medium text-grade-c">{it.category}</span>
                    <span className="mx-1 text-muted">·</span>
                    <span className="text-muted">{it.hit}</span>
                    <div className="mt-0.5 text-ink/80">建议：{it.suggestion}</div>
                  </div>
                ))}
                {(aiRisk.safeTitles ?? []).length > 0 && (
                  <>
                    <h4 className="mb-1 mt-3 text-xs font-semibold">改写后的安全标题</h4>
                    {aiRisk.safeTitles.map((t: string, i: number) => (
                      <div key={i} className="rounded-lg bg-grade-a/8 px-2.5 py-1.5 text-[11px] text-ink/90">
                        {t}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </Section>
        )}

        {tab === 'compose' && (
          <Section
            title="内容生产辅助"
            desc="AI 生成可直接开写的大纲、开头段与事实核查清单"
            right={
              busy === 'outline' ? (
                <button className="btn-ghost text-xs" onClick={() => abortRef.current?.abort()}>
                  停止生成
                </button>
              ) : null
            }
          >
            {!ai.apiKey && (
              <p className="rounded-xl border border-grade-c/35 bg-grade-c/8 px-3 py-2.5 text-xs text-grade-c">
                需要先配置 AI。点击右上角「AI 设置」，填入任意 OpenAI 协议服务的 Key 即可（DeepSeek / 通义 / Kimi / 智谱等）。
              </p>
            )}
            {ai.apiKey && !outline && busy !== 'outline' && (
              <p className="text-xs text-muted">
                到「选题角度」页选择一个角度，点击「生成大纲 →」即可在此处产出成稿框架。
              </p>
            )}
            {(outline || busy === 'outline') && (
              <div className="prose-sm whitespace-pre-wrap break-words rounded-xl border border-line bg-elevated/50 p-4 text-xs leading-relaxed">
                {outline}
                {busy === 'outline' && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-brand" />}
              </div>
            )}
            {outline && (
              <button
                className="btn-ghost mt-3 text-xs"
                onClick={() => navigator.clipboard.writeText(outline)}
              >
                复制全文
              </button>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

function num(v: unknown, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : fallback
}

function Meta({ k, v, mono, highlight }: { k: string; v?: string; mono?: boolean; highlight?: boolean }) {
  if (!v) return null
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-muted">{k}</span>
      <span className={`min-w-0 truncate ${mono ? 'font-mono' : ''} ${highlight ? 'font-semibold text-grade-c' : ''}`} title={v}>
        {v}
      </span>
    </div>
  )
}

function Stat({ label, value, accent, small }: { label: string; value: string; accent?: boolean; small?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-elevated/50 px-3 py-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`mt-0.5 font-semibold ${small ? 'text-[11px] leading-tight' : 'text-lg'} ${accent ? 'text-brand' : ''}`}>
        {value}
      </div>
    </div>
  )
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-line bg-elevated/50 px-3 py-2">
      <div className="text-[10px] text-muted">{k}</div>
      <div className="mt-0.5 text-[11px] leading-relaxed">{v}</div>
    </div>
  )
}
