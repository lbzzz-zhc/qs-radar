import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArticleItem, ContentLibrary, FileRef, Journal } from '../types'
import {
  addArticle,
  addIssue,
  addJournal,
  fetchLibrary,
  fetchRemoteLibrary,
  removeArticle,
  removeIssue,
  removeJournal,
  saveLibrary,
  updateArticle,
  updateIssue,
  updateJournal,
  uploadPdf,
} from '../lib/contentLibrary'

const BASE = import.meta.env.BASE_URL || '/'
const TOKEN_KEY = 'qsr-gh-token'
const WX_WORKER_KEY = 'qsr-wx-worker'
const WX_AUTHOR_KEY = 'qsr-wx-author'
const WX_COVER_KEY = 'qsr-wx-cover'

// 本地暂存预览（仅当前会话有效，未同步到 GitHub 时使用）
const objUrlMap = new Map<string, string>()

function uid(p: string): string {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// 极简 Markdown → HTML（标题/加粗/斜体/代码/链接/引用/列表/段落），够微信草稿箱用
function mdToHtml(md: string): string {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let html = ''
  let inCode = false
  let code = ''
  const inline = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        html += `<pre>${code}</pre>`
        code = ''
        inCode = false
      } else inCode = true
      continue
    }
    if (inCode) {
      code += line + '\n'
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      const m = line.match(/^(#{1,6})\s+(.*)$/)!
      const n = m[1].length
      html += `<h${n}>${inline(m[2])}</h${n}>`
      continue
    }
    if (/^>\s?/.test(line)) {
      html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`
      continue
    }
    if (line.trim() === '') continue
    html += `<p>${inline(line)}</p>`
  }
  return html
}

/* ============================ 主组件 ============================ */

export default function ContentLibrary() {
  const [lib, setLib] = useState<ContentLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [doneFilter, setDoneFilter] = useState<'all' | 'done' | 'todo'>('all')

  const [selectedJournal, setSelectedJournal] = useState<string | null>(null)
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)

  const [modal, setModal] = useState<null | 'addJournal' | 'addIssue' | 'addArticle' | 'settings'>(null)
  const [status, setStatus] = useState<string | null>(null)

  const tokenRef = useRef<string>(localStorage.getItem(TOKEN_KEY) || '')
  const wxRef = useRef<{ worker: string; author: string; cover: string }>({
    worker: localStorage.getItem(WX_WORKER_KEY) || '',
    author: localStorage.getItem(WX_AUTHOR_KEY) || '',
    cover: localStorage.getItem(WX_COVER_KEY) || '',
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        setLib(await fetchLibrary())
      } catch (e) {
        setLoadError((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // 本地变更 + （若配置了 token）写回 GitHub
  function apply(next: ContentLibrary) {
    setLib(next)
    const token = tokenRef.current
    if (token) {
      saveLibrary(next, token)
        .then(() => setStatus('已自动同步到 GitHub ✓'))
        .catch((e) => setStatus(`同步失败：${(e as Error).message}`))
    }
  }

  const journals = lib?.journals ?? []

  const stats = useMemo(() => {
    let issues = 0
    let articles = 0
    let done = 0
    for (const j of journals)
      for (const i of j.issues) {
        issues++
        for (const a of i.articles) {
          articles++
          if (a.doneByUs) done++
        }
      }
    return { journals: journals.length, issues, articles, done }
  }, [journals])

  // 按关键词 + 是否做过 过滤文章（用于左侧命中计数与高亮）
  const kw = keyword.trim().toLowerCase()
  function matchArticle(a: ArticleItem): boolean {
    if (doneFilter === 'done' && !a.doneByUs) return false
    if (doneFilter === 'todo' && a.doneByUs) return false
    if (!kw) return true
    const hay = `${a.title} ${a.column ?? ''} ${(a.keywords ?? []).join(' ')} ${a.note ?? ''}`.toLowerCase()
    return hay.includes(kw)
  }

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,420px)_1fr]">
      {/* ===== 左侧：期刊列表 + 搜索 + 筛选 ===== */}
      <aside className="flex min-h-0 flex-col border-r border-line">
        <div className="grid shrink-0 grid-cols-4 gap-2 px-3 py-3 text-center">
          <Stat label="期刊" value={stats.journals} />
          <Stat label="期次" value={stats.issues} />
          <Stat label="文章" value={stats.articles} />
          <Stat label="已做" value={stats.done} good />
        </div>

        <div className="shrink-0 space-y-2.5 px-3 pb-3">
          <div className="flex gap-2">
            <input
              className="field flex-1"
              placeholder="搜索文章 / 栏目 / 关键词…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button
              className="btn-primary !px-3 !py-1.5 text-xs"
              onClick={() => openModal('addJournal')}
            >
              + 期刊
            </button>
          </div>
          <div className="flex gap-1.5">
            {(['all', 'done', 'todo'] as const).map((f) => (
              <Chip key={f} active={doneFilter === f} onClick={() => setDoneFilter(f)}>
                {f === 'all' ? '全部' : f === 'done' ? '我们做过' : '未做'}
              </Chip>
            ))}
            <button className="btn-ghost !ml-auto !px-2.5 !py-1 text-[11px]" onClick={() => openModal('settings')}>
              ⚙ 同步
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
          {loading && <div className="skeleton h-16 w-full" />}
          {loadError && <div className="rounded-xl border border-grade-d/40 bg-grade-d/10 px-3 py-3 text-xs text-grade-d">加载失败：{loadError}</div>}
          {!loading && !loadError && journals.length === 0 && (
            <Empty icon="📚" title="还没有期刊" desc="点击右上角「+ 期刊」添加《质量与标准化》等期刊，开始沉淀内容资产。" />
          )}

          {journals.map((j) => {
            const hit = j.issues.some((i) => i.articles.some(matchArticle))
            const active = selectedJournal === j.id
            return (
              <button
                key={j.id}
                onClick={() => {
                  setSelectedJournal(active ? null : j.id)
                  setExpandedIssue(null)
                }}
                className={`card card-hover w-full p-3 text-left transition-all ${active ? 'border-brand/60 ring-1 ring-brand/30' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{j.name}</span>
                  {j.coreDb && <span className="chip border-brand/40 text-brand">{j.coreDb}</span>}
                  {hit && kw && <span className="chip border-grade-c/50 text-grade-c">命中</span>}
                </div>
                <div className="mt-1 text-[10px] text-muted">
                  {j.issuer || '主办单位未填'} · {j.issues.length} 期 · {j.issues.reduce((s, i) => s + i.articles.length, 0)} 篇
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ===== 右侧：选中期刊的期次 / 文章管理 ===== */}
      <section className="min-h-0 overflow-y-auto p-4">
        {!selectedJournal && (
          <Empty icon="🗂️" title="选择左侧期刊查看内容" desc="可逐期管理文章、上传整期电子稿、标记「我们做过」，方便团队快速定位已产出内容。" />
        )}

        {selectedJournal &&
          (() => {
            const j = journals.find((x) => x.id === selectedJournal)!
            return (
              <div className="space-y-4">
                <JournalHeader
                  journal={j}
                  onEdit={(patch) => apply(updateJournal(lib!, j.id, patch))}
                  onDelete={() => {
                    if (confirm(`确定删除期刊《${j.name}》及其全部期次？`)) apply(removeJournal(lib!, j.id))
                  }}
                  onAddIssue={() => openModal('addIssue')}
                />

                {j.issues.length === 0 && (
                  <div className="rounded-xl border border-line bg-elevated/40 px-4 py-6 text-center text-xs text-muted">
                    还没有期次，点击「+ 期次」开始录入。
                  </div>
                )}

                {j.issues.map((issue) => {
                  const open = expandedIssue === issue.id
                  const articles = issue.articles.filter(matchArticle)
                  return (
                    <div key={issue.id} className="card overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3">
                        <button className="text-muted" onClick={() => setExpandedIssue(open ? null : issue.id)}>
                          {open ? '▾' : '▸'}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {issue.year} 年 第 {issue.issue} 期
                            {issue.volume && ` · 卷 ${issue.volume}`}
                            {issue.coverTheme && <span className="ml-2 text-muted text-xs">专题：{issue.coverTheme}</span>}
                          </div>
                          <div className="text-[10px] text-muted">
                            {issue.publishDate || '出版日期未填'} · {issue.articles.length} 篇
                            {issue.fileRefs?.length ? ` · ${issue.fileRefs.length} 份电子稿` : ''}
                          </div>
                        </div>
                        <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => openModal('addArticle')}>
                          + 文章
                        </button>
                        <IssueMenu
                          onUpload={(file) => handleUpload(j.id, issue.id, file)}
                          onEdit={() => openModal('addIssue')}
                          onDelete={() => {
                            if (confirm('确定删除该期？')) apply(removeIssue(lib!, j.id, issue.id))
                          }}
                        />
                      </div>

                      {open && (
                        <div className="border-t border-line px-4 py-3">
                          {issue.fileRefs && issue.fileRefs.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {issue.fileRefs.map((f) => (
                                <PdfChip key={f.id} refFile={f} />
                              ))}
                            </div>
                          )}
                          {articles.length === 0 ? (
                            <div className="text-[11px] text-muted">该期暂无匹配的文章。</div>
                          ) : (
                            <div className="space-y-2">
                              {articles.map((a) => (
                                <ArticleRow
                                  key={a.id}
                                  article={a}
                                  busy={busyId === a.id}
                                  onToggleDone={(v) => apply(updateArticle(lib!, j.id, issue.id, a.id, { doneByUs: v }))}
                                  onPatch={(patch) => apply(updateArticle(lib!, j.id, issue.id, a.id, patch))}
                                  onDelete={() => apply(removeArticle(lib!, j.id, issue.id, a.id))}
                                  onExport={() => downloadMd(a)}
                                  onPush={() => pushDraft(a)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
      </section>

      {/* ===== 弹窗 ===== */}
      {modal === 'addJournal' && (
        <AddJournalModal
          onClose={() => setModal(null)}
          onSubmit={(patch) => {
            apply(addJournal(lib!, patch))
            setModal(null)
          }}
        />
      )}
      {modal === 'addIssue' && selectedJournal && (
        <AddIssueModal
          onClose={() => setModal(null)}
          onSubmit={(patch) => {
            apply(addIssue(lib!, selectedJournal, patch))
            setModal(null)
          }}
        />
      )}
      {modal === 'addArticle' && selectedJournal && expandedIssue && (
        <AddArticleModal
          onClose={() => setModal(null)}
          onSubmit={(patch) => {
            apply(addArticle(lib!, selectedJournal, expandedIssue, patch))
            setModal(null)
          }}
        />
      )}
      {modal === 'settings' && (
        <SettingsModal
          onClose={() => setModal(null)}
          onSaved={(s) => {
            tokenRef.current = s.token
            wxRef.current = { worker: s.worker, author: s.author, cover: s.cover }
            localStorage.setItem(TOKEN_KEY, s.token)
            localStorage.setItem(WX_WORKER_KEY, s.worker)
            localStorage.setItem(WX_AUTHOR_KEY, s.author)
            localStorage.setItem(WX_COVER_KEY, s.cover)
            setStatus('已保存同步设置（GitHub Token + 微信 Worker）')
          }}
          onSync={async () => {
            const t = tokenRef.current
            if (!t) return setStatus('请先填写 GitHub Token')
            try {
              const remote = await fetchRemoteLibrary(t)
              const sha = remote?.sha
              await saveLibrary(lib!, t, sha)
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

  function openModal(m: 'addJournal' | 'addIssue' | 'addArticle' | 'settings') {
    setModal(m)
  }

  async function handleUpload(journalId: string, issueId: string, file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return setStatus('仅支持 PDF 电子稿')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const issue = lib!.journals.find((j) => j.id === journalId)!.issues.find((i) => i.id === issueId)!
    try {
      let ref: FileRef
      if (tokenRef.current) {
        ref = await uploadPdf(issueId, file.name, bytes, tokenRef.current)
        setStatus('电子稿已上传到 GitHub')
      } else {
        const url = URL.createObjectURL(file)
        const id = uid('file')
        objUrlMap.set(id, url)
        ref = { id, name: file.name, path: '', size: file.size, mime: 'application/pdf', uploadedAt: new Date().toISOString() }
        setStatus('已本地暂存电子稿（未同步到 GitHub，请到「同步」配置 Token）')
      }
      apply(updateIssue(lib!, journalId, issueId, { fileRefs: [...(issue.fileRefs ?? []), ref] }))
    } catch (e) {
      setStatus(`上传失败：${(e as Error).message}`)
    }
  }

  function downloadMd(a: ArticleItem) {
    const cover = a.coverUrl || wxRef.current.cover
    if (!cover) return setStatus('导出需封面图：请给文章填 coverUrl，或在「同步」设置默认封面')
    const md = `---\ntitle: ${JSON.stringify(a.title)}\ncover: ${cover}\n---\n\n${a.body || a.abstract || ''}\n`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${a.title}.md`
    link.click()
    URL.revokeObjectURL(url)
    setStatus('已导出 Markdown（本地用 wenyan publish 推送草稿箱）')
  }

  async function pushDraft(a: ArticleItem) {
    const cfg = wxRef.current
    if (!cfg.worker) return setStatus('请先在「同步」设置里填写微信 Worker 地址')
    setBusyId(a.id)
    try {
      const cover = a.coverUrl || cfg.cover || ''
      const html = mdToHtml(a.body || (a.abstract ? `> ${a.abstract}` : a.title))
      const res = await fetch(`${cfg.worker.replace(/\/$/, '')}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: a.title,
          author: a.authors || cfg.author || '',
          digest: (a.abstract || '').slice(0, 120),
          content: html,
          coverUrl: cover,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setStatus(`已推送草稿到公众号：${a.title} ✓（去后台草稿箱复核发布）`)
    } catch (e) {
      setStatus(`推送失败：${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }
}

/* ============================ 子组件 ============================ */

function Stat({ label, value, good }: { label: string; value: number; good?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-elevated/50 px-1 py-2">
      <div className={`font-mono text-lg font-bold leading-none ${good ? 'text-grade-a' : 'text-ink'}`}>{value}</div>
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
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <div className="text-3xl">{icon}</div>
        <div className="mt-2 text-sm font-medium">{title}</div>
        <div className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">{desc}</div>
      </div>
    </div>
  )
}

function JournalHeader({
  journal,
  onEdit,
  onDelete,
  onAddIssue,
}: {
  journal: Journal
  onEdit: (patch: Partial<Journal>) => void
  onDelete: () => void
  onAddIssue: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ issuer: journal.issuer ?? '', issn: journal.issn ?? '', cn: journal.cn ?? '', description: journal.description ?? '' })

  if (!editing)
    return (
      <div className="card flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold">{journal.name}</div>
          <div className="mt-0.5 text-[11px] text-muted">
            {journal.issuer || '主办单位未填'}
            {journal.issn && ` · ISSN ${journal.issn}`}
            {journal.cn && ` · ${journal.cn}`}
          </div>
          {journal.description && <div className="mt-1 text-xs text-muted">{journal.description}</div>}
        </div>
        <button className="btn-ghost !px-2.5 !py-1 text-[11px]" onClick={() => setEditing(true)}>
          编辑
        </button>
        <button className="btn-primary !px-2.5 !py-1 text-[11px]" onClick={onAddIssue}>
          + 期次
        </button>
        <button className="btn-ghost !px-2 !py-1 text-[11px] text-grade-d" onClick={onDelete} title="删除期刊">
          🗑
        </button>
      </div>
    )

  return (
    <div className="card space-y-2 p-4">
      <Field label="主办单位">
        <input className="field" value={draft.issuer} onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="ISSN">
          <input className="field" value={draft.issn} onChange={(e) => setDraft({ ...draft, issn: e.target.value })} />
        </Field>
        <Field label="国内刊号 CN">
          <input className="field" value={draft.cn} onChange={(e) => setDraft({ ...draft, cn: e.target.value })} />
        </Field>
      </div>
      <Field label="简介">
        <input className="field" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost !py-1.5 text-xs" onClick={() => setEditing(false)}>
          取消
        </button>
        <button
          className="btn-primary !py-1.5 text-xs"
          onClick={() => {
            onEdit(draft)
            setEditing(false)
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}

function IssueMenu({ onUpload, onEdit, onDelete }: { onUpload: (f: File) => void; onEdit: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ''
        }}
      />
      <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => ref.current?.click()}>
        ⬆ 电子稿
      </button>
      <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={onEdit} title="编辑期次">
        ✎
      </button>
      <button className="btn-ghost !px-2 !py-1 text-[11px] text-grade-d" onClick={onDelete} title="删除期次">
        🗑
      </button>
    </>
  )
}

function PdfChip({ refFile }: { refFile: FileRef }) {
  const url = refFile.path ? `${BASE}${refFile.path}` : objUrlMap.get(refFile.id)
  return (
    <a
      className="chip border-line bg-elevated/50 hover:border-brand/40"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      📄 {refFile.name}
    </a>
  )
}

function ArticleRow({
  article,
  busy,
  onToggleDone,
  onPatch,
  onDelete,
  onExport,
  onPush,
}: {
  article: ArticleItem
  busy?: boolean
  onToggleDone: (v: boolean) => void
  onPatch: (patch: Partial<ArticleItem>) => void
  onDelete: () => void
  onExport: () => void
  onPush: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    title: article.title,
    column: article.column ?? '',
    authors: article.authors ?? '',
    pages: article.pages ?? '',
    relatedNote: article.relatedNote ?? '',
    body: article.body ?? '',
    coverUrl: article.coverUrl ?? '',
  })

  if (!editing)
    return (
      <div className="rounded-xl border border-line bg-elevated/30 p-3">
        <div className="flex items-start gap-2">
          <label className="mt-0.5 flex cursor-pointer items-center gap-1.5 text-[11px]" title="标记为「我们做过」">
            <input type="checkbox" checked={!!article.doneByUs} onChange={(e) => onToggleDone(e.target.checked)} className="accent-[rgb(var(--c-brand))]" />
            {article.doneByUs && <span className="chip border-grade-a/50 text-grade-a">我们做过</span>}
          </label>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium leading-snug">{article.title}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-muted">
              {article.column && <span>栏目：{article.column}</span>}
              {article.authors && <span>{article.authors}</span>}
              {article.pages && <span>pp.{article.pages}</span>}
            </div>
            {article.relatedNote && <div className="mt-1 text-[10px] text-brand">关联：{article.relatedNote}</div>}
          </div>
          <button className="btn-ghost !px-2 !py-0.5 text-[11px]" onClick={onExport} title="导出 Markdown">
            ⬇MD
          </button>
          <button className="btn-ghost !px-2 !py-0.5 text-[11px]" onClick={onPush} disabled={busy} title="推送草稿到公众号">
            {busy ? '推送中…' : '↗公众号'}
          </button>
          <button className="btn-ghost !px-2 !py-0.5 text-[11px]" onClick={() => setEditing(true)}>
            编辑
          </button>
          <button className="btn-ghost !px-2 !py-0.5 text-[11px] text-grade-d" onClick={onDelete}>
            ✕
          </button>
        </div>
      </div>
    )

  return (
    <div className="space-y-2 rounded-xl border border-brand/30 bg-elevated/40 p-3">
      <Field label="标题">
        <input className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="栏目">
          <input className="field" value={draft.column} onChange={(e) => setDraft({ ...draft, column: e.target.value })} />
        </Field>
        <Field label="作者">
          <input className="field" value={draft.authors} onChange={(e) => setDraft({ ...draft, authors: e.target.value })} />
        </Field>
        <Field label="页码">
          <input className="field" value={draft.pages} onChange={(e) => setDraft({ ...draft, pages: e.target.value })} />
        </Field>
      </div>
      <Field label="关联选题 / 备注">
        <input className="field" value={draft.relatedNote} onChange={(e) => setDraft({ ...draft, relatedNote: e.target.value })} placeholder="关联本系统选题 id 或链接" />
      </Field>
      <Field label="正文 (Markdown)">
        <textarea className="field h-28 resize-none" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="用于导出 / 推送公众号" />
      </Field>
      <Field label="封面图 URL">
        <input className="field" value={draft.coverUrl} onChange={(e) => setDraft({ ...draft, coverUrl: e.target.value })} placeholder="推送公众号用的封面，留空用默认" />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost !py-1.5 text-xs" onClick={() => setEditing(false)}>
          取消
        </button>
        <button
          className="btn-primary !py-1.5 text-xs"
          onClick={() => {
            onPatch({
              title: draft.title,
              column: draft.column || undefined,
              authors: draft.authors || undefined,
              pages: draft.pages || undefined,
              relatedNote: draft.relatedNote || undefined,
              body: draft.body || undefined,
              coverUrl: draft.coverUrl || undefined,
            })
            setEditing(false)
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}

/* ============================ 弹窗 ============================ */

function Modal({ title, desc, children, onClose }: { title: string; desc?: string; children: React.ReactNode; onClose: () => void }) {
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

function AddJournalModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (p: { name: string; issuer?: string; issn?: string; cn?: string; coreDb?: string; description?: string }) => void }) {
  const [d, setD] = useState({ name: '', issuer: '', issn: '', cn: '', coreDb: '中国核心期刊数据库', description: '' })
  return (
    <Modal title="添加期刊" desc="录入一本期刊（如《质量与标准化》），后续在其下逐期管理文章与电子稿。" onClose={onClose}>
      <div className="space-y-3">
        <Field label="期刊名称 *">
          <input className="field" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="《质量与标准化》" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="主办单位">
            <input className="field" value={d.issuer} onChange={(e) => setD({ ...d, issuer: e.target.value })} />
          </Field>
          <Field label="收录数据库">
            <input className="field" value={d.coreDb} onChange={(e) => setD({ ...d, coreDb: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="ISSN">
            <input className="field" value={d.issn} onChange={(e) => setD({ ...d, issn: e.target.value })} />
          </Field>
          <Field label="国内刊号 CN">
            <input className="field" value={d.cn} onChange={(e) => setD({ ...d, cn: e.target.value })} />
          </Field>
        </div>
        <Field label="简介">
          <input className="field" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary !py-1.5 text-xs disabled:opacity-40" disabled={!d.name.trim()} onClick={() => onSubmit(d)}>
            添加
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AddIssueModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (p: { year: number; volume?: string; issue: string; publishDate?: string; coverTheme?: string; columns?: string[] }) => void }) {
  const [d, setD] = useState({ year: String(new Date().getFullYear()), volume: '', issue: '', publishDate: '', coverTheme: '', columns: '' })
  return (
    <Modal title="添加期次" desc="录入某一期的基本信息；文章可在期次展开后逐篇添加。" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="年份 *">
            <input className="field" type="number" value={d.year} onChange={(e) => setD({ ...d, year: e.target.value })} />
          </Field>
          <Field label="卷">
            <input className="field" value={d.volume} onChange={(e) => setD({ ...d, volume: e.target.value })} placeholder="12" />
          </Field>
          <Field label="期号 *">
            <input className="field" value={d.issue} onChange={(e) => setD({ ...d, issue: e.target.value })} placeholder="03" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="出版日期">
            <input className="field" type="date" value={d.publishDate} onChange={(e) => setD({ ...d, publishDate: e.target.value })} />
          </Field>
          <Field label="封面专题">
            <input className="field" value={d.coverTheme} onChange={(e) => setD({ ...d, coverTheme: e.target.value })} />
          </Field>
        </div>
        <Field label="栏目（用逗号分隔）">
          <input className="field" value={d.columns} onChange={(e) => setD({ ...d, columns: e.target.value })} placeholder="标准解读, 行业动态, 案例分析" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary !py-1.5 text-xs disabled:opacity-40"
            disabled={!d.year || !d.issue}
            onClick={() =>
              onSubmit({
                year: Number(d.year),
                volume: d.volume || undefined,
                issue: d.issue,
                publishDate: d.publishDate || undefined,
                coverTheme: d.coverTheme || undefined,
                columns: d.columns ? d.columns.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
              })
            }
          >
            添加
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AddArticleModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (p: Omit<ArticleItem, 'id'>) => void }) {
  const [d, setD] = useState({ title: '', column: '', authors: '', pages: '', abstract: '', keywords: '', relatedNote: '', body: '', coverUrl: '' })
  return (
    <Modal title="添加文章" desc="录入一篇文章；可稍后在列表中标记「我们做过」并关联选题。" onClose={onClose}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <Field label="标题 *">
          <input className="field" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="栏目">
            <input className="field" value={d.column} onChange={(e) => setD({ ...d, column: e.target.value })} />
          </Field>
          <Field label="作者">
            <input className="field" value={d.authors} onChange={(e) => setD({ ...d, authors: e.target.value })} />
          </Field>
          <Field label="页码">
            <input className="field" value={d.pages} onChange={(e) => setD({ ...d, pages: e.target.value })} />
          </Field>
        </div>
        <Field label="摘要">
          <textarea className="field h-20 resize-none" value={d.abstract} onChange={(e) => setD({ ...d, abstract: e.target.value })} />
        </Field>
        <Field label="关键词（逗号分隔）">
          <input className="field" value={d.keywords} onChange={(e) => setD({ ...d, keywords: e.target.value })} />
        </Field>
        <Field label="关联选题 / 备注">
          <input className="field" value={d.relatedNote} onChange={(e) => setD({ ...d, relatedNote: e.target.value })} placeholder="关联本系统选题 id 或链接" />
        </Field>
        <Field label="正文 (Markdown)">
          <textarea className="field h-24 resize-none" value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder="用于导出 / 推送公众号（可选）" />
        </Field>
        <Field label="封面图 URL">
          <input className="field" value={d.coverUrl} onChange={(e) => setD({ ...d, coverUrl: e.target.value })} placeholder="推送公众号用的封面（可选，留空用默认）" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary !py-1.5 text-xs disabled:opacity-40"
            disabled={!d.title.trim()}
            onClick={() =>
              onSubmit({
                title: d.title.trim(),
                column: d.column || undefined,
                authors: d.authors || undefined,
                pages: d.pages || undefined,
                abstract: d.abstract || undefined,
                keywords: d.keywords ? d.keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
                relatedNote: d.relatedNote || undefined,
                body: d.body || undefined,
                coverUrl: d.coverUrl || undefined,
              })
            }
          >
            添加
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
  onSaved: (s: { token: string; worker: string; author: string; cover: string }) => void
  onSync: () => void
  status: string | null
}) {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '')
  const [worker, setWorker] = useState(localStorage.getItem(WX_WORKER_KEY) || '')
  const [author, setAuthor] = useState(localStorage.getItem(WX_AUTHOR_KEY) || '')
  const [cover, setCover] = useState(localStorage.getItem(WX_COVER_KEY) || '')
  return (
    <Modal
      title="同步设置"
      desc="GitHub Token 仅存本机，用于把内容资产写回仓库充当数据库；微信 Worker 地址用于把文章一键推送到公众号草稿箱。"
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-elevated/40 p-3">
          <div className="mb-2 text-[11px] font-medium text-muted">GitHub 同步（内容资产库数据库）</div>
          <Field label="GitHub Token (PAT)">
            <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_..." />
          </Field>
        </div>
        <div className="rounded-xl border border-line bg-elevated/40 p-3">
          <div className="mb-2 text-[11px] font-medium text-muted">微信推送（一键到草稿箱）</div>
          <Field label="微信 Worker 地址">
            <input className="field" value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="https://xxx.workers.dev" />
          </Field>
          <Field label="默认作者">
            <input className="field" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="留空则用文章作者" />
          </Field>
          <Field label="默认封面图 URL">
            <input className="field" value={cover} onChange={(e) => setCover(e.target.value)} placeholder="文章未填封面时用它" />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            取消
          </button>
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => onSaved({ token, worker, author, cover })}>
            保存设置
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
