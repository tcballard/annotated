# Annotated deployment boundary

The container is deliberately configuration-only: it does not contain provider credentials, database credentials, source media, or a local production data directory.

Before starting a production container:

1. Load `DATABASE_URL`, `ANNOTATED_STORAGE=postgres`, and the Google/X OAuth values from the deployment secret manager.
2. Load `ANNOTATED_ASSET_STORAGE=s3`, the S3/R2 bucket/endpoint/credentials, `PUBLIC_ORIGIN`, and a non-wildcard `CORS_ORIGIN`.
3. Run `npm run db:migrate` from the same release artifact against the target database.
4. Start the container and require `/api/ready` to return 200 before routing traffic.
5. Verify a real OAuth callback, source resolution, media upload, feed write, and claim review in the deployed environment.

Backups and recovery are external operational gates: take a PostgreSQL snapshot before migrations, retain object-store versioning/retention for published assets, and keep the prior image available for rollback. A failed readiness check must remove the instance from service; do not fall back to the file adapter in production.

The Docker image installs FFmpeg. It intentionally does not pretend that a provider extractor is present; install/pin `yt-dlp` in a reviewed worker-image extension and verify the actual runtime before enabling YouTube/podcast jobs.
