# Annotated UX direction

The source-first social-notebook direction treats Annotated as a polished
utility with the clarity of an early social timeline: identity, time, source,
context, and action stay close together without becoming a literal Facebook
clone or a nostalgia skin.

- **Material:** warm grey paper, off-white surfaces, charcoal ink, hairline
  rules, and very restrained depth. No grid texture, glass, gradients, or
  competing colour panels.
- **Palette:** muted slate, olive, faded blue, and dusty brick support the
  interface. One subdued terracotta signal marks selection, focus, progress,
  and publish. Status is written in words as well as colour.
- **Type:** Space Grotesk is reserved for compact headings and navigation; a
  readable sans carries controls; Georgia carries source excerpts and personal
  notes; DM Mono is reserved for timestamps, limits, and state labels.
- **Signature:** the source spine connects the original source, selected
  moment, annotation, and publication state. In capture it is the range and
  provenance rail; in the feed it becomes the chronological timeline; on
  mobile it collapses to a compact metadata strip.
- **Capture rule:** source preview, provenance, selection, note, and publish
  form one vertical decision path. The timeline is the primary gesture; compact
  start/end fields remain the precise keyboard fallback.
- **Timeline rule:** feed entries are chronological source-backed moments with
  author metadata, a clip/quote/audio block, the annotation, source link, and
  quiet social actions. The feed does not behave like a dashboard of featured
  cards.
- **Responsive rule:** desktop keeps source and note side by side; tablet
  narrows the note rail; mobile becomes one ordered capture path with 44px-safe
  controls and no hidden primary action. The Chrome side panel follows the same
  tokens and hierarchy.
- **Scroll rule:** there is one document scroll. The publish control may dock
  to the viewport edge, but no nested region owns the capture flow.
- **Recovery:** loading, offline, validation, audio retry, processing,
  unauthenticated, empty feed, empty published page, and moderation states use
  the same quiet surfaces and always name the next action.

This pass changes presentation, hierarchy, and copy only. API contracts,
persistence, media boundaries, and extension storage behavior remain
unchanged.
