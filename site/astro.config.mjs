// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://mdrnprblms.github.io',
  base: '/johnduffin',
  // The dedicated for-sale page is now a toggle on the single catalogue page.
  // Redirect targets are emitted verbatim, so `base` has to be spelled out.
  redirects: {
    '/for-sale': '/johnduffin/portfolio?for-sale=1',
  },
});
