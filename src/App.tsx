import { useEffect, useMemo, useState } from 'react'
import type { Grade, IntelItem, ItemKind, SourceTier } from './types'
import { evaluateAll, gradeOf } from './engines/credibility'
import { useStore, type ThemeMode } from './store'
import { AI_PRESETS } from './ai/client'
import DetailPanel from './components/DetailPanel'
import ContentLibrary from './components/ContentLibrary'
import WechatCollect from './components/WechatCollect'
import WechatSearch from './components/WechatSearch'
import { Empty, GRADE_STYLE, TierBadge } from './components/ui'

/* ============================ 常量 ============================ */

const KIND_OPTIONS: { value: ItemKind; label: string }[] = [
  { value: 'tbt-notification', label: 'WTO/TBT 通报' },
  { value: 'national-standard', label: '国家标准' },
  { value: 'industry-standard', label: '行业标准' },
  { value: 'local-standard', label: '地方标准' },
  { value: 'group-standard', label: '团体标准' },
  { value: 'inspection-notice', label: '监管抽检公告' },
  { value: 'regulation', label: '法规/规章' },
  { value: 'news', label: '媒体新闻' },
  { value: 'other', label: '其他' },
]

const STATE_OPTIONS = ['现行', '即将实施', '废止', '被代替', '未知'] as const

const GITHUB_URL = 'https://github.com' // 占位，部署后由 README 说明替换为真实仓库

const TIERS: SourceTier[] = ['A', 'B', 'C']
const GRADES: Grade[] = ['A', 'B', 'C', 'D']

/* ============================ 工具 ============================ */

function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

