# Load reports

Committed, comparable output of the load harness in [`load/`](../../load/).
One file per run, named `<date>-<profile>.md`, all rendered from the same
template by `npm run load:report` so runs on different days diff cleanly.

Reports stamped **LOCAL DEVELOPMENT RUN** exercised the harness against
loopback and are never publishable evidence — the first committed report here
is exactly that: the worked example proving the pipeline. Publishable numbers
come from the disposable-environment procedure in
[`load/RUNBOOK.md`](../../load/RUNBOOK.md), repeated on a different day
before publishing. Budgets live in [`../PERFORMANCE.md`](../PERFORMANCE.md);
when a budget changes, it changes there first.
