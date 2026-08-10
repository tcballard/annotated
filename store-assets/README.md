# Chrome Web Store handoff

`store-listing.json` is the paste-ready, machine-checked record for the first
Annotated listing. It deliberately says `not-submitted`. The two checked-in
promotional images are ready; the three named screenshots must be captured by
a headed operator from Chrome's real native side-panel host after the packaged
browser gate passes. Do not copy the automation-tab evidence or replace the
screenshots with mockups.

Run the strict check after building the release artifact:

```bash
npm run build
node scripts/check-store-readiness.mjs
```

The strict command exits non-zero until every repository and external gate is
complete. During ordinary development, use the inventory mode to see the same
blockers without failing the shell:

```bash
node scripts/check-store-readiness.mjs --inventory
```

Use `--online` only when the canonical deployment should be reachable. It
checks the homepage, privacy policy, rights page, support URL, capability
manifest, provider-status endpoint, and extension CORS response. A listing can
never validate as `published` without a live, matching Chrome Web Store URL.
Pass `--receipt` (or `--receipt=<path>`) with `--online` to write the JSON
receipt consumed by release surfaces. Only a `verified` receipt whose item ID,
public URL, version, and artifact SHA match the listing is publication evidence;
a failed run writes `blocked` and must never enable a Store CTA.

When `listingState.status` becomes `published`, the protected
`Authoritative release evidence` workflow runs that online check and embeds
both the browser receipt and Store receipt in the final release bundle. The web
app promotes **Add to Chrome** only after `/api/capabilities` independently
rehashes both receipts and matches the item ID, public URL, version, commit,
artifact checksum, canonical origin, and deployed extension allowlist.

The Google and X provider callbacks terminate at the Annotated backend. The
Chrome item ID is used for the `chromiumapp.org` return leg and the backend CORS
and OAuth-return allowlists; this architecture does not use
`chrome.identity.getAuthToken` or require a Chrome Extension OAuth client.
