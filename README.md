# annotated — prototype

A self-contained, browser-based prototype for the annotated.com concept: a Chrome-sidebar-first way to keep a moment, add the meaning, and preserve the link back to the source.

## Run it

```bash
npm install
npm run dev
```

Then open the local Vite URL. `npm run build` produces the production bundle.

## Included in this pass

- Capture desk with a browser/source preview and sidebar capture flow
- Video, article, and podcast source modes
- 90-second clip selection for media sources
- Text annotation and simulated audio annotation modes
- Published annotation page with source citation and visible “File a claim” flow
- Public discovery feed with follow, like, comment, and share interactions
- Responsive desktop/mobile layouts with reduced-motion support
- Local persistence for the draft and published state
- A loadable Manifest V3 Chrome side-panel shell in `extension/`

This is intentionally a frontend-first prototype: OAuth, media extraction/transcoding, server persistence, the social graph, and production hosting are the next integration layer. To try the extension shell, open `chrome://extensions`, enable Developer mode, choose “Load unpacked”, and select the `extension/` folder.
