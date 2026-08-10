# Privacy-safe product events

Annotated measures the activation path, not browsing history. The only accepted
event names are `extension_opened`, `source_resolved`, `draft_created`,
`auth_started`, `auth_completed`, `auth_cancelled`, `published`, `shared`,
`annotation_opened`, `original_opened`, and `publisher_inbox_opened`.

The ingestion contract rejects arbitrary event names and drops metadata outside
the explicit allowlist (`surface`, source/share type, auth provider, workspace,
result, and a coarse duration bucket). It never accepts passage text, note/audio
content, full URLs, general page views, or raw identity. Demo, test, bot, and
Do-Not-Track traffic is excluded. A persistent “Product metrics on/off” control
in the web footer provides an explicit local opt-out. Idempotency keys make
retries safe.

Events are retained for 90 days and exposed only as distinct-actor aggregate
counts from the bearer-protected operator funnel endpoint. Set
`PRODUCT_ANALYTICS_DISABLED=true` to disable collection entirely. Session replay
and general browsing analytics are intentionally out of scope.
