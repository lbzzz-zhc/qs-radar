// 质标雷达 · 微信草稿箱代理（Cloudflare Worker）
// 浏览器端无法直接调用微信接口（CORS 拦截 + appsecret 不可暴露在前端），
// 故由本 Worker 持有 APPID/APPSECRET 并代理请求。
//
// 部署：
//   wrangler login
//   wrangler secret put APPID      # 公众号 appid
//   wrangler secret put APPSECRET  # 公众号 appsecret
//   wrangler deploy
//
// 接口：
//   POST /draft
//   body: { title:string, author?:string, digest?:string, content:string(HTML), coverUrl?:string }
//   成功：{ ok:true, media_id }
//   失败：{ ok:false, error }
//
// 说明：封面图经 material/add_material 上传取 thumb_media_id；
//       正文 HTML 中的外链 <img> 也会上传到微信图床并替换 src，确保公众号内能正常显示。

let tokenCache = { token: null, expireAt: 0 }

async function getToken(env) {
  const now = Date.now()
  if (tokenCache.token && tokenCache.expireAt > now + 60_000) return tokenCache.token
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${env.APPID}&secret=${env.APPSECRET}`
  const r = await fetch(url)
  const d = await r.json()
  if (d.errcode) throw new Error(`access_token 失败 ${d.errcode}:${d.errmsg}`)
  tokenCache = { token: d.access_token, expireAt: now + (d.expires_in || 7200) * 1000 }
  return d.access_token
}

async function uploadImage(token, imageUrl) {
  const r = await fetch(imageUrl)
  if (!r.ok) throw new Error(`图片下载失败 HTTP ${r.status}`)
  const buf = await r.arrayBuffer()
  const form = new FormData()
  form.append('media', new Blob([buf], { type: r.headers.get('content-type') || 'image/jpeg' }), 'cover.jpg')
  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`, {
    method: 'POST',
    body: form,
  })
  const d = await res.json()
  if (d.errcode) throw new Error(`素材上传失败 ${d.errcode}:${d.errmsg}`)
  return { media_id: d.media_id, url: d.url }
}

// 把正文 HTML 里的外链图片上传到微信图床并替换 src
async function processContent(token, html) {
  if (!html) return html
  const urls = [...new Set((html.match(/src="([^"]+)"/g) || []).map((s) => s.slice(5, -1)))]
  for (const u of urls) {
    if (!/^https?:\/\//.test(u)) continue
    try {
      const { url } = await uploadImage(token, u)
      if (url) html = html.split(u).join(url)
    } catch (e) {
      console.warn('图片上传跳过:', u, e.message)
    }
  }
  return html
}

function cors(allowOrigin) {
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const allow = env.ALLOW_ORIGIN || '*'
    const allowOrigin = allow === '*' ? origin || '*' : allow

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(allowOrigin) })
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), {
        status: 405,
        headers: { ...cors(allowOrigin), 'Content-Type': 'application/json' },
      })
    }

    const url = new URL(request.url)
    if (url.pathname !== '/draft') {
      return new Response(JSON.stringify({ ok: false, error: 'Not Found' }), {
        status: 404,
        headers: { ...cors(allowOrigin), 'Content-Type': 'application/json' },
      })
    }

    try {
      const { title, author = '', digest = '', content = '', coverUrl } = await request.json()
      if (!title) throw new Error('title 必填')

      const token = await getToken(env)

      let thumb_media_id = ''
      if (coverUrl) {
        const cover = await uploadImage(token, coverUrl)
        thumb_media_id = cover.media_id
      }

      const finalContent = await processContent(token, content)

      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articles: [
            {
              title,
              author,
              digest: String(digest).slice(0, 120),
              content: finalContent || `<p>${title}</p>`,
              thumb_media_id,
              need_open_comment: 0,
              only_fans_can_comment: 0,
            },
          ],
        }),
      })
      const d = await res.json()
      if (d.errcode) throw new Error(`draft/add 失败 ${d.errcode}:${d.errmsg}`)

      return new Response(JSON.stringify({ ok: true, media_id: d.media_id }), {
        status: 200,
        headers: { ...cors(allowOrigin), 'Content-Type': 'application/json' },
      })
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: (e && e.message) || String(e) }), {
        status: 200,
        headers: { ...cors(allowOrigin), 'Content-Type': 'application/json' },
      })
    }
  },
}
