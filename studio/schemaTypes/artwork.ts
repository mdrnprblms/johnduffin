import {defineField, defineType} from 'sanity'

export const CATEGORIES = [
  {title: 'Oils', value: 'oils'},
  {title: 'Prints', value: 'prints'},
  {title: 'Pastels', value: 'pastels'},
  {title: 'Watercolours', value: 'watercolours'},
  {title: 'Drawings', value: 'drawings'},
]

export default defineType({
  name: 'artwork',
  title: 'Artwork',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'title', maxLength: 96},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {list: CATEGORIES, layout: 'radio'},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'series',
      title: 'Series / Collection',
      description: 'The original gallery grouping, e.g. "Drawings 1992-97"',
      type: 'string',
    }),
    defineField({
      name: 'year',
      title: 'Year',
      type: 'number',
    }),
    defineField({
      name: 'medium',
      title: 'Medium',
      description: 'e.g. Oil, Charcoal, Ink, Etching, Watercolour, Pastel',
      type: 'string',
    }),
    defineField({
      name: 'dimensions',
      title: 'Dimensions',
      type: 'string',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          {title: 'Available', value: 'available'},
          {title: 'Sold', value: 'sold'},
        ],
        layout: 'radio',
      },
      initialValue: 'available',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'price',
      title: 'Price',
      type: 'number',
      hidden: ({document}) => document?.status === 'sold',
    }),
    defineField({
      name: 'currency',
      title: 'Currency',
      type: 'string',
      initialValue: 'GBP',
      hidden: ({document}) => document?.status === 'sold',
    }),
    defineField({
      name: 'priceOnEnquiry',
      title: 'Price on enquiry',
      description: 'No fixed price listed — show "Enquire for price" instead of a number.',
      type: 'boolean',
      initialValue: false,
      hidden: ({document}) => document?.status === 'sold',
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      options: {hotspot: true},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      description: 'Raw catalogue text, kept verbatim from the original site.',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'order',
      title: 'Order',
      description: 'Position within its series, matching the original catalogue order.',
      type: 'number',
    }),
    defineField({
      name: 'sourceUrl',
      title: 'Source URL',
      description: 'Original page on johnduffin.co.uk, kept for reference.',
      type: 'url',
      readOnly: true,
    }),
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'series',
      media: 'image',
      status: 'status',
    },
    prepare({title, subtitle, media, status}) {
      return {
        title,
        subtitle: status === 'sold' ? `${subtitle ?? ''} · SOLD` : subtitle,
        media,
      }
    },
  },
})
