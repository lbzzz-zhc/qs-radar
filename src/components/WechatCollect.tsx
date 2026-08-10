import { useEffect, useMemo, useRef, useState } from 'react'
import type { WechatArticle, WechatCollectDB } from '../types'
import {
  addWechatArticle,
  fetchRemoteWechatDB,
  fetchWechatDB,
  removeWechatArticle,
  saveWechatDB,
  updateWechatArticle,
} from '../lib/wechatCollect'

const TOKEN_KEY = 'qsr-gh-token'
const TAGS = ['标准科普系列', '国标解读', '抽检科普', '消费提示']

/* ============================ 主组件 ============================ */

export default function WechatCollect() {
  const [db, setDb] = useState<WechatCollectDB | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [activeTag, setActiveTag] = useState<string>('全部')
  const [linkInput, setLinkInput] = useState('')

  const [modal, setModal] = useState<null | 'add' | 'edit' | 'detail' | 'settings'>(null)
  const [editing, setEditing] = useState<WechatArticle | null>(null)
  const [detail, setDetail] = useState<WechatArticle | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const tokenRef = useRef<string>(localStorage.getItem(TOKEN_KEY) || '')

  useEffect(() => {
    ;(async () => {
      try {
        setDb(await fetchWechatDB())
      } catch (e) {
        setLoadError((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // 本地变更 + （若配置了 token）写回 GitHub
  function apply(next: WechatCollectDB) {
    setDb(next)
    const token = tokenRef.current
    if (token) {
      saveWechatDB(next, token)
        .then(() => setStatus('已自动同步到 GitHub ✓'))
        .catch((e) => setStatus(`同步失败：${(e as Error).message}`))
    }
  }

  const items = db?.items ?? []
  const filtered = useMemo(
    () => (activeTag === '全部' ? items : items.filter((i) => i.tags.includes(activeTag))),
    [items, activeTag],
  )

  const sources = useMemo(() => new Set(items.map((i) => i.sourceName)).size, [items])
  const weekAgo = Date.now() - 7 * 86400000
  const weekNew = items.filter((i) => new Date(i.fetchedAt).getTime() >= weekAgo).length
  const pending = items.filter((i) => !i.reviewed).length

  function openAdd() {
    setLinkInput('')
    setEditing(null)
    setModal('add')
  }

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ===== 左侧：采集 + 筛选 + 列表 ===== */}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
        {/* 采集输入卡 */}
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">公众号文章采集</div>
            <button className="btn-ghost !px-2.5 !py-1 text-[11px]" onClick={() => setModal('settings')}>
              ⚙ 同步
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className="field flex-1"
              placeholder="粘贴公众号文章链接，手动补全标题 / 封面 / 摘要"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
            />
            <button className="btn-primary !px-4 !py-1.5 text-xs whitespace-nowrap" onClick={openAdd}>
              解析并入库
            </button>
          </div>
          <div className="text-[11px] leading-relaxed text-muted">
            公众号无公开内容接口、浏览器又受跨域与登录墙限制，链接<span className="text-ink">无法自动解析</span>
            ，请手动补全信息后入库。所有条目默认按 <span className="chip border-grade-c/50 text-grade-c">C 级 · 线索</span> 处理，需交叉印证并人工研判。
          </div>
        </div>

        {/* 标签筛选 */}
        <div className="flex flex-wrap gap-1.5">
          {['全部', ...TAGS].map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(t)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
                activeTag === t
                  ? 'border-brand/50 bg-brand/12 text-brand'
                  : 'border-line bg-elevated/50 text-muted hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* 列表 */}
        <div className="flex items-center gap-2 px-0.5">
          <span className="text-sm font-semibold">已采集</span>
          <span className="chip border-line bg-elevated/50 text-muted">{filtered.length}</span>
        </div>

        {loading && <div className="skeleton h-20 w-full" />}
        {loadError && (
          <div className="rounded-xl border border-grade-d/40 bg-grade-d/10 px-3 py-3 text-xs text-grade-d">
            加载失败：{loadError}
          </div>
        )}
        {!loading && !loadError && filtered.length === 0 && (
          <Empty
            icon="📥"
            title="还没有采集内容"
            desc="粘贴一篇公众号文章链接，点击「解析并入库」手动补全信息，开始沉淀你的标准科普素材。"
          />
        )}

        <div className="space-y-3">
          {filtered.map((it) => (
            <ArticleCard
              key={it.id}
              article={it}
              onDetail={() => {
                setDetail(it)
                setModal('detail')
              }}
              onEdit={() => {
                setEditing(it)
                setModal('edit')
              }}
              onDelete={() => {
                if (confirm(`确定删除《${it.title}》？`)) apply(removeWechatArticle(db!, it.id))
              }}
              onToggleReviewed={(v) => apply(updateWechatArticle(db!, it.id, { reviewed: v }))}
            />
          ))}
        </div>
      </div>

      {/* ===== 右侧：概览 + 可靠性 + 推荐 ===== */}
      <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 lg:flex">
        <div className="card p-4">
          <div className="mb-3 text-sm font-semibold">采集概览</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="已采集" value={items.length} />
            <Stat label="公众号来源" value={sources} />
            <Stat label="本周新增" value={weekNew} />
            <Stat label="待研判" value={pending} warn />
          </div>
        </div>

        <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 dark:bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-700 dark:text-amber-400">
            <span>⚠</span> 信源可靠性
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/80">
            公众号为 <span className="font-medium">C 级线索参考</span>，非官方权威信源。入库后须与国家标准 / 监管公告交叉印证，经人工研判（标记「已研判」）方可进入选题池。
          </p>
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
      </aside>

      {/* ===== 弹窗 ===== */}
      {modal === 'add' && (
        <ArticleModal
          title="解析并入库"
          desc="公众号内容无法在浏览器内自动解析，请手动补全以下信息。带 * 为必填。"
          initial={{ url: linkInput, title: '', sourceName: '', summary: '', coverUrl: '', tags: ['标准科普系列'], publishedAt: '', reviewed: false, note: '' }}
          onClose={() => setModal(null)}
          onSubmit={(patch) => {
            apply(
              addWechatArticle(db!, {
                ...patch,
                reviewed: patch.reviewed ?? false,
              }),
            )
            setModal(null)
          }}
        />
      )}
      {modal === 'edit' && editing && (
        <ArticleModal
          title="编辑采集条目"
          desc="修改文章信息；标签可用于左侧筛选归类。"
          initial={editing}
          onClose={() => setModal(null)}
          onSubmit={(patch) => {
            apply(updateWechatArticle(db!, editing.id, patch))
            setModal(null)
          }}
        />
      )}
      {modal === 'detail' && detail && (
        <DetailModal
          article={detail}
          onClose={() => setModal(null)}
          onPatch={(patch) => {
            const next = updateWechatArticle(db!, detail.id, patch)
            setDb(next)
            setDetail({ ...detail, ...patch })
            const token = tokenRef.current
            if (token) saveWechatDB(next, token).catch((e) => setStatus(`同步失败：${(e as Error).message}`))
          }}
        />
      )}
      {modal === 'settings' && (
        <SettingsModal
          onClose={() => setModal(null)}
          onSaved={(t) => {
            tokenRef.current = t
            localStorage.setItem(TOKEN_KEY, t)
            setStatus(t ? '已保存 GitHub Token，改动将自动同步' : '已清除 Token（仅本地保存）')
          }}
          onSync={async () => {
            const t = tokenRef.current
            if (!t) return setStatus('请先填写 GitHub Token')
            try {
              const remote = await fetchRemoteWechatDB(t)
              const sha = remote?.sha
              await saveWechatDB(db!, t, sha)
              setStatus('已手动同步到 GitHub ✓')
            } catch (e) {
              setStatus(`同步失败：${(e as Error).message}`)
            }
          }}
          status={status}
        />
      )}

      {status && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-line bg-elevated px-4 py-2 text-xs shadow-lg">
          {status}
          <button className="ml-3 text-muted hover:text-ink" onClick={() => setStatus(null)}>
            ✕
          </button>
        </div>
      )}
    </main>
  )
}

/* ============================ 子组件 ============================ */

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-elevated/50 px-1 py-2.5 text-center">
      <div className={`font-mono text-lg font-bold leading-none ${warn ? 'text-grade-c' : 'text-ink'}`}>{value}</div>
      <div className="mt-1 text-[10px] text-muted">{label}</div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
        active ? 'border-brand/50 bg-brand/12 text-brand' : 'border-line bg-elevated/50 text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Empty({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="grid place-items-center p-8 text-center">
      <div>
        <div className="text-3xl">{icon}</div>
        <div className="mt-2 text-sm font-medium">{title}</div>
        <div className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">{desc}</div>
      </div>
    </div>
  )
}

function ArticleCard({
  article,
  onDetail,
  onEdit,
  onDelete,
  onToggleReviewed,
}: {
  article: WechatArticle
  onDetail: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleReviewed: (v: boolean) => void
}) {
  return (
    <div className="card flex gap-3 p-3 transition-all hover:border-brand/40">
      <div className="h-[72px] w-24 shrink-0 overflow-hidden rounded-xl bg-elevated">
        {article.coverUrl ? (
          <img src={article.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className="h-full w-full"
            style={{ background: 'linear-gradient(135deg,#E5E7EB,#CBD5E1)' }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{article.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
          <span>{article.sourceName}</span>
          {article.publishedAt && <span>· {article.publishedAt}</span>}
          {article.tags.map((t) => (
            <span key={t} className="chip border-brand/40 text-brand">
              {t}
            </span>
          ))}
          <span className="chip border-grade-c/50 text-grade-c">C 级 · 线索</span>
          {article.reviewed && <span className="chip border-grade-a/50 text-grade-a">已研判</span>}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between">
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted" title="标记为已研判（交叉印证）">
          <input
            type="checkbox"
            checked={!!article.reviewed}
            onChange={(e) => onToggleReviewed(e.target.checked)}
            className="accent-[rgb(var(--c-brand))]"
          />
          已研判
        </label>
        <div className="flex gap-3 text-[11px]">
          <button className="text-brand hover:underline" onClick={onDetail}>
            研判
          </button>
          <button className="text-muted hover:text-ink" onClick={onEdit}>
            编辑
          </button>
          <button className="text-grade-d hover:underline" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================ 弹窗 ============================ */

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-lg animate-fade-up p-5" onClick={(e) => e.stopPropagation()}>
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

function ArticleModal({
  title,
  desc,
  initial,
  onClose,
  onSubmit,
}: {
  title: string
  desc?: string
  initial: Partial<WechatArticle>
  onClose: () => void
  onSubmit: (p: Omit<WechatArticle, 'id' | 'fetchedAt'>) => void
}) {
  const [d, setD] = useState({
    url: initial.url ?? '',
    title: initial.title ?? '',
    sourceName: initial.sourceName ?? '',
    summary: initial.summary ?? '',
    coverUrl: initial.coverUrl ?? '',
    tags: initial.tags ?? ['标准科普系列'],
    publishedAt: initial.publishedAt ?? '',
    reviewed: initial.reviewed ?? false,
    note: initial.note ?? '',
  })

  const toggleTag = (t: string) =>
    setD((s) => ({ ...s, tags: s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t] }))

  return (
    <Modal title={title} desc={desc} onClose={onClose}>
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
              <Chip key={t} active={d.tags.includes(t)} onClick={() => toggleTag(t)}>
                {t}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="交叉印证 / 研判备注">
          <input className="field" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="如：已与 GB/T xxxx 核对" />
        </Field>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input type="checkbox" checked={d.reviewed} onChange={(e) => setD({ ...d, reviewed: e.target.checked })} className="accent-[rgb(var(--c-brand))]" />
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
    </Modal>
  )
}

function DetailModal({
  article,
  onClose,
  onPatch,
}: {
  article: WechatArticle
  onClose: () => void
  onPatch: (patch: Partial<WechatArticle>) => void
}) {
  const [note, setNote] = useState(article.note ?? '')
  return (
    <Modal title="研判" desc="公众号为 C 级线索参考，请与国家标准 / 监管公告交叉印证后再进入选题池。" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold leading-snug">{article.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span>{article.sourceName}</span>
            {article.publishedAt && <span>· {article.publishedAt}</span>}
            {article.tags.map((t) => (
              <span key={t} className="chip border-brand/40 text-brand">
                {t}
              </span>
            ))}
            <span className="chip border-grade-c/50 text-grade-c">C 级 · 线索</span>
          </div>
        </div>
        {article.summary && <p className="rounded-xl border border-line bg-elevated/40 p-3 text-xs leading-relaxed text-muted">{article.summary}</p>}
        <Field label="交叉印证 / 研判备注">
          <textarea
            className="field h-20 resize-none"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="如：已与 GB/T xxxx 第 5.2 条核对一致"
          />
        </Field>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={!!article.reviewed}
            onChange={(e) => onPatch({ reviewed: e.target.checked })}
            className="accent-[rgb(var(--c-brand))]"
          />
          标记为已研判（交叉印证完成）
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            关闭
          </button>
          <a className="btn-primary !py-1.5 text-xs" href={article.url} target="_blank" rel="noreferrer noopener">
            打开原文
          </a>
          <button className="btn-primary !py-1.5 text-xs" onClick={() => { onPatch({ note: note.trim() || undefined }); onClose() }}>
            保存备注
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SettingsModal({
  onClose,
  onSaved,
  onSync,
  status,
}: {
  onClose: () => void
  onSaved: (token: string) => void
  onSync: () => void
  status: string | null
}) {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '')
  return (
    <Modal
      title="GitHub 同步设置"
      desc="团队 PAT（需 repo 权限）仅存于本机浏览器，用于把采集库写回仓库充当后台数据库。不填则数据仅保留在本机本次会话。"
      onClose={onClose}
    >
      <div className="space-y-3">
        <Field label="GitHub Token (PAT)">
          <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_..." />
        </Field>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            取消
          </button>
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => onSaved(token)}>
            保存 Token
          </button>
          <button className="btn-primary !py-1.5 text-xs" onClick={onSync}>
            立即同步到 GitHub
          </button>
        </div>
        {status && <div className="text-[11px] text-muted">{status}</div>}
      </div>
    </Modal>
  )
}
