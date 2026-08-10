# 质标雷达 · 微信草稿箱代理（Cloudflare Worker）

浏览器端无法直接调用微信公众号接口（CORS 拦截 + `appsecret` 不能暴露在前端），
因此用一个轻量 Cloudflare Worker 持有密钥并做代理：网页把文章 POST 给 Worker，
Worker 上传封面、把正文图片图床化、调用 `draft/add` 推到公众号**草稿箱**，
编辑到后台复核发布即可。

## 部署（一次性）

```bash
# 1. 安装并登录 wrangler（全局）
npm install -g wrangler
wrangler login

# 2. 写入密钥（仅存在 Cloudflare，不会进仓库）
wrangler secret put APPID      # 公众号 appid
wrangler secret put APPSECRET  # 公众号 appsecret

# 3. （可选）限制只允许你的 Pages 域名调用
#    编辑 wrangler.toml，取消 [vars] 注释并填 ALLOW_ORIGIN

# 4. 部署
wrangler deploy
```

部署成功后控制台会给出 `*.workers.dev` 地址，把它填到网页「同步」设置里的
**微信 Worker 地址** 即可。

## 接口

`POST <worker>/draft`

```json
{
  "title": "文章标题",
  "author": "作者",
  "digest": "摘要（<=120 字）",
  "content": "<p>正文 HTML，外链图片会自动上传到微信图床</p>",
  "coverUrl": "https://.../cover.jpg"
}
```

返回：`{ "ok": true, "media_id": "..." }` 或 `{ "ok": false, "error": "..." }`

## 前置条件

- 已**认证**的微信公众号（订阅号/服务号均可调用草稿箱接口）
- `appid` / `appsecret`（公众号后台「开发 → 基本配置」）
- 调用本 Worker 的服务器公网 IP 已加入公众号「IP 白名单」（仅当微信侧要求时）

## 备注

- `access_token` 在 Worker 实例内缓存约 2 小时，避免频繁换取。
- 仅做**单向推送**（内容库 → 草稿箱），不回拉已发布文章。
- 本地手动发布路线可改用 `wechat-publisher` 技能（wenyan-cli），无需此 Worker。
