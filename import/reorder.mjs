// Patches order/seriesOrder/gallery onto already-imported artwork documents,
// using the corrected values in output/data.json (see scripts/derive_order.py).
// Does NOT touch images or any other field — cheap, no re-uploads.
import {createClient} from '@sanity/client'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {docIdFor} from './migrate.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_PATH = path.join(ROOT, 'output', 'data.json')

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

const CONCURRENCY = 8

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

async function main() {
  const records = JSON.parse(await readFile(DATA_PATH, 'utf-8'))

  let done = 0
  let patched = 0
  let failed = 0
  let cursor = 0

  async function worker() {
    while (cursor < records.length) {
      const record = records[cursor++]
      const id = docIdFor(record.source_page_url)
      try {
        await withRetry(
          () =>
            client
              .patch(id)
              .set({order: record.order, seriesOrder: record.series_order, gallery: record.gallery})
              .commit({autoGenerateArrayKeys: true}),
          `patch ${id}`,
        )
        patched++
      } catch (err) {
        failed++
        console.error(`  FAILED: ${id} (${record.source_page_url}): ${err.message}`)
      } finally {
        done++
        if (done % 100 === 0 || done === records.length) {
          console.log(`Progress: ${done}/${records.length} (patched=${patched} failed=${failed})`)
        }
      }
    }
  }

  await Promise.all(Array.from({length: CONCURRENCY}, worker))
  console.log(`\nDONE. patched=${patched} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
