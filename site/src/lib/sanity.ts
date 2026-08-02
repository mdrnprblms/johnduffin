import {createClient} from '@sanity/client'
import {createImageUrlBuilder, type SanityImageSource} from '@sanity/image-url'

const projectId = (import.meta.env.SANITY_PROJECT_ID || '').trim()
const dataset = (import.meta.env.SANITY_DATASET || '').trim() || 'production'

if (!projectId) {
  throw new Error(
    'Missing SANITY_PROJECT_ID env var. Copy site/.env.example to site/.env and fill it in.',
  )
}

export const sanityClient = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: true,
})

const builder = createImageUrlBuilder(sanityClient)

export function urlFor(source: SanityImageSource) {
  return builder.image(source)
}

export type ArtworkStatus = 'available' | 'sold'

export interface Artwork {
  _id: string
  title: string
  slug: string
  category: 'oils' | 'prints' | 'pastels' | 'watercolours' | 'drawings'
  series?: string
  seriesOrder?: number
  gallery?: string
  year?: number
  medium?: string
  dimensions?: string
  status: ArtworkStatus
  price?: number
  currency?: string
  priceOnEnquiry?: boolean
  image: SanityImageSource
  description?: string
  order?: number
}

export const ARTWORK_PROJECTION = `{
  _id,
  title,
  "slug": slug.current,
  category,
  series,
  seriesOrder,
  gallery,
  year,
  medium,
  dimensions,
  status,
  price,
  currency,
  priceOnEnquiry,
  image,
  description,
  order
}`

export async function getAllArtworks(): Promise<Artwork[]> {
  return sanityClient.fetch(
    `*[_type == "artwork"] | order(category asc, seriesOrder asc, order asc) ${ARTWORK_PROJECTION}`,
  )
}

export async function getArtworkBySlug(slug: string): Promise<Artwork | null> {
  return sanityClient.fetch(
    `*[_type == "artwork" && slug.current == $slug][0] ${ARTWORK_PROJECTION}`,
    {slug},
  )
}

export interface YearEntry {
  year?: string
  text: string
}

export interface ArtistInfo {
  portrait?: SanityImageSource
  rwsHeading?: string
  rwsBio?: string
  rwsSourceLabel?: string
  rwsSourceUrl?: string
  bioTimeline?: YearEntry[]
  awards?: YearEntry[]
  collections?: string[]
  soloExhibitions?: YearEntry[]
  groupExhibitions?: YearEntry[]
  publications?: YearEntry[]
  televisionRadio?: YearEntry[]
  commissionsText?: string
  contactEmail?: string
  contactPhone?: string
  links?: {label: string; url: string}[]
}

export async function getArtistInfo(): Promise<ArtistInfo | null> {
  return sanityClient.fetch(`*[_type == "artistInfo"][0]`)
}
