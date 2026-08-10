# Exact-source graph and receipts

Source identity is derived from a canonical URL after removing fragments,
credentials, default ports, common campaign parameters, and `utm_*`/Matomo
tracking values. Query ordering is stable. The canonical digest `src_…` identifier
is the public graph key; host hubs remain a broader discovery surface.

`GET /api/sources/exact/:sourceId` returns cursor-paginated public annotations,
typed relations (`supports`, `challenges`, `adds_context`, `corrects`, or the
neutral `response`), overlapping media ranges, and evidence receipts. Receipts
are built from persisted facts: exact text-quote anchors or clip ranges plus the
stored artifact's MIME type, byte count, SHA-256, resolution, FFprobe result,
verification time, and rights state. Unknown facts stay `null` or “pending”; the
API does not infer them from UI claims.

The primary action remains Open original. `/source/:sourceId`, permalink cards,
share descriptors, embeds, QR links, and operator events all carry the same
source identifier.
