# Publisher and creator workspace

`/publisher` lets an authenticated source owner create a one-day DNS TXT
challenge at `_annotated.<domain>`. The server resolves the record itself and
compares only its SHA-256 digest; a client-supplied token cannot verify a domain.
Verification is revocable and every successful verification creates an immutable
audit entry.

Workspace access is membership-scoped (`owner`, `editor`, or `analyst`). The
inbox contains annotations whose normalized source host exactly matches the
verified domain, attached claims, hosted-artifact status, reply counts, and
privacy-safe aggregate original-open counts. A verified reply is labelled and
pinned by the client, but workspace members cannot edit, hide, remove, or rank a
reader's criticism. Takedowns continue through the existing claims workflow so
object deletion and the public tombstone remain auditable.

The current verification surface supports DNS TXT. The schema reserves explicit
RSS, HTML-file, and channel-token methods for later adapters without weakening
the challenge lifecycle.
