import { create } from 'zustand'
import type { AIConfig, DataSet, Grade, IntelItem, SourceTier, ViralSample } from './types'
import { calibrate } from './engines/viral'

export type ThemeMode = 'light' | 'dark' | 'system'

const LS = {
  theme: 'qsr-theme',
  ai: 'qsr-ai-config',
  brands: 'qsr-brand-watchlist',
  starred: 'qsr-starred',
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

const DEFAULT_AI: AIConfig = {
  // 默认指向 DeepSeek，兼容任何 OpenAI 协议服务
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.75,
  enabled: false,
}

export interface Filters {
  keyword: string
  tiers: SourceTier[]
  grades: Grade[]
  onlyAdmitted: boolean
  onlyUpcoming: boolean
  sourceIds: string[]
}

interface State {
  // 数据
  dataset: DataSet | null
  loading: boolean
  loadError: string | null
  manualItems: IntelItem[]
  samples: ViralSample[]
  sampleCalibrated: boolean

  // UI
  theme: ThemeMode
  selectedId: string | null
  filters: Filters
  starred: string[]

  // 配置
  ai: AIConfig
  brandWatchlist: string[]

  // actions
  init: () => Promise<void>
  setTheme: (t: ThemeMode) => void
  select: (id: string | null) => void
  patchFilters: (f: Partial<Filters>) => void
  setAI: (c: Partial<AIConfig>) => void
  setBrands: (b: string[]) => void
  toggleStar: (id: string) => void
  addManualItem: (i: IntelItem) => void
  loadSamples: (s: ViralSample[]) => void
}

const BASE = import.meta.env.BASE_URL || '/'

export const useStore = create<State>((set, get) => ({
  dataset: null,
  loading: true,
  loadError: null,
  manualItems: [],
  samples: [],
  sampleCalibrated: false,

  theme: (localStorage.getItem(LS.theme) as ThemeMode) || 'system',
  selectedId: null,
  filters: {
    keyword: '',
    tiers: ['A', 'B', 'C'],
    grades: ['A', 'B', 'C', 'D'],
    onlyAdmitted: true,
    onlyUpcoming: false,
    sourceIds: [],
  },
  starred: JSON.parse(localStorage.getItem(LS.starred) || '[]'),

  ai: loadJSON<AIConfig>(LS.ai, DEFAULT_AI),
  brandWatchlist: JSON.parse(localStorage.getItem(LS.brands) || '[]'),

  async init() {
    set({ loading: true, loadError: null })
    try {
      const res = await fetch(`${BASE}data/dataset.json`, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`数据集加载失败 HTTP ${res.status}`)
      const dataset: DataSet = await res.json()
      set({ dataset, loading: false })
    } catch (e) {
      set({ loadError: (e as Error).message, loading: false })
    }

    // 爆款样本为可选文件，缺失时静默降级到规则引擎
    try {
      const r = await fetch(`${BASE}data/viral-samples.json`, { cache: 'no-cache' })
      if (r.ok) {
        const json = await r.json()
        const samples: ViralSample[] = Array.isArray(json) ? json : json.samples || []
        if (samples.length >= 20) {
          calibrate(samples)
          set({ samples, sampleCalibrated: true })
        } else {
          set({ samples })
        }
      }
    } catch {
      /* 无样本文件，保持规则引擎模式 */
    }
  },

  setTheme(t) {
    localStorage.setItem(LS.theme, t)
    const isDark =
      t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', isDark)
    set({ theme: t })
  },

  select: (id) => set({ selectedId: id }),
  patchFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),

  setAI(c) {
    const next = { ...get().ai, ...c }
    localStorage.setItem(LS.ai, JSON.stringify(next))
    set({ ai: next })
  },

  setBrands(b) {
    localStorage.setItem(LS.brands, JSON.stringify(b))
    set({ brandWatchlist: b })
  },

  toggleStar(id) {
    const cur = get().starred
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    localStorage.setItem(LS.starred, JSON.stringify(next))
    set({ starred: next })
  },

  addManualItem(i) {
    set((s) => ({ manualItems: [i, ...s.manualItems], selectedId: i.id }))
  },

  loadSamples(s) {
    if (s.length >= 20) {
      calibrate(s)
      set({ samples: s, sampleCalibrated: true })
    } else {
      set({ samples: s, sampleCalibrated: false })
    }
  },
}))
