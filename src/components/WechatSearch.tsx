import { useEffect, useRef, useState } from 'react'
import type { WechatArticle } from '../types'
import { addWechatArticle, fetchWechatDB, saveWechatDB } from '../lib/wechatCollect'
import { Empty } from './ui'

const TOKEN_KEY = 'qsr-gh-token'
const RECENT_KEY = 'qsr-wx-recent'
const CAPTURED_KEY = 'qsr-wx-captured'

const TAGS = ['标准科普系列', '国标解读', '抽检科普', '消费提示']
const TOPICS = ['质量', '标准化', '认证', '抽检', '召回', '国标', '计量', '质检', '食品安全', '消费提示']

/* ============================ 主组件 ============================ */

export default function WechatSearch() {
  const [mode, setMode] = useState<'article' | 'account'>('article')
  const [keyword, setKeyword] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [captured, setCaptured] = useState<WechatArticle[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const tokenRef = useRef<string>(localStorage.getItem(TOKEN_KEY) || '')
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'))
      setCaptured(JSON.parse(localStorage.getItem(CAPTURED_KEY) || '[]'))
    } catch {
      /* ignore */
    }
  }, [])

  const buildUrl = (q: string) =>
    `https://weixin.sogou.com/weixin?type=${mode === 'article' ? 2 : 1}&query=${encodeURIComponent(q)}&ie=utf8`

  function flash(msg: string) {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }

  function doSearch(q: string) {
    const kw = (q ?? keyword).trim()
    if (!kw) return
    window.open(buildUrl(kw), '_blank', 'noopener,noreferrer')
    setRecent((r) => {
      const next = [kw, ...r.filter((x) => x !== kw)].slice(0, 8)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }

  async function saveCapture(p: Omit<WechatArticle, 'id' | 'fetchedAt'>) {
    // 写回 GitHub（若配置了 Token），与「标准科普采集」共用同一数据源
    const token = tokenRef.current
    if (token) {
      try {
        const db = await fetchWechatDB().catch(() => ({ version: '1', items: [] as WechatArticle[], updatedAt: new Date().toISOString() }))
        const next = addWechatArticle(db, p)
        await saveWechatDB(next, token)
        flash('已收录并同步到采集库 ✓（去「标准科普采集」查看）')
      } catch (e) {
        flash(`同步失败：${(e as Error).message}（已存本机）`)
      }
    } else {
      flash('已收录到本机（配置 GitHub Token 后可同步到采集库）')
    }
    // 本机留存，面板内可见
    const full: WechatArticle = { ...p, id: `wx-${Date.now().toString(36)}`, fetchedAt: new Date().toISOString() }
    setCaptured((c) => {
      const next = [full, ...c].slice(0, 50)
      localStorage.setItem(CAPTURED_KEY, JSON.stringify(next))
      return next
    })
    setModal(false)
  }

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ===== 左侧：检索 + 收录 ===== */}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
        {/* 检索卡 */}
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">公众号检索</div>
            <span className="chip border-line bg-elevated/50 text-muted">搜狗微信</span>
          </div>

          <div className="flex rounded-xl border border-line bg-elevated/50 p-0.5 text-[11px]">
            <button
              onClick={() => setMode('article')}
              className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition-all ${mode === 'article' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
            >
              搜文章
            </button>
            <button
              onClick={() => setMode('account')}
              className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition-all ${mode === 'account' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
            >
              搜公众号
            </button>
          </div>

          <div className="flex gap-2">
            <input
              className="field flex-1"
              placeholder={mode === 'article' ? '输入关键词，如：食品安全标准' : '输入公众号名称，如：中国标准化'}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch(keyword)}
            />
            <button className="btn-primary !px-4 !py-1.5 text-xs whitespace-nowrap" onClick={() => doSearch(keyword)}>
              搜索
            </button>
          </div>

          <div className="text-[11px] leading-relaxed text-muted">
            公众号无公开检索 API，站内通过<span className="text-ink">搜狗微信</span>检索（结果在新标签打开，你的浏览器会话可正常查看）。
            搜到的文章可一键<span className="text-brand">收录到采集库</span>，沉淀进「标准科普采集」统一研判。
          </div>

          {/* 热门主题 */}
          <div>
            <div className="mb-1.5 text-[11px] text-muted">热门主题</div>
            <div className="flex flex-wrap gap-1.5">
              {TOPICS.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setKeyword(t)
                    doSearch(t)
                  }}
                  className="rounded-full border border-line bg-elevated/50 px-3 py-1 text-[11px] transition-all hover:border-brand/40 hover:text-brand"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* 最近搜索 */}
          {recent.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] text-muted">最近搜索</div>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setKeyword(t)
                      doSearch(t)
                    }}
                    className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] text-brand transition-all hover:bg-brand/20"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 收录按钮 */}
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">收录到采集库</div>
          <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => setModal(true)}>
            + 收录此文
          </button>
        </div>

        {captured.length === 0 ? (
          <Empty
            icon="🔎"
            title="还没有收录"
            desc="在搜狗微信里发现合适的文章后，点「收录此文」手动补全信息，沉淀为标准科普素材。"
          />
        ) : (
          <div className="space-y-3">
            {captured.map((it) => (
              <div key={it.id} className="card flex gap-3 p-3 transition-all hover:border-brand/40">
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium leading-snug">{it.title}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
                    <span>{it.sourceName}</span>
                    {it.publishedAt && <span>· {it.publishedAt}</span>}
                    <span className="chip border-grade-c/50 text-grade-c">C 级 · 线索</span>
                  </div>
                </div>
                <a
                  className="shrink-0 self-center text-[11px] text-brand hover:underline"
                  href={it.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  原文
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 右侧：说明 + 建议关注 ===== */}
      <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 lg:flex">
        <div className="card p-4">
          <div className="mb-3 text-sm font-semibold">检索说明</div>
          <ul className="space-y-2 text-[11px] leading-relaxed text-muted">
            <li>· 公众号内容受登录墙与跨域限制，浏览器内无法直接抓取，故走搜狗微信检索。</li>
            <li>· 「搜文章」对应 type=2，「搜公众号」对应 type=1，结果页在你的浏览器新标签打开。</li>
            <li>· 若搜狗弹出验证码，按提示完成即可（反爬机制，属正常现象）。</li>
            <li>· 收录的条目默认按 C 级线索处理，需与国标 / 监管公告交叉印证并标记「已研判」。</li>
          </ul>
        </div>

        <div className="card p-4">
          <div className="mb-3 text-[13px] font-semibold">建议关注的质量标准类公众号</div>
          <div className="space-y-2.5">
            {['中国标准化', '市场监管权威发布', '质标科普', '标准与创新'].map((name) => (
              <div key={name} className="flex items-center gap-2.5 text-xs">
                <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                <span className="text-ink">{name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 dark:bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-700 dark:text-amber-400">
            <span>⚠</span> 信源可靠性
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/80">
            公众号为 <span className="font-medium">C 级线索参考</span>，非官方权威信源。收录后须与国家标准 / 监管公告交叉印证，经人工研判方可进入选题池。
          </p>
        </div>
      </aside>

      {/* ===== 收录弹窗 ===== */}
      {modal && (
        <CaptureModal
          onClose={() => setModal(false)}
          onSubmit={(p) => saveCapture(p)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-line bg-elevated px-4 py-2 text-xs shadow-lg">
          {toast}
          <button className="ml-3 text-muted hover:text-ink" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}
    </main>
  )
}

/* ============================ 收录弹窗 ============================ */

function CaptureModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (p: Omit<WechatArticle, 'id' | 'fetchedAt'>) => void
}) {
  const [d, setD] = useState({
    url: '',
    title: '',
    sourceName: '',
    summary: '',
    coverUrl: '',
    tags: ['标准科普系列'] as string[],
    publishedAt: '',
    reviewed: false,
    note: '',
  })

  const toggleTag = (t: string) =>
    setD((s) => ({ ...s, tags: s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t] }))

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
            <h3 className="text-base font-semibold tracking-tight">收录到采集库</h3>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
              公众号内容无法在浏览器内自动解析，请手动补全信息。带 * 为必填。
            </p>
          </div>
          <button className="btn-ghost !px-2 !py-1 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <Field label="原文链接 *">
            <input className="field" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} placeholder="https://mp.weixin.qq.com/s/..." />
          </Field>
          <Field label="文章标题 *">
            <input className="field" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="公众号名称 *">
              <input className="field" value={d.sourceName} onChange={(e) => setD({ ...d, sourceName: e.target.value })} />
            </Field>
            <Field label="发布日期">
              <input className="field" type="date" value={d.publishedAt} onChange={(e) => setD({ ...d, publishedAt: e.target.value })} />
            </Field>
          </div>
          <Field label="封面图 URL（可选）">
            <input className="field" value={d.coverUrl} onChange={(e) => setD({ ...d, coverUrl: e.target.value })} placeholder="https://..." />
          </Field>
          <Field label="摘要 / 要点">
            <textarea className="field h-20 resize-none" value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} />
          </Field>
          <Field label="主题标签">
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
                    d.tags.includes(t) ? 'border-brand/50 bg-brand/12 text-brand' : 'border-line bg-elevated/50 text-muted hover:text-ink'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <Field label="交叉印证 / 研判备注">
            <input className="field" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="如：已与 GB/T xxxx 核对" />
          </Field>
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={d.reviewed}
              onChange={(e) => setD({ ...d, reviewed: e.target.checked })}
              className="accent-[rgb(var(--c-brand))]"
            />
            已研判（已与权威信源交叉印证）
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
              取消
            </button>
            <button
              className="btn-primary !py-1.5 text-xs disabled:opacity-40"
              disabled={!d.title.trim() || !d.sourceName.trim() || !d.url.trim()}
              onClick={() =>
                onSubmit({
                  url: d.url.trim(),
                  title: d.title.trim(),
                  sourceName: d.sourceName.trim(),
                  summary: d.summary.trim() || undefined,
                  coverUrl: d.coverUrl.trim() || undefined,
                  tags: d.tags.length ? d.tags : ['标准科普系列'],
                  publishedAt: d.publishedAt || undefined,
                  reviewed: d.reviewed,
                  note: d.note.trim() || undefined,
                })
              }
            >
              入库
            </button>
          </div>
        </div>
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
