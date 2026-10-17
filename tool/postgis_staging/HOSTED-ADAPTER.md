# Hosted adapter preparation

The concrete adapter, callable transport, IAM/private networking requirements and
local qualification limits are documented in [hosted/README.md](hosted/README.md).
The reproducible, still-unexecuted Linux package is in [linux/README.md](linux/README.md).
The default production index and existing local runtime guards remain unchanged.

For the limited synthetic Gate1 investigation, one explicitly approved bounded
job is the sole fixture writer. No out-of-band source edits are admitted. The
separate `postgis_hosted_job_entrypoint.ts` executes the exact named entry in
`configuration.hosted.jobs`; it accepts no arbitrary mutation payload, path or
SQL. `hosted/render-job.cjs` emits its actual Cloud Run job body, with the same
immutable candidate image, exact IAM principal, private route, zero retries,
one task, one parallel task and600-second maximum. The controller serializes
all approved workload jobs; the primary plus restore pools use the eight reserved
connections, while at most sixteen application connections remain possible.
Controller admission requires approval through the reserved task duration. At
container start, the job independently verifies that its signed execution window
still covers the full600-second platform maximum before reading keys or opening
credentials, so a delayed provider start cannot consume an expired window.

Approved actions are initialize, fixture, enroll, catchup, lifecycle, snapshot,
restore and prune. Enrollment/catchup/restore process up to the signed maxPages
(default8, maximum64) and stop after540 seconds; durable native checkpoints retain
unfinished work. Each fixture batch has a fixed offset/count/time/operation,
creates at most25 pairs of independent synthetic Saver/Score IDs, and passes raw
records through the existing maintenance writers and atomic projection journal.
The fixed fixture supports seed, same-ID offer edit, offer deletion and parent
hide. Its pending marker blocks enrollment/publication/snapshot until native
reconciliation completes. A repeated completed batch is inert; replay of an
interrupted batch reconciles its exact deterministic records. A failed provider
job still requires controller reconciliation and a separately reserved retry
job identity; it is not automatically rerun.

Initialize the source/schema, run the synthetic batch, enroll, then catch up to
its finite fence before serving any test searches. Future mutation batches and
catch-up must remain serialized; stop load while a batch is incomplete. Snapshot
uses the approved GCS store and exact published SQL revision. Restore uses only
the separately named fresh derived database. Prune requires retained GCS bytes
and source acknowledgment, preserving the established count/hash/fence checks.
Each action has its own signed reservation/count/cost plan in provider.resources.
Completion of one bounded invocation is not automatically a completed bootstrap,
restored database, gate PASS or permission for additional work.

`createHostedPostgisRuntime.registerSourceTriggers()` remains an optional inert
factory reusing the seven native search maintenance handlers. It is not deployed
or consumed by this limited sole-writer job composition. Production or general
multiwriter rollout would require separately approved trigger deployment,
permissions and qualification; no such readiness is claimed here.

All tests in this run are offline/injected contracts or explicitly isolated local
emulator tests. No real project, resource window, hosted credentials or spend has
been activated. The previous frozen local Gate0 PASS remains intact; Linux and
real hosted proof remain unverified.
