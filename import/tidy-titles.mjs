// Second title pass: the old caption format ran "<Title> <medium> <year>"
// together on one line, so recovered titles still carry a trailing medium
// and/or date ("Out of reach watercolour 1999", "Battersea Oil 2013"), plus
// fragments where the source truncated mid-word ("KIng's Cross Rain O").
// Both are already held in the `medium` and `year` fields, so stripping them
// from the title loses nothing.
//
// Usage: node --env-file=.env tidy-titles.mjs [--dry-run] [--samples 40]
import {createClient} from '@sanity/client'

const DRY_RUN = process.argv.includes('--dry-run')
const sIdx = process.argv.indexOf('--samples')
const SAMPLES = sIdx !== -1 ? Number(process.argv[sIdx + 1]) : 30

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

const YEAR = /\s*\(?\b(?:19|20)\d{2}\s*(?:[-–—/]\s*\d{2,4})?\)?\s*$/
const MEDIUM =
  /\s+(?:mixed media|monotype|lithographs?|linocuts?|etchings?|watercolours?|acrylics?|charcoals?|pastels?|pencils?|cont[eé]|drawings?|oils?|inks?)\s*$/i
const JOINER = /\s+(?:and|&|on paper|on canvas|on panel|on board)\s*$/i
// Only fragments that can only be the head of a medium word — never a word in
// its own right, so they are safe to drop.
const FRAGMENT = /\s+(?:O|Oi|Pa|Pas|Ch|Cha|Char|Charc|Wat|Wate|Etch|Etc|Acr|Acry|Lith|Cont|Penc|Mono|In)\s*$/

const hasLetters = (s) => /[A-Za-z]/.test(s || '')

export function tidy(raw) {
  let t = (raw || '').trim()
  // Peel repeatedly: "Monotype and Watercolour 1999" needs several passes.
  for (let i = 0; i < 6; i++) {
    const before = t
    t = t.replace(YEAR, '')
    t = t.replace(MEDIUM, '')
    t = t.replace(JOINER, '')
    t = t.replace(FRAGMENT, '')
    t = t.replace(/[\s,\-–—]+$/, '')
    if (t === before) break
  }
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

export function safeTidy(title) {
  const next = tidy(title)
  // Never let a title collapse to nothing or to a bare number.
  if (next.length < 2 || !hasLetters(next)) return title
  return next
}

async function main() {
  const docs = await client.fetch('*[_type == "artwork"]{_id, title}')
  const changes = []
  for (const doc of docs) {
    const next = safeTidy(doc.title)
    if (next !== doc.title) changes.push({...doc, next})
  }

  console.log(`${docs.length} artworks, ${changes.length} titles to tidy\n`)
  console.log(`--- ${Math.min(SAMPLES, changes.length)} samples ---`)
  for (const c of changes.slice(0, SAMPLES)) {
    console.log(`${JSON.stringify(c.title)}\n   -> ${JSON.stringify(c.next)}`)
  }

  const short = changes.filter((c) => c.next.length <= 3)
  console.log(`\n--- ${short.length} very short results ---`)
  for (const c of short.slice(0, 20)) console.log(`${JSON.stringify(c.title)} -> ${JSON.stringify(c.next)}`)

  const stillNumeric = changes.filter((c) => /\b(19|20)\d{2}\s*$/.test(c.next))
  console.log(`--- ${stillNumeric.length} still ending in a year ---`)

  if (DRY_RUN) {
    console.log('\n--dry-run: no changes written.')
    return
  }

  let patched = 0
  let failed = 0
  let cursor = 0
  async function worker() {
    while (cursor < changes.length) {
      const c = changes[cursor++]
      try {
        await client.patch(c._id).set({title: c.next}).commit()
        patched++
      } catch (err) {
        failed++
        console.error(`  FAILED ${c._id}: ${err.message}`)
      }
    }
  }
  await Promise.all(Array.from({length: 8}, worker))
  console.log(`\nDONE. patched=${patched} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
