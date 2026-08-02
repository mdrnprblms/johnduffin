// Imports the scraped johnduffin.co.uk CV/info page (../output/info.json) into
// Sanity as the single `artistInfo` document (fixed _id, safe to re-run).
//
// Usage:
//   node --env-file=.env migrate-info.mjs
import {createClient} from '@sanity/client'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_PATH = path.join(ROOT, 'output', 'info.json')

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

async function main() {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf-8'))

  const doc = {
    _id: 'artistInfo',
    _type: 'artistInfo',
    ...data,
  }

  await client.createOrReplace(doc)
  console.log('DONE. artistInfo document imported.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
