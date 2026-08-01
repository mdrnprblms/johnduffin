// Fills in `year` for artworks that have none, deriving it from the series
// label (e.g. "ETCHINGS 2017" -> 2017, "OILS AND ACRYLICS - 2001-2006" -> 2001).
// Only touches documents where year is currently missing — never overwrites a
// year that was parsed from the piece's own catalogue text.
//
// Usage: node --env-file=.env backfill-years.mjs [--dry-run]
import {createClient} from '@sanity/client'

const DRY_RUN = process.argv.includes('--dry-run')

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

// First 4-digit year in the label; for a range ("2001-2006", "1992-97",
// "2020 - 2021") that's the start year, which is where the series belongs
// on a chronological timeline.
export function yearFromSeries(series) {
  if (!series) return undefined
  const m = series.match(/\b(19|20)\d{2}\b/)
  if (!m) return undefined
  const year = Number(m[0])
  return year >= 1950 && year <= 2100 ? year : undefined
}

async function main() {
  const docs = await client.fetch('*[_type == "artwork" && !defined(year)]{_id, series, category}')
  console.log(`${docs.length} artworks without a year`)

  const resolvable = []
  const unresolved = []
  for (const doc of docs) {
    const year = yearFromSeries(doc.series)
    if (year) resolvable.push({...doc, year})
    else unresolved.push(doc)
  }

  console.log(`  ${resolvable.length} can be derived from the series label`)
  console.log(`  ${unresolved.length} have no year anywhere (left undated):`)
  for (const doc of unresolved) console.log(`     ${doc.category} | ${doc.series || '(no series)'}`)

  if (DRY_RUN) {
    console.log('\n--dry-run: no changes written.')
    return
  }

  let patched = 0
  let failed = 0
  const CONCURRENCY = 8
  let cursor = 0

  async function worker() {
    while (cursor < resolvable.length) {
      const doc = resolvable[cursor++]
      try {
        await client.patch(doc._id).set({year: doc.year}).commit()
        patched++
      } catch (err) {
        failed++
        console.error(`  FAILED ${doc._id}: ${err.message}`)
      }
    }
  }

  await Promise.all(Array.from({length: CONCURRENCY}, worker))
  console.log(`\nDONE. patched=${patched} failed=${failed} stillUndated=${unresolved.length}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
