// 内容资产库领域层：运行时读取 + 写回 GitHub 仓库（充当数据库）
// 本地先做不可变变更，再由调用方统一 saveLibrary 写回，避免频繁请求。
import type { ArticleItem, ContentLibrary, FileRef, Journal, MagazineIssue } from '../types'
import { decodeBase64, getContent, getRepo, putBinary, putContent } from './github'

const LIB_PATH = 'public/data/content-library.json'
const BASE = import.meta.env.BASE_URL || '/'

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function now(): string {
  return new Date().toISOString()
}

function touch(lib: ContentLibrary): ContentLibrary {
  return { ...lib, updatedAt: now() }
}

/** 运行时读取（无需 token，任何人可看） */
export async function fetchLibrary(): Promise<ContentLibrary> {
  const res = await fetch(`${BASE}data/content-library.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`内容资产库加载失败 HTTP ${res.status}`)
  return (await res.json()) as ContentLibrary
}

/** 读取仓库中的最新内容（含 sha，用于写回） */
export async function fetchRemoteLibrary(
  token: string,
): Promise<{ lib: ContentLibrary; sha: string } | null> {
  const repo = getRepo()
  const file = await getContent(repo, LIB_PATH, token)
  if (!file) return null
  return { lib: JSON.parse(decodeBase64(file.content)) as ContentLibrary, sha: file.sha }
}

/** 写回仓库（处理 409 并发冲突：重新拉取 sha 后重试一次） */
export async function saveLibrary(lib: ContentLibrary, token: string, sha?: string): Promise<string> {
  const repo = getRepo()
  const text = JSON.stringify(touch(lib), null, 2)
  const message = `chore(content-library): update via 质标雷达 ${now()}`
  try {
    return await putContent(repo, LIB_PATH, text, message, token, sha)
  } catch (e) {
    if ((e as Error).message.includes('409')) {
      const remote = await fetchRemoteLibrary(token)
      if (remote) return await putContent(repo, LIB_PATH, text, message, token, remote.sha)
    }
    throw e
  }
}

/** 上传整期电子稿到 public/data/files/<issueId>/<name>，返回文件引用 */
export async function uploadPdf(
  issueId: string,
  fileName: string,
  bytes: Uint8Array,
  token: string,
  existingSha?: string,
): Promise<FileRef> {
  const repo = getRepo()
  const safe = fileName.replace(/[^\w.\-一-龥]/g, '_')
  const path = `public/data/files/${issueId}/${safe}`
  const { sha } = await putBinary(repo, path, bytes, `add file: ${path}`, token, existingSha)
  return {
    id: uid('file'),
    name: fileName,
    path: `data/files/${issueId}/${safe}`,
    size: bytes.length,
    mime: 'application/pdf',
    uploadedAt: now(),
    sha,
  }
}

// ============ 不可变变更助手（返回新 ContentLibrary） ============

export function addJournal(lib: ContentLibrary, j: Omit<Journal, 'id' | 'issues' | 'createdAt' | 'updatedAt'>): ContentLibrary {
  const journal: Journal = { ...j, id: uid('j'), issues: [], createdAt: now(), updatedAt: now() }
  return touch({ ...lib, journals: [...lib.journals, journal] })
}

export function updateJournal(lib: ContentLibrary, journalId: string, patch: Partial<Journal>): ContentLibrary {
  return touch({
    ...lib,
    journals: lib.journals.map((j) => (j.id === journalId ? { ...j, ...patch, updatedAt: now() } : j)),
  })
}

export function removeJournal(lib: ContentLibrary, journalId: string): ContentLibrary {
  return touch({ ...lib, journals: lib.journals.filter((j) => j.id !== journalId) })
}

export function addIssue(lib: ContentLibrary, journalId: string, issue: Omit<MagazineIssue, 'id' | 'journalId' | 'articles' | 'createdAt' | 'updatedAt'>): ContentLibrary {
  const full: MagazineIssue = {
    ...issue,
    id: `${journalId}-${issue.year}-v${issue.volume || '0'}-n${issue.issue}`,
    journalId,
    articles: [],
    createdAt: now(),
    updatedAt: now(),
  }
  return touch({
    ...lib,
    journals: lib.journals.map((j) => (j.id === journalId ? { ...j, issues: [...j.issues, full], updatedAt: now() } : j)),
  })
}

export function updateIssue(lib: ContentLibrary, journalId: string, issueId: string, patch: Partial<MagazineIssue>): ContentLibrary {
  return touch({
    ...lib,
    journals: lib.journals.map((j) =>
      j.id === journalId
        ? { ...j, updatedAt: now(), issues: j.issues.map((i) => (i.id === issueId ? { ...i, ...patch, updatedAt: now() } : i)) }
        : j,
    ),
  })
}

export function removeIssue(lib: ContentLibrary, journalId: string, issueId: string): ContentLibrary {
  return touch({
    ...lib,
    journals: lib.journals.map((j) =>
      j.id === journalId ? { ...j, updatedAt: now(), issues: j.issues.filter((i) => i.id !== issueId) } : j,
    ),
  })
}

export function addArticle(
  lib: ContentLibrary,
  journalId: string,
  issueId: string,
  article: Omit<ArticleItem, 'id'>,
): ContentLibrary {
  const full: ArticleItem = { ...article, id: uid('art') }
  return touch({
    ...lib,
    journals: lib.journals.map((j) =>
      j.id === journalId
        ? {
            ...j,
            updatedAt: now(),
            issues: j.issues.map((i) => (i.id === issueId ? { ...i, articles: [...i.articles, full], updatedAt: now() } : i)),
          }
        : j,
    ),
  })
}

export function updateArticle(
  lib: ContentLibrary,
  journalId: string,
  issueId: string,
  articleId: string,
  patch: Partial<ArticleItem>,
): ContentLibrary {
  return touch({
    ...lib,
    journals: lib.journals.map((j) =>
      j.id === journalId
        ? {
            ...j,
            updatedAt: now(),
            issues: j.issues.map((i) =>
              i.id === issueId
                ? { ...i, updatedAt: now(), articles: i.articles.map((a) => (a.id === articleId ? { ...a, ...patch } : a)) }
                : i,
            ),
          }
        : j,
    ),
  })
}

export function removeArticle(lib: ContentLibrary, journalId: string, issueId: string, articleId: string): ContentLibrary {
  return touch({
    ...lib,
    journals: lib.journals.map((j) =>
      j.id === journalId
        ? {
            ...j,
            updatedAt: now(),
            issues: j.issues.map((i) =>
              i.id === issueId ? { ...i, updatedAt: now(), articles: i.articles.filter((a) => a.id !== articleId) } : i,
            ),
          }
        : j,
    ),
  })
}
