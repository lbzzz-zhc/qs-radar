import type { ReactNode } from 'react'
import type { Grade, RiskLevel, SourceTier } from '../types'

export const GRADE_STYLE: Record<Grade, string> = {
  A: 'text-grade-a border-grade-a/40 bg-grade-a/10',
  B: 'text-grade-b border-grade-b/40 bg-grade-b/10',
  C: 'text-grade-c border-grade-c/40 bg-grade-c/10',
  D: 'text-grade-d border-grade-d/40 bg-grade-d/10',
}

export function GradeBadge({ grade, total }: { grade: Grade; total?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold ${GRADE_STYLE[grade]}`}
      title={`综合可信度评级 ${grade}${total != null ? ` · ${total} 分` : ''}`}
    >
      {grade}
      {total != null && <span className="font-mono text-[10px] opacity-75">{total}</span>}
    </span>
  )
}

const TIER_STYLE: Record<SourceTier, string> = {
  A: 'border-grade-a/40 text-grade-a bg-grade-a/10',
  B: 'border-grade-b/40 text-grade-b bg-grade-b/10',
  C: 'border-grade-c/40 text-grade-c bg-grade-c/10',
}
const TIER_TEXT: Record<SourceTier, string> = {
  A: 'A 级 · 强制采信',
  B: 'B 级 · 重要参考',
  C: 'C 级 · 线索参考',
}

export function TierBadge({ tier, short }: { tier: SourceTier; short?: boolean }) {
  return (
    <span className={`chip ${TIER_STYLE[tier]}`} title={TIER_TEXT[tier]}>
      {short ? tier : TIER_TEXT[tier]}
    </span>
  )
}

const RISK_STYLE: Record<RiskLevel, string> = {
  none: 'border-grade-a/40 text-grade-a bg-grade-a/10',
  low: 'border-grade-b/40 text-grade-b bg-grade-b/10',
  medium: 'border-grade-c/40 text-grade-c bg-grade-c/10',
  high: 'border-grade-d/40 text-grade-d bg-grade-d/10',
}

export function RiskBadge({ level, label }: { level: RiskLevel; label: string }) {
  return <span className={`chip ${RISK_STYLE[level]}`}>{label}</span>
}

export function Section({
  title,
  desc,
  right,
  children,
}: {
  title: string
  desc?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card animate-fade-up p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

export function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
      <div
        className="h-full rounded-full transition-all duration-700 ease-premium"
        style={{ width: `${pct}%`, background: color || 'rgb(var(--c-brand))' }}
      />
    </div>
  )
}

export function Empty({ icon, title, desc }: { icon: string; title: string; desc?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-3xl opacity-40">{icon}</div>
      <p className="text-sm font-medium text-ink/80">{title}</p>
      {desc && <p className="max-w-sm text-xs leading-relaxed text-muted">{desc}</p>}
    </div>
  )
}