function makeManualId(): string {
  return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/* ============================ App ============================ */

export default function App() {
  const {
    dataset,
    loading,
    loadError,
    manualItems,
    sampleCalibrated,
    theme,
    selectedId,
    filters,
    starred,
    ai,
    brandWatchlist,
    init,
    setTheme,
    select,
    patchFilters,
    toggleStar,
  } = useStore()

  const [modal, setModal] = useState<null | 'ai' | 'brands' | 'import'>(null)
  const [view, setView] = useState<'intel' | 'library' | 'wechat' | 'search'>('intel')

  // 首屏数据 + 主题同步
  useEffect(() => {
    init()
  }, [init])
  useEffect(() => {
    setTheme(useStore.getState().theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allItems = useMemo<IntelItem[]>(
    () => [...(dataset?.items ?? []), ...manualItems],
    [dataset, manualItems],
  )

  // 全量预计算可信度，用于列表评级与排序
  const credMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof gradeOf>>()
    const totalMap = new Map<string, number>()
    for (const { item, credibility } of evaluateAll(allItems)) {
      m.set(item.id, credibility.grade)
      totalMap.set(item.id, credibility.total)
    }
    return { grade: m, total: totalMap }
  }, [allItems])

  // 筛选 + 排序
  const visible = useMemo(() => {
    const kw = filters.keyword.trim().toLowerCase()
    const list = allItems.filter((it) => {
      if (!filters.tiers.includes(it.tier)) return false
      const g = credMap.grade.get(it.id) ?? 'D'
      if (!filters.grades.includes(g)) return false
      if (filters.onlyAdmitted && g === 'D') return false
      if (filters.onlyUpcoming && it.state !== '即将实施') return false
      if (kw) {
        const hay = `${it.title} ${it.stdCode ?? ''} ${it.summary ?? ''} ${it.administration ?? ''}`.toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
    // 收藏优先 → 评级高 → 总分高
    const starSet = new Set(starred)
    return list.sort((a, b) => {
      const sa = starSet.has(a.id) ? 1 : 0
      const sb = starSet.has(b.id) ? 1 : 0
      if (sa !== sb) return sb - sa
      const ta = credMap.total.get(a.id) ?? 0
      const tb = credMap.total.get(b.id) ?? 0
      if (ta !== tb) return tb - ta
      return a.title.localeCompare(b.title, 'zh')
    })
  }, [allItems, filters, credMap, starred])

  const selected = useMemo(
    () => allItems.find((i) => i.id === selectedId) ?? null,
    [allItems, selectedId],
  )

  const stats = useMemo(() => {
    const total = allItems.length
    const aTier = allItems.filter((i) => i.tier === 'A').length
    const admitted = allItems.filter((i) => (credMap.grade.get(i.id) ?? 'D') !== 'D').length
    const upcoming = allItems.filter((i) => i.state === '即将实施').length
    return { total, aTier, admitted, upcoming }
  }, [allItems, credMap])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ============ 顶栏 ============ */}
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-line bg-glass px-4 py-2.5 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand/70 text-base font-black text-white shadow-[0_6px_18px_-6px_rgb(var(--c-brand))]">
            质
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">
              质标雷达 <span className="text-muted font-normal">· 选题中央处理器</span>
            </div>
            <div className="text-[10px] text-muted">
              {sampleCalibrated ? '爆款样本已校准' : '规则引擎模式'} · {stats.total} 条情报
            </div>
          </div>
        </div>

        <nav className="ml-1 flex items-center rounded-xl border border-line bg-elevated/50 p-0.5 text-[11px]">
          <button
            onClick={() => setView('intel')}
            className={`rounded-lg px-2.5 py-1 font-medium transition-all ${view === 'intel' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
          >
            情报研判
          </button>
          <button
            onClick={() => setView('library')}
            className={`rounded-lg px-2.5 py-1 font-medium transition-all ${view === 'library' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
          >
            内容资产库
          </button>
          <button
            onClick={() => setView('wechat')}
            className={`rounded-lg px-2.5 py-1 font-medium transition-all ${view === 'wechat' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
          >
            标准科普采集
          </button>
          <button
            onClick={() => setView('search')}
            className={`rounded-lg px-2.5 py-1 font-medium transition-all ${view === 'search' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
          >
            公众号检索
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle theme={theme} onChange={setTheme} />

          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setModal('import')}>
            + 手动补录
          </button>
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setModal('brands')}>
            品牌监控
            {brandWatchlist.length > 0 && (
              <span className="ml-1 rounded bg-brand/15 px-1 font-mono text-[10px] text-brand">
                {brandWatchlist.length}
              </span>
            )}
          </button>
          <button
            className={`btn-ghost !px-3 !py-1.5 text-xs ${ai.apiKey ? 'border-brand/40 text-brand' : ''}`}
            onClick={() => setModal('ai')}
          >
            AI 设置{ai.apiKey ? ' ✓' : ''}
          </button>
          <a
            className="btn-ghost !px-3 !py-1.5 text-xs"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            GitHub
          </a>
        </div>
      </header>

      {/* ============ 主体 ============ */}
      {view === 'wechat' ? (
        <WechatCollect />
      ) : view === 'search' ? (
        <WechatSearch />
      ) : view === 'library' ? (
        <ContentLibrary />
      ) : (
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,380px)_1fr]">
        {/* 左侧列表 */}
        <aside className="flex min-h-0 flex-col border-r border-line">
          {/* 统计条 */}
          <div className="grid shrink-0 grid-cols-4 gap-2 px-3 py-3 text-center">
            <StatPill label="情报总量" value={stats.total} />
            <StatPill label="A 级信源" value={stats.aTier} accent />
            <StatPill label="可进选题池" value={stats.admitted} good />
            <StatPill label="即将实施" value={stats.upcoming} warn />
          </div>

          {/* 搜索 + 筛选 */}
          <div className="shrink-0 space-y-2.5 px-3 pb-3">
            <input
              className="field"
              placeholder="搜索标题 / 标准号 / 归口部门…"
              value={filters.keyword}
              onChange={(e) => patchFilters({ keyword: e.target.value })}
            />

            <FilterRow label="信源">
              {TIERS.map((t) => (
                <ChipBtn
                  key={t}
                  active={filters.tiers.includes(t)}
                  onClick={() => patchFilters({ tiers: toggleIn(filters.tiers, t) })}
                >
                  {t} 级
                </ChipBtn>
              ))}
            </FilterRow>

            <FilterRow label="评级">
              {GRADES.map((g) => (
                <ChipBtn
                  key={g}
                  active={filters.grades.includes(g)}
                  onClick={() => patchFilters({ grades: toggleIn(filters.grades, g) })}
                >
                  {g} 级
                </ChipBtn>
              ))}
            </FilterRow>

            <div className="flex gap-2">
              <ChipBtn active={filters.onlyAdmitted} onClick={() => patchFilters({ onlyAdmitted: !filters.onlyAdmitted })}>
                仅看可进池
              </ChipBtn>
              <ChipBtn active={filters.onlyUpcoming} onClick={() => patchFilters({ onlyUpcoming: !filters.onlyUpcoming })}>
                仅看即将实施
              </ChipBtn>
            </div>
          </div>

          {/* 列表 */}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
            {loading && <div className="skeleton h-16 w-full" />}
            {loadError && (
              <div className="rounded-xl border border-grade-d/40 bg-grade-d/10 px-3 py-3 text-xs text-grade-d">
                数据加载失败：{loadError}
              </div>
            )}
            {!loading && !loadError && visible.length === 0 && (
              <Empty icon="🔍" title="没有匹配的情报" desc="试试放宽筛选条件，或点击右上角「手动补录」添加 TBT 通报。" />
            )}
            {visible.map((it) => {
              const g = credMap.grade.get(it.id) ?? 'D'
              const total = credMap.total.get(it.id) ?? 0
              const isStar = starred.includes(it.id)
              const active = selectedId === it.id
              return (
                <button
                  key={it.id}
                  onClick={() => select(it.id)}
                  className={`card card-hover w-full p-3 text-left transition-all ${
                    active ? 'border-brand/60 ring-1 ring-brand/30' : ''
                  }`}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <TierBadge tier={it.tier} short />
                    <span className={`chip ${GRADE_STYLE[g]}`}>{g} · {total}</span>
                    {it.state === '即将实施' && <span className="chip border-grade-c/50 text-grade-c">即将实施</span>}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleStar(it.id)
                      }}
                      className={`ml-auto cursor-pointer text-sm ${isStar ? 'text-grade-c' : 'text-muted'}`}
                      title={isStar ? '取消收藏' : '收藏'}
                    >
                      {isStar ? '★' : '☆'}
                    </span>
                  </div>
                  <div className="line-clamp-2 text-xs font-medium leading-snug">{it.title}</div>
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted">
                    {it.stdCode && <span className="font-mono">{it.stdCode}</span>}
                    <span className="truncate">{it.sourceName}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        {/* 右侧工作台 */}
        <section className="min-h-0 overflow-hidden p-4">
          {selected ? (
            <DetailPanel item={selected} pool={allItems} />
          ) : (
            <Empty
              icon="🛰️"
              title="选择一条情报开始研判"
              desc="左侧点击任意条目，右侧将展示五维可信度雷达、多视角选题方案、爆款潜力与发布前风险扫描。"
            />
          )}
        </section>
      </main>
      )}

      {/* ============ 弹窗 ============ */}
      {modal === 'ai' && <AISettingsModal onClose={() => setModal(null)} />}
      {modal === 'brands' && <BrandWatchModal onClose={() => setModal(null)} />}
      {modal === 'import' && <ManualImportModal onClose={() => setModal(null)} />}
    </div>
  )
}

/* ============================ 小组件 ============================ */

function StatPill({ label, value, accent, good, warn }: { label: string; value: number; accent?: boolean; good?: boolean; warn?: boolean }) {
  const color = good ? 'text-grade-a' : warn ? 'text-grade-c' : accent ? 'text-brand' : 'text-ink'
  return (
    <div className="rounded-xl border border-line bg-elevated/50 px-1 py-2">
      <div className={`font-mono text-lg font-bold leading-none ${color}`}>{value}</div>
      <div className="mt-1 text-[10px] text-muted">{label}</div>
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function ChipBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
        active
          ? 'border-brand/50 bg-brand/12 text-brand'
          : 'border-line bg-elevated/50 text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function ThemeToggle({ theme, onChange }: { theme: ThemeMode; onChange: (t: ThemeMode) => void }) {
  const opts: ThemeMode[] = ['light', 'dark', 'system']
  const label: Record<ThemeMode, string> = { light: '浅色', dark: '深色', system: '跟随系统' }
  return (
    <div className="flex items-center rounded-xl border border-line bg-elevated/50 p-0.5 text-[11px]">
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-lg px-2 py-1 font-medium transition-all ${
            theme === o ? 'bg-brand text-white' : 'text-muted hover:text-ink'
          }`}
        >
          {label[o]}
        </button>
      ))}
    </div>
  )
}

/* ============================ AI 设置弹窗 ============================ */

function AISettingsModal({ onClose }: { onClose: () => void }) {
  const { ai, setAI } = useStore()
  const [draft, setDraft] = useState(ai)

  const save = () => {
    setAI({ ...draft, enabled: !!draft.apiKey })
    onClose()
  }

  return (
    <Modal title="AI 设置" desc="密钥仅保存在你本机浏览器，直连模型厂商，不经过任何中间服务器。" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] text-muted">服务商预设</label>
          <div className="flex flex-wrap gap-1.5">
            {AI_PRESETS.map((p) => (
              <button
                key={p.label}
                className="rounded-lg border border-line bg-elevated/50 px-2.5 py-1 text-[11px] hover:border-brand/40"
                onClick={() => setDraft((d) => ({ ...d, baseUrl: p.baseUrl, model: p.model }))}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="API 地址 (baseUrl)">
          <input
            className="field"
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com/v1"
          />
        </Field>

        <Field label="模型名称">
          <input
            className="field"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="deepseek-chat"
          />
        </Field>

        <Field label="API Key">
          <input
            className="field"
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </Field>

        <Field label={`温度（创意度）：${draft.temperature.toFixed(2)}`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.temperature}
            onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
            className="w-full accent-[rgb(var(--c-brand))]"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary !py-1.5 text-xs" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ============================ 品牌监控弹窗 ============================ */

function BrandWatchModal({ onClose }: { onClose: () => void }) {
  const { brandWatchlist, setBrands } = useStore()
  const [text, setText] = useState(brandWatchlist.join('\n'))

  const save = () => {
    const arr = text
      .split(/[\n,，、]/)
      .map((s) => s.trim())
      .filter(Boolean)
    setBrands([...new Set(arr)])
    onClose()
  }

  return (
    <Modal
      title="品牌监控词"
      desc="命中这些词的情报会在风险扫描中被标记「敏感品牌」，提醒人工确认是否涉及商业纠纷。"
      onClose={onClose}
    >
      <textarea
        className="field h-40 resize-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="每行一个品牌名，或用逗号 / 顿号分隔&#10;例如：&#10;某某奶粉&#10;某某电器"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
          取消
        </button>
        <button className="btn-primary !py-1.5 text-xs" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  )
}

/* ============================ 手动补录弹窗 ============================ */

function ManualImportModal({ onClose }: { onClose: () => void }) {
  const { addManualItem } = useStore()
  const [f, setF] = useState({
    title: '',
    url: '',
    sourceName: 'WTO/TBT 通报（手动补录）',
    tier: 'A' as SourceTier,
    kind: 'tbt-notification' as ItemKind,
    stdCode: '',
    publishDate: '',
    effectiveDate: '',
    state: '即将实施' as IntelItem['state'],
    nature: '',
    administration: '',
    summary: '',
    keywords: '',
  })

  const fillTBT = () =>
    setF((d) => ({
      ...d,
      kind: 'tbt-notification',
      tier: 'A',
      sourceName: 'WTO/TBT 通报（手动补录）',
      state: '即将实施',
    }))

  const submit = () => {
    if (!f.title.trim()) return
    const item: IntelItem = {
      id: makeManualId(),
      sourceId: 'manual',
      sourceName: f.sourceName.trim() || '手动补录',
      tier: f.tier,
      kind: f.kind,
      title: f.title.trim(),
      url: f.url.trim(),
      summary: f.summary.trim() || undefined,
      stdCode: f.stdCode.trim() || undefined,
      publishDate: f.publishDate || undefined,
      effectiveDate: f.effectiveDate || undefined,
      state: f.state,
      nature: f.nature.trim() || undefined,
      administration: f.administration.trim() || undefined,
      keywords: f.keywords.trim() ? f.keywords.split(/[\s,，、]/).filter(Boolean) : undefined,
      fetchedAt: new Date().toISOString(),
    }
    addManualItem(item)
    onClose()
  }

  return (
    <Modal
      title="手动补录情报"
      desc="用于补录爬虫暂未覆盖的信源（如 TBT 通报、线下会议通稿）。补录条目仅存在于本机本次会话。"
      onClose={onClose}
    >
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div className="flex gap-2">
          <button className="btn-ghost !py-1 text-[11px]" onClick={fillTBT}>
            一键填 TBT 通报模板
          </button>
        </div>

        <Field label="标题 *">
          <input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="信源分级">
            <select
              className="field"
              value={f.tier}
              onChange={(e) => setF({ ...f, tier: e.target.value as SourceTier })}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t} 级
                </option>
              ))}
            </select>
          </Field>
          <Field label="条目类型">
            <select
              className="field"
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as ItemKind })}
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="标准号 / 通报号">
            <input className="field" value={f.stdCode} onChange={(e) => setF({ ...f, stdCode: e.target.value })} />
          </Field>
          <Field label="状态">
            <select
              className="field"
              value={f.state}
              onChange={(e) => setF({ ...f, state: e.target.value as IntelItem['state'] })}
            >
              {STATE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="发布日期">
            <input className="field" type="date" value={f.publishDate} onChange={(e) => setF({ ...f, publishDate: e.target.value })} />
          </Field>
          <Field label="实施日期">
            <input className="field" type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />
          </Field>
        </div>

        <Field label="归口 / 发布部门">
          <input className="field" value={f.administration} onChange={(e) => setF({ ...f, administration: e.target.value })} />
        </Field>

        <Field label="原文链接">
          <input className="field" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://..." />
        </Field>

        <Field label="摘要 / 要点">
          <textarea className="field h-20 resize-none" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        </Field>

        <Field label="关键词（空格/逗号分隔）">
          <input className="field" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary !py-1.5 text-xs disabled:opacity-40" disabled={!f.title.trim()} onClick={submit}>
            加入选题池
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ============================ 通用 Modal ============================ */

function Modal({
  title,
  desc,
  children,
  onClose,
}: {
  title: string
  desc?: string
  children: React.ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg animate-fade-up p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold tracking-tight">{title}</h3>
            {desc && <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">{desc}</p>}
          </div>
          <button className="btn-ghost !px-2 !py-1 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-muted">{label}</label>
      {children}
    </div>
  )
}
