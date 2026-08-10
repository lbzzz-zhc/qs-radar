import { useEffect, useMemo, useRef, useState } from 'react'
import type { WechatArticle } from '../types'
import {
  addWechatArticle,
  fetchWechatDB,
  removeWechatArticle,
  saveWechatDB,
  updateWechatArticle,
} from '../lib/wechatCollect'
import { Empty } from './ui'

const TOKEN_KEY = 'qsr-gh-token'
const RECENT_KEY = 'qsr-wx-recent'
const CAPTURED_KEY = 'qsr-wx-captured'

const TAGS = ['标准科普系列', '国标解读', '抽检科普', '消费提示']
const TOPICS = ['质量', '标准化', '认证', '抽检', '召回', '国标', '计量', '质检', '食品安全', '消费提示']
const SUGGEST_ACCOUNTS = ['中国标准化', '市场监管权威发布', '质标科普', '标准与创新']

const isWxArticle = (u: string) => /mp\.weixin\.qq\.com\/(s|s\?|mp\/appmsg|profile)/.test(u.trim())
const todayStr = () => new Date().toISOString().slice(0, 10)

/* ============================ 主组件 ============================ */

export default function WechatSearch() {
  const [mode, setMode] = useState<'article' | 'account'>('article')
  const [keyword, setKeyword] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [captured, setCaptured] = useState<WechatArticle[]>([])
  const [loaded, setLoaded] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  // 列表筛选
  const [q, setQ] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false)
  const tokenRef = useRef<string>(localStorage.getItem(TOKEN_KEY) || '')
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'))
    } catch {
      /* ignore */
    }
    // 优先读共享采集库；失败回退本机缓存（无 token / 离线时仍可用）
    fetchWechatDB()
      .then((db) => {
        setCaptured(db.items)
        try {
          localStorage.setItem(CAPTURED_KEY, JSON.stringify(db.items.slice(0, 50)))
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        try {
          setCaptured(JSON.parse(localStorage.getItem(CAPTURED_KEY) || '[]'))
        } catch {
          /* ignore */
        }
      })
      .finally(() => setLoaded(true))
  }, [])

  const buildUrl = (kw: string) =>
    `https://weixin.sogou.com/weixin?type=${mode === 'article' ? 2 : 1}&query=${encodeURIComponent(kw)}&ie=utf8`

  function flash(msg: string) {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }

  function doSearch(kw?: string) {
    const k = (kw ?? keyword).trim()
    if (!k) return
    window.open(buildUrl(k), '_blank', 'noopener,noreferrer')
    setRecent((r) => {
      const next = [k, ...r.filter((x) => x !== k)].slice(0, 8)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }

  async function saveCapture(p: Omit<WechatArticle, 'id' | 'fetchedAt'>) {
    const token = tokenRef.current
    if (token) {
      try {
        const db = await fetchWechatDB().catch(() => ({
          version: '1',
          items: [] as WechatArticle[],
          updatedAt: new Date().toISOString(),
        }))
        await saveWechatDB(addWechatArticle(db, p), token)
        const refreshed = await fetchWechatDB()
        setCaptured(refreshed.items)
        flash('已同步到采集库 ✓（去「标准科普采集」可继续研判）')
      } catch (e) {
        flash(`同步失败：${(e as Error).message}（已存本机）`)
        const full: WechatArticle = { ...p, id: `wx-${Date.now().toString(36)}`, fetchedAt: new Date().toISOString() }
        setCaptured((c) => {
          const next = [full, ...c].slice(0, 50)
          try {
            localStorage.setItem(CAPTURED_KEY, JSON.stringify(next))
          } catch {
            /* ignore */
          }
          return next
        })
      }
    } else {
      const full: WechatArticle = { ...p, id: `wx-${Date.now().toString(36)}`, fetchedAt: new Date().toISOString() }
      setCaptured((c) => {
        const next = [full, ...c].slice(0, 50)
        try {
          localStorage.setItem(CAPTURED_KEY, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      })
      flash('已存本机（配置 GitHub Token 后可同步到共享采集库）')
    }
    setModal(false)
  }

  async function toggleReviewed(it: WechatArticle) {
    const token = tokenRef.current
    const next = !it.reviewed
    if (token) {
      try {
        const db = await fetchWechatDB()
        await saveWechatDB(updateWechatArticle(db, it.id, { reviewed: next }), token)
        setCaptured((await fetchWechatDB()).items)
        flash(next ? '已标记「已研判」✓' : '已取消研判标记')
        return
      } catch (e) {
        flash(`同步失败：${(e as Error).message}`)
      }
    }
    setCaptured((c) => {
      const list = c.map((x) => (x.id === it.id ? { ...x, reviewed: next } : x))
      try {
        localStorage.setItem(CAPTURED_KEY, JSON.stringify(list.slice(0, 50)))
      } catch {
        /* ignore */
      }
      return list
    })
  }

  async function removeItem(it: WechatArticle) {
    if (!window.confirm(`确定删除「${it.title}」？此操作不可撤销。`)) return
    const token = tokenRef.current
    if (token) {
      try {
        const db = await fetchWechatDB()
        await saveWechatDB(removeWechatArticle(db, it.id), token)
        setCaptured((await fetchWechatDB()).items)
        flash('已删除')
        return
      } catch (e) {
        flash(`同步失败：${(e as Error).message}`)
      }
    }
    setCaptured((c) => {
      const list = c.filter((x) => x.id !== it.id)
      try {
        localStorage.setItem(CAPTURED_KEY, JSON.stringify(list.slice(0, 50)))
      } catch {
        /* ignore */
      }
      return list
    })
  }

  const list = useMemo(() => {
    return captured
      .filter((it) => (tagFilter ? it.tags?.includes(tagFilter) : true))
      .filter((it) => (onlyUnreviewed ? !it.reviewed : true))
      .filter((it) => {
        if (!q.trim()) return true
        const s = q.toLowerCase()
        return (
          it.title.toLowerCase().includes(s) ||
          it.sourceName.toLowerCase().includes(s) ||
          (it.summary || '').toLowerCase().includes(s)
        )
      })
  }, [captured, tagFilter, onlyUnreviewed, q])

  const reviewedCount = useMemo(() => captured.filter((it) => it.reviewed).length, [captured])

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
            <button
              className="btn-ghost !px-2.5 !py-1.5 text-[11px]"
              title="复制检索链接，可发到手机打开"
              onClick={() => {
                const u = buildUrl(keyword || '质量')
                navigator.clipboard?.writeText(u).then(
                  () => flash('已复制检索链接 ✓'),
                  () => flash('复制失败，链接：' + u),
                )
              }}
            >
              复制链接
            </button>
          </div>

          <div className="text-[11px] leading-relaxed text-muted">
            公众号无公开检索 API，站内通过<span className="text-ink">搜狗微信</span>检索（结果新标签打开）。
            在搜狗里<span className="text-brand">复制文章链接</span>回到这里，点「收录此文」粘贴即可<span className="text-brand">自动识别</span>，沉淀进「标准科普采集」统一研判。
          </div>

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

        {/* 收录列表头部 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            收录到采集库 <span className="text-[11px] font-normal text-muted">（{captured.length} 条 · 已研判 {reviewedCount}）</span>
          </div>
          <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => setModal(true)}>
            + 收录此文
          </button>
        </div>

        {/* 筛选条 */}
        {captured.length > 0 && (
          <div className="space-y-2">
            <input
              className="field"
              placeholder="筛选已收录：标题 / 公众号 / 摘要…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setTagFilter(null)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-all ${
                  tagFilter === null ? 'border-brand/50 bg-brand/12 text-brand' : 'border-line bg-elevated/50 text-muted hover:text-ink'
                }`}
              >
                全部
              </button>
              {TAGS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter(t)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-all ${
                    tagFilter === t ? 'border-brand/50 bg-brand/12 text-brand' : 'border-line bg-elevated/50 text-muted hover:text-ink'
                  }`}
                >
                  {t}
                </button>
              ))}
              <label className="ml-auto flex cursor-pointer items-center gap-1 text-[10px] text-muted">
                <input
                  type="checkbox"
                  checked={onlyUnreviewed}
                  onChange={(e) => setOnlyUnreviewed(e.target.checked)}
                  className="accent-[rgb(var(--c-brand))]"
                />
                只看未研判
              </label>
            </div>
          </div>
        )}

        {!loaded ? (
          <div className="card p-6 text-center text-[11px] text-muted">加载中…</div>
        ) : list.length === 0 ? (
          <Empty
            icon="🔎"
            title={captured.length === 0 ? '还没有收录' : '没有匹配的条目'}
            desc={
              captured.length === 0
                ? '在搜狗微信里发现合适的文章后，复制链接 → 点「收录此文」粘贴，系统会自动识别并入库。'
                : '试试放宽筛选条件。'
            }
          />
        ) : (
          <div className="space-y-3">
            {list.map((it) => (
              <div key={it.id} className="card flex gap-3 p-3 transition-all hover:border-brand/40">
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium leading-snug">{it.title}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
                    <span>{it.sourceName}</span>
                    {it.publishedAt && <span>· {it.publishedAt}</span>}
                    {it.reviewed ? (
                      <span className="chip border-emerald-400/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                        ✓ 已研判
                      </span>
                    ) : (
                      <span className="chip border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                        C 级 · 线索
                      </span>
                    )}
                  </div>
                  {it.tags && it.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {it.tags.map((t) => (
                        <span key={t} className="rounded bg-elevated/60 px-1.5 py-0.5 text-[9px] text-muted">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end justify-center gap-1.5">
                  <a
                    className="text-[11px] text-brand hover:underline"
                    href={it.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    原文
                  </a>
                  <button className="text-[11px] text-muted hover:text-emerald-600" onClick={() => toggleReviewed(it)}>
                    {it.reviewed ? '取消研判' : '标记研判'}
                  </button>
                  <button className="text-[11px] text-muted hover:text-red-500" onClick={() => removeItem(it)}>
                    删除
                  </button>
                </div>
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
            <li>· 搜到文章后<span className="text-brand">复制链接</span>，回到本页「收录此文」粘贴即可自动识别。</li>
            <li>· 若搜狗弹出验证码，按提示完成即可（反爬机制，属正常现象）。</li>
            <li>· 收录的条目默认按 C 级线索处理，需与国标 / 监管公告交叉印证并标记「已研判」。</li>
          </ul>
        </div>

        <div className="card p-4">
          <div className="mb-3 text-[13px] font-semibold">建议关注的质量标准类公众号</div>
          <div className="space-y-2.5">
            {SUGGEST_ACCOUNTS.map((name) => (
              <button
                key={name}
                onClick={() => {
                  setMode('account')
                  setKeyword(name)
                  doSearch(name)
                }}
                className="flex w-full items-center gap-2.5 text-left text-xs transition-all hover:text-brand"
                title="点按在搜狗检索该公众号"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                <span className="text-ink">{name}</span>
                <span className="ml-auto text-[10px] text-muted">↗</span>
              </button>
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

      {modal && <CaptureModal onClose={() => setModal(false)} onSubmit={(p) => saveCapture(p)} />}

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

  const recognized = isWxArticle(d.url)

  // 粘贴 / 输入链接时：识别到公众号文章则自动补当天日期
  function onUrl(v: string) {
    setD((s) => ({ ...s, url: v, publishedAt: s.publishedAt || (isWxArticle(v) ? todayStr() : s.publishedAt) }))
  }

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
              在搜狗微信复制文章链接，粘贴到下方<span className="text-brand">原文链接</span>即可自动识别；其余信息按需补全。带 * 为必填。
            </p>
          </div>
          <button className="btn-ghost !px-2 !py-1 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <Field label="原文链接 *">
            <div className="flex gap-2">
              <input
                className="field flex-1"
                value={d.url}
                onChange={(e) => onUrl(e.target.value)}
                placeholder="粘贴 https://mp.weixin.qq.com/s/..."
              />
              {d.url && (
                <a
                  className="btn-ghost !px-2.5 !py-1.5 text-[11px] whitespace-nowrap"
                  href={d.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  打开核对
                </a>
              )}
            </div>
            {recognized && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                ✓ 已识别为公众号文章链接
              </div>
            )}
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
