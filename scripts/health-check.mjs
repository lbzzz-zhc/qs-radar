#!/usr/bin/env node
/**
 * 信源健康自检 —— 政务站点改版是常态，这个脚本用来快速定位「哪个源挂了」。
 * 建议每周手动跑一次，或由 Actions 在抓取失败时自动触发。
 *
 * 用法：node scripts/health-check.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from './lib/http.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/** 探针：URL + 期望特征 */
const PROBES = [
  {
    id: 'samr-std-gb',
    name: '全国标准信息公共服务平台 · 国标接口',
    url: 'https://std.samr.gov.cn/gb/search/gbQueryPage?searchText=&pageSize=2&pageNumber=1',
    expect: (t) => t.includes('"rows"') && t.includes('C_STD_CODE'),
  },
  {
    id: 'samr-std-hb',
    name: '全国标准信息公共服务平台 · 行标接口',
    url: 'https://std.samr.gov.cn/hb/search/hbPage?searchText=&pageSize=2&pageNumber=1',
    expect: (t) => t.includes('"rows"'),
  },
  {
    id: 'openstd-gb',
    name: '国家标准全文公开系统',
    url: 'https://openstd.samr.gov.cn/bzgk/gb/std_list_type?p.p1=1&p.p90=circulation_date&p.p91=desc&p.p2=',
    expect: (t) => t.includes('showInfo('),
  },
  {
    id: 'samr-inspection',
    name: '市场监管总局 · 抽检公告',
    url: 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/spcjs/',
    expect: (t) => t.length > 3000,
  },
  {
    id: 'ttbz-group',
    name: '全国团体标准信息平台',
    url: 'https://www.ttbz.org.cn/Home/Standard',
    expect: (t) => t.length > 3000,
  },
  {
    id: 'tbt-notification',
    name: 'TBT 通报（ePing）',
    url: 'https://epingalert.org/en/Search/Index?domain=TBT',
    expect: (t) => t.length > 2000,
  },
]

const results = []
console.log('质标雷达 · 信源健康自检\n')

for (const p of PROBES) {
  const t0 = Date.now()
  try {
    const res = await request(p.url, { timeout: 20000, retries: 1 })
    const text = await res.text()
    const ok = p.expect(text)
    const dur = Date.now() - t0
    results.push({ id: p.id, name: p.name, ok, status: res.status, durationMs: dur })
    console.log(
      `${ok ? '✓' : '⚠'} ${p.name.padEnd(34)} HTTP ${res.status}  ${dur}ms  ${
        ok ? '' : '← 响应可达但结构已变，需更新适配器解析逻辑'
      }`,
    )
  } catch (e) {
    results.push({ id: p.id, name: p.name, ok: false, error: e.message, durationMs: Date.now() - t0 })
    console.log(`✗ ${p.name.padEnd(34)} ${String(e.message).slice(0, 70)}`)
  }
}

const okN = results.filter((r) => r.ok).length
console.log(`\n健康信源 ${okN}/${results.length}`)

await fs.writeFile(
  path.join(ROOT, 'public', 'data', 'source-health.json'),
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
  'utf8',
)
console.log('报告已写入 public/data/source-health.json')

if (okN === 0) process.exit(1)
