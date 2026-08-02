# Annotated UX direction

The v0.1.0 UX pass treats Annotated as a quiet annotation desk: the source
gets the visual weight, the note gets the only strong action, and everything
else stays legible but quiet.

- **Material:** warm paper and a restrained ink surface; no grid texture,
  ornamental shadows, or competing colour panels.
- **Type:** Space Grotesk carries navigation and action labels; Georgia carries
  the source language and annotation copy; DM Mono is reserved for metadata,
  limits, and state labels.
- **Signal:** coral is the only active signal. It marks selection, focus,
  progress, and the publish affordance. Status is also written in words, so it
  is not communicated by colour alone.
- **Signature:** the source spine (source preview, range/highlight selection,
  annotation field, publish action) stays visible as one continuous desk. The
  Chrome side panel follows the same spine in its narrower native surface.
- **Responsive rule:** desktop keeps source and note side by side; tablet
  reduces the rail; mobile becomes one ordered capture path with 44px-safe
  controls and no hidden primary action.
- **Recovery:** loading, offline, validation, audio retry, empty feed, empty
  published page, and moderation states use the same quiet surfaces and always
  name the next action.

The pass changes presentation and copy only. API contracts, persistence, media
boundaries, and extension storage behavior remain unchanged.
