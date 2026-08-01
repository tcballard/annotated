# annotated

A Chrome-sidebar-first product for keeping a moment, adding the meaning, and preserving the link back to the source.

## Run it

```bash
npm install
npm run dev:server # in a second terminal
npm run dev
```

Then open the local Vite URL. The Vite dev server proxies `/api` to `http://localhost:8787`. `npm run build` produces the production bundle; `npm start` serves the built app and API together.

## Current product slice

- Capture desk with a browser/source preview and sidebar capture flow
- Video, article, and podcast source modes
- 90-second clip selection for media sources
- Text annotation and browser-recorded audio commentary with bounded uploads
- Published annotation page with source citation and visible “File a claim” flow
- Public discovery feed with follow, like, comment, and share interactions
- Responsive desktop/mobile layouts with reduced-motion support
- Server-backed persistence for annotations, comments, and claims in `data/store.json`
- Source URL resolver with URL validation, source classification, metadata extraction, and SSRF-safe host checks
- Public annotation slugs and source citations
- Streamed audio asset storage with playable public audio-note URLs
- A Manifest V3 Chrome side panel in `extension/` that reads the active tab, captures a text selection, and publishes text annotations through the local API

OAuth, source media extraction/transcoding, durable object storage, social graph persistence, moderation operations, and production hosting are being added as separate product slices. The web audio note is real; YouTube/podcast clip derivatives are still the next worker boundary. To try the extension, start `npm run dev:server`, open `chrome://extensions`, enable Developer mode, choose “Load unpacked”, and select the `extension/` folder. See [PERFORMANCE.md](PERFORMANCE.md) for the Rust/media-worker migration plan.
