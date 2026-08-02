import {defineField, defineType} from 'sanity'

const yearEntry = {
  type: 'object',
  fields: [
    defineField({name: 'year', title: 'Year', type: 'string'}),
    defineField({name: 'text', title: 'Text', type: 'string'}),
  ],
  preview: {
    select: {year: 'year', text: 'text'},
    prepare({year, text}: {year?: string; text?: string}) {
      return {title: year ? `${year} — ${text}` : text}
    },
  },
}

export default defineType({
  name: 'artistInfo',
  title: 'Artist Info',
  type: 'document',
  fields: [
    defineField({
      name: 'bioTimeline',
      title: 'Biography / timeline',
      type: 'array',
      of: [yearEntry],
    }),
    defineField({
      name: 'awards',
      title: 'Awards',
      type: 'array',
      of: [yearEntry],
    }),
    defineField({
      name: 'collections',
      title: 'Collections',
      description: 'Institutions holding work in their permanent collection.',
      type: 'array',
      of: [{type: 'string'}],
    }),
    defineField({
      name: 'soloExhibitions',
      title: 'Solo exhibitions',
      type: 'array',
      of: [yearEntry],
    }),
    defineField({
      name: 'groupExhibitions',
      title: 'Selected group exhibitions',
      type: 'array',
      of: [yearEntry],
    }),
    defineField({
      name: 'publications',
      title: 'Publications',
      type: 'array',
      of: [yearEntry],
    }),
    defineField({
      name: 'televisionRadio',
      title: 'Television and radio',
      type: 'array',
      of: [yearEntry],
    }),
    defineField({
      name: 'commissionsText',
      title: 'Commissions blurb',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'contactEmail',
      title: 'Contact email',
      type: 'string',
    }),
    defineField({
      name: 'contactPhone',
      title: 'Contact phone',
      type: 'string',
    }),
    defineField({
      name: 'links',
      title: 'Links',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({name: 'label', title: 'Label', type: 'string'}),
            defineField({name: 'url', title: 'URL', type: 'url'}),
          ],
        },
      ],
    }),
  ],
  preview: {
    prepare() {
      return {title: 'Artist Info'}
    },
  },
})
