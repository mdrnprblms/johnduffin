// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://mdrnprblms.github.io',
  base: '/johnduffin',
  // The dedicated for-sale page is gone — the single catalogue page now
  // defaults to showing only work that's for sale. Redirect targets are
  // emitted verbatim, so `base` has to be spelled out.
  redirects: {
    '/for-sale': '/johnduffin/portfolio',
  },
});
