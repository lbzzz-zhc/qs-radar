/**
 * 抓取层 HTTP 工具：超时 / 重试 / 退避 / 伪装 UA
 * GitHub Actions runner 位于境外，访问国内政务站点存在高延迟与偶发阻断，
 * 因此所有请求默认 3 次重试 + 指数退避，且失败以异常抛出交由上层降级处理。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export class FetchError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'FetchError'
    this.status = status
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {string} url
 * @param {{timeout?:number, retries?:number, headers?:Record<string,string>, method?:string, body?:any, referer?:string}} opts
 */
export async function request(url, opts = {}) {
  const {
    timeout = 25000,
    retries = 3,
    headers = {},
    method = 'GET',
    body,
    referer,
  } = opts

  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/json,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...(referer ? { Referer: referer } : {}),
          ...headers,
        },
      })
      clearTimeout(timer)
      if (!res.ok) throw new FetchError(`HTTP ${res.status} ${url}`, res.status)
      return res
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      // 4xx（除 429）不重试，属于确定性失败
      if (err instanceof FetchError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err
      }
      if (attempt < retries) {
        const backoff = 1200 * Math.pow(2, attempt) + Math.random() * 600
        await sleep(backoff)
      }
    }
  }
  throw lastErr
}

export async function getJSON(url, opts = {}) {
  const res = await request(url, {
    ...opts,
    headers: { Accept: 'application/json, text/plain, */*', ...(opts.headers || {}) },
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new FetchError(`响应非合法 JSON（前 120 字符）：${text.slice(0, 120)}`)
  }
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts)
  const buf = Buffer.from(await res.arrayBuffer())
  const ct = res.headers.get('content-type') || ''
  // 政务站点仍有大量 GBK 编码页面
  if (/gb2312|gbk/i.test(ct)) {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return buf.toString('utf8')
    }
  }
  const utf8 = buf.toString('utf8')
  // 无 charset 声明时，用替换字符比例判断是否实为 GBK
  if (!/charset/i.test(ct)) {
    const bad = (utf8.match(/\uFFFD/g) || []).length
    if (bad > 8) {
      try {
        return new TextDecoder('gbk').decode(buf)
      } catch {
        /* ignore */
      }
    }
  }
  return utf8
}

/** 依次尝试多个候选 URL，返回第一个成功的结果。用于应对政务站点改版换路径。 */
export async function tryUrls(urls, fetcher, opts = {}) {
  const errors = []
  for (const u of urls) {
    try {
      const data = await fetcher(u, { retries: 1, ...opts })
      return { url: u, data }
    } catch (e) {
      errors.push(`${u} → ${e.message}`)
    }
  }
  throw new FetchError(`全部候选路径均失败：\n${errors.join('\n')}`)
}
