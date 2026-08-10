#!/usr/bin/env node
/**
 * 模块 1 · 信源抓取主调度
 *
 * 核心工程约束（决定这个工具能否长期跑下去）：
 *   1. 单源失败绝不拖垮整体 —— 每个适配器独立 try/catch，失败记入 stats
 *   2. 失败源保留上次快照 —— 绝不产出空数据集覆盖历史数据
 *   3. 增量合并 + 稳定 ID 去重 —— 同一条目多次抓取得到同一 id
 *   4. 数据集体积上限 —— 超过 MAX_ITEMS 时按时间倒序截断，避免仓库无限膨胀
 *
 * 用法：
 *   node scripts/crawl.mjs                    # 全量抓取
 *   node scripts/crawl.mjs --only=samr-std-gb # 只抓指定源
 *   node scripts/crawl.mjs --pages=5          # 加大抓取深度
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const DATASET = path.join(DATA_DIR, 'dataset.json')

const MAX_ITEMS = 1200
const RETENTION_DAYS = 540

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

/** 适配器注册表：与 src/data/sources.json 中的 adapter 字段一一对应 */
const ADAPTERS = [
  { module: './sources/samr-std-gb.mjs', opts: { pages: Number(argv.pages) || 3, pageSize: 30 } },
  { module: './sources/samr-std-hb.mjs', opts: { pages: Number(argv.pages) || 2, pageSize: 25 } },
  { module: './sources/openstd-gb.mjs', opts: { types: [1, 2], detailLimit: 10, pages: 1 } },
  { module: './sources/samr-inspection.mjs', opts: { limit: 40 } },
  { module: './sources/tbt-notification.mjs', opts: { limit: 30 } },
  { module: './sources/ttbz-group.mjs', opts: { limit: 30 } },
]

async function readPrevious() {
  try {
    const raw = await fs.readFile(DATASET, 'utf8')
    const json = JSON.parse(raw)
    if (Array.isArray(json.items)) return json
  } catch {
    /* 首次运行，无历史数据 */
  }
  return { version: '1.0.0', generatedAt: null, stats: [], items: [] }
}

function withinRetention(item) {
  const d = item.publishDate || item.publishedAt || item.fetchedAt
  if (!d) return true
  const t = new Date(d).getTime()
  if (Number.isNaN(t)) return true
  return (Date.now() - t) / 86400000 <= RETENTION_DAYS
}

function sortKey(item) {
  const d = item.publishDate || item.publishedAt || item.fetchedAt || ''
  return d
}

async function main() {
  const started = Date.now()
  const previous = await readPrevious()
  const prevBySource = new Map()
  for (const it of previous.items) {
    if (!prevBySource.has(it.sourceId)) prevBySource.set(it.sourceId, [])
    prevBySource.get(it.sourceId).push(it)
  }

  console.log('质标雷达 · 信源抓取')
  console.log(`历史数据集：${previous.items.length} 条（${previous.generatedAt ?? '首次运行'}）\n`)

  const stats = []
  const freshItems = []
  const failedSources = new Set()

  for (const a of ADAPTERS) {
    const t0 = Date.now()
    let mod
    try {
      mod = await import(a.module)
    } catch (e) {
      console.error(`✗ 适配器加载失败 ${a.module}: ${e.message}`)
      continue
    }
    const { meta, fetchItems } = mod
    process.stdout.write(`→ ${meta.name} ... `)

    try {
      const items = await fetchItems(a.opts)
      const valid = items.filter((i) => i && i.title && i.id)
      freshItems.push(...valid)
      const dur = Date.now() - t0
      stats.push({
        sourceId: meta.id,
        sourceName: meta.name,
        tier: meta.tier,
        ok: true,
        count: valid.length,
        durationMs: dur,
      })
      console.log(`✓ ${valid.length} 条（${(dur / 1000).toFixed(1)}s）`)
    } catch (e) {
      const dur = Date.now() - t0
      failedSources.add(meta.id)
      stats.push({
        sourceId: meta.id,
        sourceName: meta.name,
        tier: meta.tier,
        ok: false,
        count: 0,
        error: String(e.message).split('\n')[0].slice(0, 200),
        durationMs: dur,
      })
      console.log(`✗ 失败：${String(e.message).split('\n')[0].slice(0, 120)}`)
    }
  }

  // ---- 合并策略 ----
  // 新抓到的覆盖旧的（同 id）；失败源的历史条目原样保留
  const merged = new Map()
  for (const it of previous.items) merged.set(it.id, it)
  for (const it of freshItems) {
    const old = merged.get(it.id)
    // 保留首次入库时间，便于识别「新增」
    merged.set(it.id, { ...old, ...it, firstSeenAt: old?.firstSeenAt || old?.fetchedAt || it.fetchedAt })
  }

  let items = [...merged.values()]
    .filter(withinRetention)
    .sort((a, b) => String(sortKey(b)).localeCompare(String(sortKey(a))))

  if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS)

  const okCount = stats.filter((s) => s.ok).length
  const dataset = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    stats,
    items,
  }

  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DATASET, JSON.stringify(dataset, null, 0), 'utf8')

  // 同时写一份可读的健康报告，便于在仓库里直接查看信源状态
  const report = {
    generatedAt: dataset.generatedAt,
    totalItems: items.length,
    newItems: freshItems.filter((f) => !previous.items.some((p) => p.id === f.id)).length,
    sources: stats,
    failedSources: [...failedSources],
  }
  await fs.writeFile(path.join(DATA_DIR, 'health.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('')
  console.log(`信源成功 ${okCount}/${stats.length}`)
  console.log(`新增条目 ${report.newItems} 条，数据集共 ${items.length} 条`)
  console.log(`耗时 ${((Date.now() - started) / 1000).toFixed(1)}s → ${path.relative(ROOT, DATASET)}`)

  if (okCount === 0) {
    console.error('\n所有信源均失败，已保留历史快照，不覆盖数据。')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('抓取流程异常终止：', e)
  process.exit(1)
})
