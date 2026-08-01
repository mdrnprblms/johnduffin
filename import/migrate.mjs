// Imports the scraped johnduffin.co.uk catalogue (../output/data.json + ../output/images)
// into Sanity as `artwork` documents. Safe to re-run: uses a deterministic _id per record
// (derived from the original source URL) and skips documents that already exist unless
// --force is passed.
//
// Usage:
//   node --env-file=.env migrate.mjs            # import everything not already imported
//   node --env-file=.env migrate.mjs --limit 5   # only process the first 5 records (dry run)
//   node --env-file=.env migrate.mjs --force     # re-upload images + overwrite existing docs
import {createClient} from '@sanity/client'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readFile, stat} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_PATH = path.join(ROOT, 'output', 'data.json')
const IMAGES_DIR = path.join(ROOT, 'output', 'images')

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity
const CONCURRENCY = 5

const {SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_TOKEN} = process.env
if (!SANITY_PROJECT_ID || !SANITY_API_TOKEN) {
  console.error('Missing SANITY_PROJECT_ID and/or SANITY_API_TOKEN. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

const client = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  token: SANITY_API_TOKEN,
  useCdn: false,
})

const MEDIUM_KEYWORDS = [
  'Etching', 'Linocut', 'Digital Print', 'Charcoal', 'Watercolour', 'Pastel', 'Acrylic', 'Ink', 'Oil',
]

export function docIdFor(sourceUrl) {
  return 'artwork-' + createHash('sha1').update(sourceUrl).digest('hex').slice(0, 16)
}

export function slugify(input) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function cleanSeries(seriesTitle) {
  if (!seriesTitle) return undefined
  return seriesTitle.replace(/^JOHN\s+DUFFIN\s*-\s*/i, '').trim() || undefined
}

export function extractYear(text) {
  const m = text.match(/\b(19|20)\d{2}\b/)
  return m ? Number(m[0]) : undefined
}

export function extractMedium(text) {
  const found = MEDIUM_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(text))
  return found.length ? found.join(' / ') : undefined
}

export function extractPrice(prices) {
  if (!prices || !prices.length) return undefined
  const m = prices[0].match(/[\d,]+(?:\.\d{2})?/)
  if (!m) return undefined
  const value = Number(m[0].replace(/,/g, ''))
  return Number.isFinite(value) ? value : undefined
}

function buildOrderMap(records) {
  const counters = new Map()
  const orders = new Map()
  for (const r of records) {
    const key = `${r.category}::${r.gallery}`
    const next = (counters.get(key) || 0) + 1
    counters.set(key, next)
    orders.set(r.source_page_url, next)
  }
  return orders
}

async function withRetry(fn, label, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      console.warn(`  retry ${i}/${attempts} failed for ${label}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 800 * i))
    }
  }
  throw lastErr
}

export function toDoc(record, order) {
  const id = docIdFor(record.source_page_url)
  const slug = `${slugify(record.page_title || record.series_title || id)}-${id.slice(-6)}`
  const status = record.sold ? 'sold' : 'available'
  const price = status === 'available' ? extractPrice(record.prices) : undefined
  const rawText = record.raw_text || ''

  const doc = {
    _id: id,
    _type: 'artwork',
    title: record.page_title || record.series_title || 'Untitled',
    slug: {_type: 'slug', current: slug},
    category: record.category,
    series: cleanSeries(record.series_title),
    year: extractYear(rawText),
    medium: extractMedium(rawText),
    dimensions: (record.dimensions && record.dimensions[0]) || undefined,
    status,
    currency: status === 'available' ? 'GBP' : undefined,
    price,
    priceOnEnquiry: status === 'available' && price === undefined ? true : undefined,
    description: rawText || undefined,
    order,
    sourceUrl: record.source_page_url,
  }
  return doc
}

async function importRecord(record, order) {
  const doc = toDoc(record, order)

  if (!record.image_local_path) {
    console.warn(`  SKIP (no image): ${doc.sourceUrl}`)
    return 'skipped'
  }
  const imagePath = path.join(IMAGES_DIR, record.image_local_path)
  try {
    await stat(imagePath)
  } catch {
    console.warn(`  SKIP (image file missing on disk): ${imagePath}`)
    return 'skipped'
  }

  const asset = await withRetry(
    () => client.assets.upload('image', createReadStream(imagePath), {filename: path.basename(imagePath)}),
    `upload ${record.image_local_path}`,
  )

  doc.image = {_type: 'image', asset: {_type: 'reference', _ref: asset._id}}

  await withRetry(() => client.createOrReplace(doc), `document ${doc._id}`)
  return 'imported'
}

async function main() {
  const records = JSON.parse(await readFile(DATA_PATH, 'utf-8'))
  const orderMap = buildOrderMap(records)

  let toProcess = records
  if (!FORCE) {
    console.log('Checking for already-imported documents...')
    const existingIds = new Set(await client.fetch(`*[_type == "artwork"]._id`))
    toProcess = records.filter((r) => !existingIds.has(docIdFor(r.source_page_url)))
    console.log(`${existingIds.size} already imported, ${toProcess.length} remaining.`)
  }

  toProcess = toProcess.slice(0, LIMIT)
  console.log(`Importing ${toProcess.length} record(s)${FORCE ? ' (force mode)' : ''}...`)

  let imported = 0
  let skipped = 0
  let failed = 0
  let done = 0

  let cursor = 0
  async function worker() {
    while (cursor < toProcess.length) {
      const record = toProcess[cursor++]
      const order = orderMap.get(record.source_page_url)
      try {
        const result = await importRecord(record, order)
        if (result === 'imported') imported++
        else skipped++
      } catch (err) {
        failed++
        console.error(`  FAILED: ${record.source_page_url}: ${err.message}`)
      } finally {
        done++
        if (done % 25 === 0 || done === toProcess.length) {
          console.log(`Progress: ${done}/${toProcess.length} (imported=${imported} skipped=${skipped} failed=${failed})`)
        }
      }
    }
  }

  await Promise.all(Array.from({length: Math.min(CONCURRENCY, toProcess.length)}, worker))

  console.log(`\nDONE. imported=${imported} skipped=${skipped} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
