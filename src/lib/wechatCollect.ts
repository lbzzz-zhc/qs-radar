// 公众号标准科普采集：运行时读取 + 写回 GitHub 仓库（与内容资产库同一思路）
// 本地先做不可变变更，再由调用方统一 saveWechatDB 写回，避免频繁请求。
import type { WechatArticle, WechatCollectDB } from '../types'
import { decodeBase64, getContent, getRepo, putContent } from './github'

const DB_PATH = 'public/data/wechat-collect.json'
const BASE = import.meta.env.BASE_URL || '/'

function uid(p: string): string {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function now(): string {
  return new Date().toISOString()
}

function touch(db: WechatCollectDB): WechatCollectDB {
  return { ...db, updatedAt: now() }
}

/** 运行时读取（无需 token，任何人可看） */
export async function fetchWechatDB(): Promise<WechatCollectDB> {
  const res = await fetch(`${BASE}data/wechat-collect.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`标准科普采集库加载失败 HTTP ${res.status}`)
  return (await res.json()) as WechatCollectDB
}

/** 读取仓库中的最新内容（含 sha，用于写回） */
export async function fetchRemoteWechatDB(
  token: string,
): Promise<{ db: WechatCollectDB; sha: string } | null> {
  const repo = getRepo()
  const file = await getContent(repo, DB_PATH, token)
  if (!file) return null
  return { db: JSON.parse(decodeBase64(file.content)) as WechatCollectDB, sha: file.sha }
}

/** 写回仓库（处理 409 并发冲突：重新拉取 sha 后重试一次） */
export async function saveWechatDB(db: WechatCollectDB, token: string, sha?: string): Promise<string> {
  const repo = getRepo()
  const text = JSON.stringify(touch(db), null, 2)
  const message = `chore(wechat-collect): update via 质标雷达 ${now()}`
  try {
    return await putContent(repo, DB_PATH, text, message, token, sha)
  } catch (e) {
    if ((e as Error).message.includes('409')) {
      const remote = await fetchRemoteWechatDB(token)
      if (remote) return await putContent(repo, DB_PATH, text, message, token, remote.sha)
    }
    throw e
  }
}

// ============ 不可变变更助手（返回新 WechatCollectDB） ============

export function addWechatArticle(
  db: WechatCollectDB,
  a: Omit<WechatArticle, 'id' | 'fetchedAt'>,
): WechatCollectDB {
  const full: WechatArticle = { ...a, id: uid('wx'), fetchedAt: now() }
  return touch({ ...db, items: [full, ...db.items] })
}

export function updateWechatArticle(
  db: WechatCollectDB,
  id: string,
  patch: Partial<WechatArticle>,
): WechatCollectDB {
  return touch({
    ...db,
    items: db.items.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  })
}

export function removeWechatArticle(db: WechatCollectDB, id: string): WechatCollectDB {
  return touch({ ...db, items: db.items.filter((x) => x.id !== id) })
}
