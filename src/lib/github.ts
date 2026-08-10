// GitHub REST 助手：把内容资产库持久化回仓库（充当「后台数据库」）
// 浏览器端通过团队 Personal Access Token 调用 Contents API（无需自建服务器）。

const API = 'https://api.github.com'

export interface GithubRepo {
  owner: string
  repo: string
}

/** 固定为本项目仓库；如需泛化可改为设置项 */
export function getRepo(): GithubRepo {
  return { owner: 'lbzzz-zhc', repo: 'qs-radar' }
}

async function ghFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 240)}`)
  }
  return res
}

export interface ContentFile {
  content: string // base64
  sha: string
}

/** 读取仓库内文件（base64 + sha）；不存在返回 null */
export async function getContent(
  repo: GithubRepo,
  path: string,
  token: string,
): Promise<ContentFile | null> {
  try {
    const res = await ghFetch(`/repos/${repo.owner}/${repo.repo}/contents/${encodeURI(path)}`, token)
    const json = await res.json()
    return { content: json.content, sha: json.sha }
  } catch (e) {
    if ((e as Error).message.includes('404')) return null
    throw e
  }
}

/** 写入/更新仓库内「文本」文件（UTF-8），返回新 sha */
export async function putContent(
  repo: GithubRepo,
  path: string,
  text: string,
  message: string,
  token: string,
  sha?: string,
): Promise<string> {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(text))),
    ...(sha ? { sha } : {}),
  }
  const res = await ghFetch(`/repos/${repo.owner}/${repo.repo}/contents/${encodeURI(path)}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return json.content?.sha || sha || ''
}

/** 上传「二进制」文件（如 PDF），返回 blob sha */
export async function putBinary(
  repo: GithubRepo,
  path: string,
  bytes: Uint8Array,
  message: string,
  token: string,
  sha?: string,
): Promise<{ sha: string }> {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)
  const body = { message, content: b64, ...(sha ? { sha } : {}) }
  const res = await ghFetch(`/repos/${repo.owner}/${repo.repo}/contents/${encodeURI(path)}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return { sha: json.content?.sha || sha || '' }
}

/** 把 GitHub 返回的 base64（可能含换行）解码为文本 */
export function decodeBase64(b64: string): string {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))))
}
