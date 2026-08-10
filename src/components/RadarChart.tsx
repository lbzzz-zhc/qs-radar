import { useMemo } from 'react'
import type { CredibilityScores, Grade } from '../types'
import { DIMENSION_LABELS } from '../engines/credibility'

const DIMS: (keyof CredibilityScores)[] = [
  'authority',
  'freshness',
  'corroboration',
  'quantification',
  'relevance',
]

const GRADE_COLOR: Record<Grade, string> = {
  A: 'rgb(var(--c-grade-a))',
  B: 'rgb(var(--c-grade-b))',
  C: 'rgb(var(--c-grade-c))',
  D: 'rgb(var(--c-grade-d))',
}

interface Props {
  scores: CredibilityScores
  grade: Grade
  size?: number
  /** 紧凑模式：隐藏轴标签，用于列表卡片 */
  compact?: boolean
}

export default function RadarChart({ scores, grade, size = 260, compact = false }: Props) {
  const pad = compact ? 12 : 52
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - pad
  const color = GRADE_COLOR[grade]

  const pts = useMemo(() => {
    return DIMS.map((d, i) => {
      const ang = (Math.PI * 2 * i) / DIMS.length - Math.PI / 2
      const r = (Math.max(0, Math.min(5, scores[d])) / 5) * R
      return {
        dim: d,
        x: cx + Math.cos(ang) * r,
        y: cy + Math.sin(ang) * r,
        ax: cx + Math.cos(ang) * R,
        ay: cy + Math.sin(ang) * R,
        lx: cx + Math.cos(ang) * (R + (compact ? 8 : 26)),
        ly: cy + Math.sin(ang) * (R + (compact ? 8 : 26)),
        value: scores[d],
      }
    })
  }, [scores, R, cx, cy, compact])

  const polygon = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const rings = [1, 0.75, 0.5, 0.25]
  const uid = useMemo(() => `rg-${Math.random().toString(36).slice(2, 8)}`, [])

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`可信度雷达图，综合评级 ${grade}`}
    >
      <defs>
        <radialGradient id={uid} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.42" />
          <stop offset="100%" stopColor={color} stopOpacity="0.12" />
        </radialGradient>
      </defs>

      {/* 参考网格 */}
      {rings.map((k) => (
        <polygon
          key={k}
          points={DIMS.map((_, i) => {
            const ang = (Math.PI * 2 * i) / DIMS.length - Math.PI / 2
            return `${(cx + Math.cos(ang) * R * k).toFixed(1)},${(cy + Math.sin(ang) * R * k).toFixed(1)}`
          }).join(' ')}
          fill="none"
          stroke="rgb(var(--c-line))"
          strokeWidth={k === 1 ? 1.2 : 0.7}
          opacity={k === 1 ? 0.9 : 0.5}
        />
      ))}

      {/* 轴线 */}
      {pts.map((p) => (
        <line
          key={p.dim}
          x1={cx}
          y1={cy}
          x2={p.ax}
          y2={p.ay}
          stroke="rgb(var(--c-line))"
          strokeWidth="0.7"
          opacity="0.65"
        />
      ))}

      {/* 数据区 */}
      <polygon
        points={polygon}
        fill={`url(#${uid})`}
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        style={{ transition: 'all .5s cubic-bezier(.16,1,.3,1)' }}
      />

      {pts.map((p) => (
        <circle key={p.dim} cx={p.x} cy={p.y} r={compact ? 2.4 : 3.6} fill={color} />
      ))}

      {/* 轴标签 */}
      {!compact &&
        pts.map((p) => {
          const anchor = p.lx > cx + 6 ? 'start' : p.lx < cx - 6 ? 'end' : 'middle'
          return (
            <g key={p.dim}>
              <text
                x={p.lx}
                y={p.ly - 4}
                textAnchor={anchor}
                fontSize="11.5"
                fill="rgb(var(--c-muted))"
              >
                {DIMENSION_LABELS[p.dim]}
              </text>
              <text
                x={p.lx}
                y={p.ly + 10}
                textAnchor={anchor}
                fontSize="12.5"
                fontWeight="700"
                fill={color}
              >
                {p.value.toFixed(1)}
              </text>
            </g>
          )
        })}
    </svg>
  )
}
