# BiteStar PostGIS staging preparation

This is the source-only package for `BS-BITESTAR-POSTGIS-INTEGRATION-GATE0-001`.
It cannot provision, deploy, load, delete or change a cloud resource. No run ledger,
billable start time or 72-hour deadline has been created for a real staging run.
`config/staging.json` deliberately has no project, approval, recipients or image.
`gate0Ready`, `guardianTested` and `alertTested` remain false until independently
supported by their respective evidence. An offline test fixture is not that evidence.

The original October 1 staging package and its 45 verified files are recorded in
`provenance.json`. Its source, test evidence, database and original manifests are
preserved. The current package retains its resource limits, finite bootstrap fence,
owned-resource cleanup, independent watchdog draft and measured-result definitions.
It adds durable local reservation/restart checks and the explicit $100 owner checkpoint.

## No-cost commands

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tool/postgis_staging/scripts -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 tool/postgis_staging/scripts/guard.py --manifest tool/postgis_staging/candidate-manifest.v3.json
python3 tool/postgis_staging/scripts/price_worksheet.py
```

These commands use local synthetic fixtures only. The guard reports that hosted
execution is blocked. Its `--mode execute` option always refuses. Tests use temporary
SQLite files and do not modify historical evidence. The price worksheet reproduces
dated arithmetic and explicitly says current prices are unverified.
The manifest path is explicit: the guard never selects a newer version automatically.
Omitting `--manifest` retains the original `candidate-manifest.json` default.

`scripts/freeze.py` freezes an explicit source list and verifies it later. Include all
candidate source, contracts, schema, dependency locks, this package and relevant
tests in that list. It rejects paths outside the repository and credential/runtime
data. It refuses to replace an existing manifest: after an edit, requalify affected
behavior and save a new explicitly versioned manifest rather than silently changing
the qualified candidate. The readiness report must also bind the actual build/image,
runtime, configuration, dataset and test-evidence digests; a source hash alone does
not qualify a deployment.

```sh
python3 tool/postgis_staging/scripts/freeze.py --manifest /absolute/new-manifest.json --paths-file /absolute/exact-source-paths.txt
python3 tool/postgis_staging/scripts/freeze.py --manifest /absolute/new-manifest.json
```

## Before a separately approved paid run

1. Independently qualify the actual integrated source. Attach source/build/runtime/
   schema/config/fixture/evidence manifests. Verify protected consumer contracts,
   current ingestion/bootstrap, authority, paging and cleanup tests. Freeze the image;
   future main commits cannot replace it. Read `QUERY-TEST-PLAN.md` and the final run
   qualification report for exact coverage and any remaining Gate 0 blockers.
2. Obtain separate owner authorization with the exact nonproduction project ID and
   number, singleton allowlist, resource names, service identities, network details,
   recipient channels, spend/operation limits, phases and cleanup rights. Production
   project `coupon-app-29446` is rejected unconditionally, even if allowlisted.
   No ambient Firebase or gcloud project may select a target. No credentials belong
   in source, manifests, results or this package.
3. Refresh official Cloud SQL/Run/Firestore/network/storage/control pricing, region
   availability and runtime/extension support. The historical revised scenario was
   about $225.54 plus $30 cleanup reserve; $300 is a planning target, not authorization
   or a hard provider cap. Preserve the separate owner checkpoint before reaching
   $100 of conservatively forecast cost, including delayed charges, remaining
   holding time and cleanup reserve. Budget alerts alone cannot stop spend. Required
   recipients must acknowledge a real test alert through at least two suitable
   channels before unattended work.
4. Before the first possible billable action, a durable cloud controller must acquire
   a singleton generation/CAS record containing the original start and deadline.
   The local SQLite adapter proves atomic transitions on one host, not distributed
   cloud durability. Use conditional object generation or a transaction in the
   approved control store; retries must never reset the clock. A lost creation reply
   requires reconciliation of the exact name and creation identity, not another
   create. The eventual provider implementation and actual control receipts remain
   named prerequisites; this package contains no executable cloud adapter.
5. Under supervision, first test the independent Scheduler/Workflows watchdog, alert
   receipt, short-deadline stop/delete and asynchronous absence verification. Its
   immutable target URLs and ownership receipts are separate from the mutable app.
   A stale/future/malformed heartbeat pauses work; the original deadline still cleans
   up even if candidate/config approval expires. The renderer is a source draft, not
   a provider-validated deployment. Monitor missing watchdog success independently.
6. Stage only the separately built candidate adapter. Do not deploy the application's
   entire `index.ts`. Proposed Cloud SQL shape: Enterprise PostgreSQL 18, 4 CPU/16 GiB,
   100 GiB SSD, us-central1, zonal initially, private encrypted route, IAM database
   authentication, storage auto-resize disabled. Historical managed PostGIS 3.6.0
   differs from recovered local 3.6.3. Verify the actual server/extension versions and
   exact Linux numerical/runtime behavior before Gate 2. Local trust authentication
   must never be copied into the hosted service.
7. Generate only synthetic source data, retaining namespaces, seed and dimension
   manifest. Use real projection producers, an immutable bootstrap fence, public
   field checksums and bounded catch-up. Stop on missing/poison events, conflicting
   receipts or incomplete publication. Never call a partially copied catalog complete.
   Resume only with matching candidate, project/database, dataset, fence and progress.

## Execution gates and hard stops

| Gate | Required evidence before expanding |
|---|---|
| 0 | Local integration, correctness, authority, lifecycle and independent source review; exact frozen artifacts. No cloud spend. |
| 1 | Small actual hosted runtime/numerical/connection test; watchdog, alerts, shutdown and verified cleanup. |
| 2 | Small real Firestore ingestion/bootstrap/authority/replay chain and billing calibration, initially no more than 1,000 parents. |
| 3 | Dense 100/1,000/5,000/10,000 nearby parents, distinct coordinates and real child density; sparse and difficult queries. |
| 4 | National envelope up to one million synthetic parents, sustained concurrency, updates, retention and restart/restore. |
| 5 | Export raw evidence and digests, independent review, exact owned cleanup and retained-charge reconciliation. |

The historical maxima remain 72 hours from first possible billable action, six hours
active load, one million transport attempts, 100,000 useful pages, 200 million reads,
40 million writes and 30 million deletes. Phase allowances remain $15/$35/$100/$100
plus $30 reserved cleanup, inside the planning ceiling; they are not spending
permissions. Reserve upper costs before every batch, including failures/retries,
index-entry/minimum-query charges, delayed billing and the remaining idle lifetime.
The first limit stops work. The $100 checkpoint requires a new explicit owner
reference bound to this same candidate/config/run/deadline. It is not a timer reset.

Keep at most four service instances, four SQL pool connections each and eight
reserved connections (24 total). Requests and SQL operations need bounded timeouts,
load jobs have 600-second maximum runtime and zero automatic job retries. Stop on
correctness/authority failures, unjustified incomplete results, unbounded queues,
storage/WAL growth, missing accounting, repeated noncompletion or memory/pool limits.
Record storage before each batch and reserve projected growth below the approved
capacity. Do not automatically enlarge SQL, storage, instances or test allowances.

## Useful-result and failure evidence

Each intent keeps one ID and monotonic start time from original user interaction.
Continuation, backoff, restart and guest challenge round trips keep that same clock.
Record (a) first nonempty proved/authority-valid prefix actually rendered and (b) the
target useful page: normally 25 distinct valid cards or terminal exhausted smaller
result; Finder uses its real eight-suggestion contract. Preserve suppression and
partial/hasMore flags. Empty interim responses, errors and abandoned requests cannot
be counted as fast useful pages. True exhausted zero-match results are a separate
legitimate-empty category.

Per homogeneous cell record all attempts, errors, retries, noncompletion, exact data
dimensions/hashes, cold/warm status, original elapsed-to-render, SQL and authority
operations, pool peak, RSS, lag, progress and storage. An independent ordered oracle
runs outside timing. Do not pool unrelated queries to manufacture tail samples.
The proposed hosted targets remain warm p95 <=2s, p99 <=4s and cold <=4s, subject to
the owner's established acceptance. Use at least 1,000 comparable observations plus
all failures for p95, and aim for 10,000 for p99; small local samples are observations.
Report completion fractions within 2s/4s and success-only percentiles separately.
Real Flutter rendering is distinct from API and SQL microbenchmark timing.

## Recovery, teardown and retention

Persist reservations before execution, including failed/lost replies. Exact replay
confirms accounting but never grants another execution; reconcile provider state.
`LocalLedger.compare_and_set` rejects stale writers and changes to the original
clock or identity. Its local failure tests are not cloud proof. Record finite source
fences, bootstraps, accepted guest answers, publication and revision leases; cleanup
must not reclaim any revision required by a still-valid cursor.

Pause admissions before recovery; retain source/outbox receipts and replay from
verified progress. A restored SQL image with inconsistent authority/source progress
must fail closed until reconciled. Never restore production data into staging.

Teardown reads and matches exact project, full resource name, run label and immutable
UID/createTime. An allowlisted name alone cannot authorize deletion of a replacement.
Use provider preconditions where available and a provisioning fence otherwise.
Export continuously, stop exact load executions, then remove only approved owned
SQL/restore/service/disposable Firestore resources. Verify asynchronous completion
and absence. Preserve enough independent control to detect incomplete cleanup.

Inventory backups/PITR and retained objects separately; deletion does not prove zero
remaining charges. No retained/final backup is planned for disposable data. Proposed
evidence/control <=5 GiB and images <=2 GiB expire after seven days, with asynchronous
deletion verified and cost reserved. Exact cleanup of load jobs, registry, buckets,
private network and control resources needs its own ownership receipts and eventual
provider adapter. Never use wildcard deletion, broad project shutdown, shared
billing disablement or production IAM changes. Record unresolved resources/costs.

## Local recovery evidence

Recovered prototype source manifest: `0ef7d8d30c7ab69d332e60218ad691b430996bfe28ee49574f9c5edb7e0aaa04`
(204/204 files matched). Evidence manifest:
`2d86003d97af22db8a6d3842a8b8b829a3b94684906bf74c6eaf0db0c9d127c8`
(367/367 matched). Staging package manifest:
`1aebf5a69cb3c81bd5360e51d519e4cf31e3264bea57a0dc7cf2ad19da9c3a0b`
(45/45 matched). Its historical 296 prototype checks and 32 safety checks are reused
as historical evidence, separate from tests run against the current integration.

The original runtime is retained outside the repository. A new task-owned loopback
cluster at `127.0.0.1:55441`, database/user `bsgate0`, was initialized under the current
run report directory without touching the original cluster. PostgreSQL 18.6,
PostGIS 3.6.3, pg_trgm 1.6 and fuzzystrmatch 1.2 were observed locally. The report must
record which actual integrated tests used this cluster and when it was stopped.

## Executable local integration

`functions/src/postgis_staging_runtime.ts` composes actual Firestore searchable
projection maintenance, the durable source journal, the PostgreSQL read model,
native membership and customer handlers. Its factory requires exactly one explicit
`demo-bs-postgis-*` project, both loopback Firestore/Auth emulators, the approved
local PostgreSQL database namespace and explicit synthetic 32-byte keys. Importing
the module registers nothing. Production `index.ts` does not export the candidate.

`registerCallables()` returns the eight V2 search callables plus the existing
FavoriteStates, Menu and preparation-only redemption-validation handlers used by
the real consumer. `registerSourceTriggers()` returns the six exact source-write
bindings and the existing bounded index-job continuation. Both factories remain
inert until explicitly called; no deployment, secret lookup, IAM change or scheduler
is performed. The native verified-actor/cursor context and source snapshot reader
are shared with legacy runtime wrappers, preserving their established behavior.

`startLocalPostgisHttpHost()` listens only on IPv4 loopback and implements callable
JSON transport (`POST /<name>`, `{data: ...}`, `{result: ...}` or safe `{error: ...}`).
The Admin SDK verifies Auth emulator ID tokens from `Authorization: Bearer ...`;
guest requests have no token. Raw payload UIDs and custom bypass headers never
grant identity. This is a real HTTP/native-handler qualification path, separate
from proof of the hosted Functions transport. It accepts at most four concurrent
requests and a 512 KiB request, rejects browser Origin requests, and exposes no raw
SQL exceptions. Call `maintainLifecycle()` explicitly for a bounded binding/SQL
cleanup pass; it activates no timer. Snapshot export/prune/restore remain explicit
operator recovery actions and use the validated artifact reader.

The reproducible fixture host is `functions/test/support/postgis_flutter_host.cjs`.
It uses dedicated project `demo-bs-postgis-flutter`, database `bsgate0_flutter`,
Firestore `127.0.0.1:8088`, Auth `127.0.0.1:9099` and HTTP `127.0.0.1:8188`.
It writes synthetic raw sources, invokes actual projection maintenance, enrolls
the source and publishes only after complete catch-up. Its default fixture has
35 Saver parents, 60 offers, 30 Score parents and 60 dishes (185 projections),
including five Saver parents with no offers. Restart reconciles those same owned
fixture IDs and does not reset a shared database. Use the recovered qualified Node
executable and a fresh task-owned PostgreSQL cluster; never the retained old cluster.

From `functions/`, after separately starting only local emulators and creating the
dedicated local database:

```sh
BS_POSTGIS_FLUTTER_HOST=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 "$BS_POSTGIS_NODE" test/support/postgis_flutter_host.cjs
```

The Auth emulator may be started using an isolated report-directory Firebase
configuration with only its loopback auth port; never use the production Firebase
configuration for this harness. An alternate demo project's synthetic user can be
created and signed in through emulator `accounts:signUp` and
`accounts:signInWithPassword`, supplying `targetProjectId` and the emulator's
synthetic owner header. The resulting emulator-issued token is then verified by
the real HTTP host. Never print or save tokens in qualification output.

Numerical tests require the exact qualified Node binary, no `NODE_OPTIONS` and
only the original approved runtime flags. Node's isolated test child process adds
unqualified V8 flags, so use the explicit local qualification commands:

```sh
BS_POSTGIS_RUNTIME_TEST=1 "$BS_POSTGIS_NODE" --test --test-isolation=none test/postgis_staging_runtime.test.js
BS_POSTGIS_SQL_TEST=1 "$BS_POSTGIS_NODE" --test --test-isolation=none test/postgis_query.test.js
```

Ordinary test runs keep the numerical tests opt-in; this does not weaken the
runtime guard. `postgis_integration.test.js` additionally exercises real source,
Firestore, Auth, HTTP, SQL and native authority in its own demo project/database.
Actual Flutter widget qualification is in
`test/services/postgis_flutter_integration_test.dart`, using the real local host.

`functions/test/support/postgis_api_benchmark.cjs` runs 100 independent synthetic
Score clients and 100 Finder clients, four at a time, after five excluded warmups
per scenario. Opt in with `BS_POSTGIS_LOCAL_API_BENCHMARK=1` and provide an exact
`BS_POSTGIS_LOCAL_API_REPORT` file path. Its timing starts before admission and ends
only at a complete useful native page, including errors/retries. It records actual
sample arrays and empirical p50/p95/p99. These 100-sample local API tails do not
establish the hosted thresholds or Flutter rendering, and the host is already warm.

Future approved hosted execution still needs its own exact isolated project,
least-privilege identities/secrets, Linux runtime qualification, secure Cloud SQL
connector and durable provider control adapter. Do not relax this local factory's
demo/loopback guard to obtain a hosted pass. Preserve these local tests and qualify
a separately explicit hosted adapter during the approved compatibility gate.
