# Query-native PostgreSQL migration

Migration `006_relational_core` projects the compatibility journal in
`annotated_records` into first-class PostgreSQL tables. Feed, source, profile,
notification, auth, claim, and media-job paths read those tables with bounded,
indexed queries. Writes retain the journal through the cutover window; a trigger
applies the same projection to old writers, while new repositories dual-write in
one transaction.

## Rollout

1. Snapshot PostgreSQL and retain the prior image.
2. Apply migrations while the old API is stopped. The migration creates tables,
   constraints, indexes, the compatibility trigger, and replays existing records.
3. Run `npm run check:relational-integrity`. Do not deploy on a count or field
   mismatch.
4. Deploy with `ANNOTATED_RELATIONAL_READS=legacy` for the comparison window.
   Exercise publish, comment, follow, like, OAuth, claim, and media processing;
   rerun the integrity check after each workload.
5. Remove that environment override to cut reads to relational repositories.
   Keep the compatibility journal and trigger for at least one backup cycle.
6. Run the concurrency and scale suites before increasing replicas. Compare API
   latency, queue pickup, dead-letter rate, and integrity output throughout.

## Rollback

Set `ANNOTATED_RELATIONAL_READS=legacy` and redeploy the prior image. Because
cutover writes update `annotated_records` transactionally, the previous readers
see the same committed state. A failed integrity check blocks rollback: restore
the pre-migration snapshot instead of selecting a journal known to have drifted.

Do not drop the compatibility trigger or `annotated_records` in this release.
That cleanup is a separate migration after the rollback window closes.
