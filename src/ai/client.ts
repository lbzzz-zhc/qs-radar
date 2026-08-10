/**
 * AI 接入层 —— OpenAI 兼容协议客户端
 *
 * 安全设计：API Key 仅存于浏览器 localStorage，请求由浏览器直连模型厂商，
 * 不经过任何中间服务器，本项目不收集、不上传任何密钥。
 */
import type { AIConfig } from '../types'

export class AIError extends Error {}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 常见服务商预设，方便用户一键切换 */
export const AI_PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
]

function assertConfig(cfg: AIConfig) {
  if (!cfg.apiKey?.trim()) throw new AIError('未配置 API Key。点击右上角「AI 设置」填写后即可使用。')
  if (!cfg.baseUrl?.trim()) throw new AIError('未配置 API 地址。')
  if (!cfg.model?.trim()) throw new AIError('未配置模型名称。')
}

/** 非流式调用 */
export async function chat(cfg: AIConfig, messages: ChatMessage[], signal?: AbortSignal) {
  assertConfig(cfg)
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      stream: false,
    }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    if (res.status === 401) throw new AIError('API Key 无效或已过期（401）。')
    if (res.status === 429) throw new AIError('请求过于频繁或额度不足（429）。')
    throw new AIError(`模型服务返回 ${res.status}：${txt.slice(0, 220)}`)
  }

  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new AIError('模型返回结构异常，未取到 content。')
  return content
}

/** 流式调用，逐段回调 */
export async function chatStream(
  cfg: AIConfig,
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
) {
  assertConfig(cfg)
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      stream: true,
    }),
  })

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '')
    if (res.status === 401) throw new AIError('API Key 无效或已过期（401）。')
    throw new AIError(`模型服务返回 ${res.status}：${txt.slice(0, 220)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta = json?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          full += delta
          onDelta(delta)
        }
      } catch {
        /* 忽略心跳与非法分片 */
      }
    }
  }
  return full
}

/** 从模型输出中稳健提取 JSON（模型常带 ```json 包裹或前后废话） */
export function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.search(/[[{]/)
  if (start < 0) throw new AIError('模型输出中未找到 JSON 结构。')

  // 从第一个括号开始做括号配对，容忍尾部多余文本
  const open = candidate[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1)) as T
      }
    }
  }
  throw new AIError('模型输出的 JSON 不完整。')
}
