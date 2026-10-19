# Run 006: bounded phase, workload and transport corrections

This is source preparation and local qualification. No signature produced by an
offline test is an owner approval. No cloud resource, monitoring policy, IAM
binding, real notification, paid timer or deployment is created by these files.
The effective 900-second bootstrap, two independent channels, $5 bootstrap
allowance, original 72-hour maximum, cumulative $300 ceiling, $30 cleanup reserve,
$100 checkpoint and six-hour active-work ceiling remain unchanged. The proposed
005 exceptions remain unapproved. Existing hosted numerical/runtime, Auth,
App Check, network, SQL ownership and cleanup gates remain required.

## One explicit diagnostic-to-serving transition

The starting full signed configuration must declare `phase: "diagnostic"`, contain
the fixed `hosted.nativeDiagnostic` numerical-only descriptor and its exact job,
and contain no serving service or ordinary `hosted.jobs`. The ledger records this
phase at original launch. An ordinary or unclassified old run cannot be
relabelled diagnostic to obtain a transition.

`Controller.transition_to_serving` accepts the next full configuration, its
ordinary execution approval and a separate Ed25519 phase-transition envelope.
The latter has protocol `bitestar.postgis-phase-transition.v1` and binds:

- Exact project ID/number, run ID and original first-billable/deadline milliseconds.
- Prior and next candidate/configuration digests, the next approval-envelope
  digest, and the reviewed native/build/source evidence digest.
- The only allowed transition: diagnostic to serving, sequence 1, with an
  explicit validity interval wholly inside the original resource deadline.

It uses the same separately supplied immutable public trust input and offline
verifier. Ordinary execution permission cannot authorize a transition. Forged,
noncanonical, mismatched, expired, replayed or later-sequence inputs refuse.
The next ordinary approval must independently include Gate 5 cleanup through
the original deadline and bounded reconciliation horizon.

Admission must already be paused. Every diagnostic workload resource must be
freshly observed absent; anything sent must have an exact owned receipt and
recorded absence for that incarnation. Pending cancellation/cleanup operations,
unknown creates, unresolved executions, 403s and missing responses cannot stand
in for absence. All next workload names are new single-use names; the union of
both plans remains at most 12 resources. This conservative transition tears down
and recreates SQL. It does not transfer an old SQL instance's ownership.

One generation-conditional write archives the complete prior configuration,
ledger, receipts and transition evidence. It changes the active artifact
identity while preserving run/project, original T0/deadline, incurred/reserved
cost, holding/delayed liabilities, operation counters, active seconds, all
reservation IDs/digests and phase spending. There are no refunds or timer resets.
A lost write response is reconciled by reading with the next configuration;
neither `start` nor a replay can create a successor run.

The next phase starts at `phase-awaiting-controls`. Its old candidate's passed
gates remain archived, while current `completedGates` becomes `[0]`. No new
candidate inherits old qualification. A receipt binding the new configuration,
candidate, original clock and transition evidence must establish the independent
watchdog loaded the new configuration, an actual safety action was observed and
alert delivery was proved. Only then can `begin-work` admit paid work. Refreshing
the control configuration and obtaining these proofs is future supervised work,
not a local source-test claim or an approved bootstrap extension.

The source CLI exposes `transition-serving` (request keys `nextConfiguration`,
`nextApproval`, `transitionApproval`, `evidenceDigest`) and
`confirm-phase-controls`. All execute actions still require explicit signed
inputs. Default dry-run performs no credential lookup or provider I/O.

SQL deletion retains its separate independent exclusivity evidence rules. An
old proof for an old candidate/name is not proof for a new SQL incarnation.
Only the evidence and its digest may change; the approval, exclusivity policy,
controller/watchdog principals and cleanup duties remain unchanged. Before the
transition write, the fresh proof must bind the next candidate, exact new SQL
name/resource plan and original clock. A genuine phase signature permits its
review timestamp to fall after T0 and no later than the transition instant.
Ordinary initial runs retain the existing pre-T0 evidence rule. Every subsequent
controller read re-verifies the archived phase signature at that original instant
before using this context; current execution or cleanup authority is verified
separately. Stale, forged or unbound proofs refuse, with no automatic downgrade
to supervised deletion. Actual creation still must establish a new exact
incarnation eligibility record. SQL has no atomic incarnation-delete condition;
the separate live ownership/name-registry proof remains necessary. These local
tests do not establish unattended readiness or replace automatic cleanup with
an overnight human response.

## Representative bounded source workload

`postgis_synthetic_workload.ts` writes fixed synthetic raw documents, then calls
the existing native projection/journal maintenance functions. It never inserts
fabricated SQL projections or copies production accounts. Saver participant IDs
and Score catalog IDs have separate roots. `count`, `offset` and the retained
`maxParentsPerInvocation` name use **pairs**: one Saver parent plus one independent
Score parent. Thus 25,000 pairs means 50,000 parent roots.

