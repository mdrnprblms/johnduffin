// Replaces the filename-derived `title` (e.g. "Tube-NightCharing-C#2C0056",
// "01") with the real artwork title. The old Photoshop gallery pages put the
// actual name on the first line of the caption, which we captured verbatim in
// `description` — that is the preferred source. Where that line is unusable
// (it sometimes holds a spill-over fragment of the series header), we fall
// back to stripping the trailing sequence/ID junk off the existing title.
//
// Usage: node --env-file=.env clean-titles.mjs [--dry-run] [--samples 40]
import {createClient} from '@sanity/client'

const DRY_RUN = process.argv.includes('--dry-run')
const sIdx = process.argv.indexOf('--samples')
const SAMPLES = sIdx !== -1 ? Number(process.argv[sIdx + 1]) : 25

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

const MEDIA_WORDS =
  /\b(OILS?|ACRYLICS?|ETCHINGS?|WATERCOLOURS?|PASTELS?|DRAWINGS?|LINOCUTS?|DIGITAL|LITHOGRAPHS?|CANVAS|PANEL|PAPER)\b/i

// The caption's first line is normally the artwork name, but on some pages the
// series header wrapped onto it instead ("- Canvas/Panel", "ACRYLICS ON PAPER
// - 1992-95", "Series - 1999-2005"). Those are shouty, start with a dash, or
// announce a date range; real titles are not.
export function isSeriesFragment(line) {
  const t = (line || '').trim()
  if (!t) return true
  if (/^[-–—]/.test(t)) return true
  if (/^series\b/i.test(t)) return true
  if (/^(19|20)\d{2}\s*[-–—]\s*(19|20)?\d{2}$/.test(t)) return true
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 4 && letters === letters.toUpperCase() && MEDIA_WORDS.test(t)) return true
  if (letters.length < 2) return true
  return false
}

// Caption lines carrying dimensions, price or a bare medium+year statement —
// never the artwork's name.
export function isCaptionMeta(line) {
  const t = (line || '').trim()
  if (!t) return true
  if (/£/.test(t)) return true
  if (/\d\s*x\s*\d/.test(t) && /(cm|inch|in\b)/i.test(t)) return true
  if (/^(oil|acrylics?|etching|watercolours?|pastel|charcoal|ink|linocut|pencil|cont[eé]|lithograph|digital|mixed media)\b/i.test(t) && /\b(19|20)\d{2}\b/.test(t)) {
    return true
  }
  return false
}

// Trailing catalogue refs: "#0002", "#2C0056", "0027", "20200002".
// Leading gallery prefixes: "A-", "WW-", "05" before a capitalised word.
export function stripRefs(raw) {
  let t = (raw || '').trim()
  t = t.replace(/\s*#[0-9A-Za-z]*\d+\s*$/, '')
  t = t.replace(/\s*\d{3,}\s*$/, '')
  t = t.replace(/^(?:[A-Z]{1,2}-)/, '')
  t = t.replace(/^\d{2}(?=[A-Z])/, '')
  // Slugged titles ("Shard-Night-Oil-201") read as words once de-hyphenated.
  if (!t.includes(' ') && (t.match(/-/g) || []).length >= 2) t = t.replace(/-/g, ' ')
  t = t.replace(/[\s\-–—,]+$/, '').replace(/\s+/g, ' ').trim()
  return t
}

const hasLetters = (s) => /[A-Za-z]/.test(s || '')

// Take the first caption line that is neither a wrapped series header nor a
// dimensions/price line. Only the first two are considered — beyond that the
// caption is always metadata, and guessing would do more harm than good.
export function captionTitle(description) {
  const lines = (description || '').split(' / ')
  for (const line of lines.slice(0, 2)) {
    if (isSeriesFragment(line) || isCaptionMeta(line)) continue
    const cleaned = stripRefs(line)
    if (cleaned.length >= 2 && hasLetters(cleaned)) return cleaned
  }
  return null
}

export function cleanTitle(doc) {
  const fromCaption = captionTitle(doc.description)
  if (fromCaption) return fromCaption
  const fromTitle = stripRefs(doc.title)
  // Never reduce a title to a bare number — keep the original instead.
  if (fromTitle.length >= 2 && hasLetters(fromTitle)) return fromTitle
  return (doc.title || '').trim()
}

async function main() {
  const docs = await client.fetch('*[_type == "artwork"]{_id, title, description}')
  console.log(`${docs.length} artworks\n`)

  const changes = []
  let unchanged = 0
  let fromCaption = 0
  let fromTitle = 0

  for (const doc of docs) {
    const next = cleanTitle(doc)
    if (captionTitle(doc.description)) fromCaption++
    else fromTitle++
    if (next && next !== doc.title) changes.push({...doc, next})
    else unchanged++
  }

  console.log(`source: caption first line = ${fromCaption}, fallback to filename = ${fromTitle}`)
  console.log(`changing ${changes.length}, unchanged ${unchanged}\n`)
  console.log(`--- ${Math.min(SAMPLES, changes.length)} samples ---`)
  for (const c of changes.slice(0, SAMPLES)) {
    console.log(`${JSON.stringify(c.title)}\n   -> ${JSON.stringify(c.next)}`)
  }

  const suspicious = changes.filter(
    (c) => c.next.length < 3 || /#/.test(c.next) || !hasLetters(c.next) || /^series\b/i.test(c.next),
  )
  console.log(`\n--- ${suspicious.length} suspicious results ---`)
  for (const c of suspicious.slice(0, 20)) console.log(`${JSON.stringify(c.title)} -> ${JSON.stringify(c.next)}`)

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
