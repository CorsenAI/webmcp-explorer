# CMS and framework adapters

How WebMCP behaves, or would be exposed, on WordPress, Next.js, Astro, Ghost, Strapi,
Directus, Wagtail, MediaWiki, Shopify and others. **No verified findings yet**: every file
that lands here must come from a real installation, a fixture reproducing its behaviour, and
a finding in `../findings/`.

One file per platform (`wordpress.md`, `nextjs.md`, `astro.md`, `shopify.md`, …), each
structured as:

1. Where the platform puts scripts and how a tool registration reaches `document.modelContext`
   (bundler, hydration timing, islands, SSR versus client).
2. What a page of that platform looked like to the inspector (fixture + findings).
3. What an integration would need (hooks, plugin points), only if a prototype exists.

Reported facts without our own measurement are marked `reported`, as everywhere in this book.
The note in `docs/research/2026-09-04-webmcp-api-facts.md` that Shopify stores and Cloudflare
sites may serve an origin-trial token since August 2026 is exactly such a report: unverified.