The deterministic data includes dense Miami, sparse coordinates and a national
grid; 0/1/2/3/10 and selected 100 children; restricted and Unlimited offers;
expired, scheduled, hidden and no-offer cases; Hoagie/Hamburger alias cases; and a
100-parent nearest cohort whose restricted offers can be supplied as consumed
guest history. `historyOfferOrdinals` describes client-owned synthetic history;
the seeder never writes real authentication, customer history or redemption
records. Edit, delete-offer, hide-parent and delete-parent plans reconcile the
known finite children through the same native writers.

Each immutable plan has an exact digest, offset/count no greater than the
existing 100,000-pair address space, at most 2,500 pairs per invocation, at most
32 invocations, at most 3,000,000 reserved logical source operations and 2 GiB
work/transfer allowance per invocation. Every invocation retains the platform's
600-second maximum and the runner stops starting work at its at-most-540-second
deadline. It checks authorization before subsequent native work. An interrupted
parent is deterministic and replayed before advancing its checkpoint.

A transactional single-writer lease prevents direct overlapping invocations.
Ordinary completion/error releases only the matching invocation. A simulated or
actual lost process leaves its lease until the captured invocation start plus
600 seconds, even when the caller chose a shorter work deadline. The same plan
can then resume using a new signed reservation; a different incomplete plan
cannot overtake it. A completed plan may be read again without new source writes.

The controller accepts a finite signed `runReservations` array (at most 32) for
the same immutable job. Each array position has one durable attempt and one POST;
lost responses never replay it. The next position requires the previous exact
execution to be terminal and all other jobs quiescent. Every prior run receipt
is archived; known completed execution UIDs cannot satisfy the next attempt's
reconciliation or cancellation-completion test. The original global 1,000
reservation cap remains. The controller checks that fixture reservations cover
the source read/write/delete bounds rather than accepting an underdeclared cost
plan. Repeated invocation is not an arbitrary job override or a load platform.

`postgisSyntheticWorkloadBudget` returns separate Saver/Score/root, offer, dish,
aggregate and raw-document counts, logical operation/byte allowances and required
invocations by work bounds. The per-parent allowance includes five native
transaction attempts, up to 12 reads and 8 writes per native reconciliation, raw
documents, checkpoint work and native deletes. The transaction source path has
at most 3 source/parent/aggregate reads, the old index and generation reads, and
the 3 journal-control/head/shard reads; its writes include the index, generation,
3 journal documents and optional parent catalog timestamp. These conservative
allowances are not measured provider billing, stored bytes or throughput.

Reserving all 32 maximum invocations uses 19,200 active seconds; other admitted
source/recovery/load work must fit the remaining 2,400 seconds of the same
21,600-second ledger. Control/watchdog and retained-resource charges still belong
in the unchanged whole-run cost/holding forecast. Neither this arithmetic nor
small emulator timings prove a large managed dataset finishes in that interval.
The exact planned dataset must fit its signed monetary phase allowance; the
earlier $15 diagnostic proposal is not approval for this serving workload.

## Actual Dart service-URL transport

`CustomerSearchHttpTransport` is an explicit injected transport for the unchanged
Saver and Score services. Its `call` tear-off sends the callable-compatible
`{data: ...}` envelope to an explicit HTTPS `*.run.app` origin and returns the
native `result`. An explicit test option permits only literal loopback HTTP.
It does not switch app defaults, rebuild navigation or change DTOs/identity.

An injected token supplier obtains current ID and optional App Check tokens per
call. The server still verifies identity/project, origin, App Check and request
contents. The transport follows no redirects, makes no automatic retries, bounds
request/response bytes and aborts after the whole-call deadline, including token
wait. Callable error codes reach the existing service error handling. Browser
CORS and real managed identity/network behavior remain separate future tests.

For a service also used by legacy profile, Saved or redemption operations, use
`withFallback(existingTransport)` so those unchanged routes keep their existing
transport. The module creates no default production Firebase client. Root's
actual local HTTP/Auth/Firestore/PostGIS Flutter harness uses this module rather
than a fabricated response transport; its evidence remains local, not Cloud Run.

## Three prepared notification conditions

The renderer retains two separately approved notification channels and creates
descriptors for watchdog failed completion, a structured safety-action log, and
zero/missing watchdog completions across a 900-second aligned interval. The latter
uses a 60-second retest window with `EVALUATION_MISSING_DATA_ACTIVE` and includes
all completion results. It needs an observed initial series/baseline and actual
delivery/drill validation. Late or never-initialized metrics are not a guaranteed
first-startup alarm, and silence detection is not automatic resource cleanup.
No relay, conditional SMS implementation or email-only policy exception is added.

Official API semantics checked 2026-10-19:
[Monitoring API](https://docs.cloud.google.com/monitoring/api/ref_v3/rpc/google.monitoring.v3)
and [metric alert behavior](https://docs.cloud.google.com/monitoring/alerts/concepts-indepth).
These documents support the descriptor fields and missing-data caveats, not a
claim of provider acceptance, real delivery or independent cleanup proof.
