# Local source integration and repeatable qualification

The production entry point does not export the candidate. `BITESTAR_POSTGIS_SEARCH`
is false unless explicitly selected in an isolated client build/test. Production
projection writers still use their existing adapter without a PostGIS source epoch.
No production configuration, Rules, deployment, Auth provider or runtime flag changes
are part of this package.

## Actual execution path

`postgis_staging_runtime.ts` is inert on import. Its local factory requires an exact
`demo-bs-postgis-*` project allowlist, loopback Firestore and Auth emulators, explicit
synthetic keys, and a loopback `bsgate0*` database. It constructs the real authority
adapter, source-enabled existing projection maintenance, SQL store, native membership
provider and V2 native search handlers. Its explicit registration factories provide:

- Eight discovery callables for Saver and Score; Finder uses Score criteria.
- Existing FavoriteStates, Menu and redemption-preparation handlers for continuity.
- Six source-write bindings plus the existing bounded projection-job continuation.

Source paths are `restaurant_accounts/{id}`, its `coupons/{id}` and
`daily_specials/{id}`, `bitescore_restaurants/{id}`, `bitescore_dishes/{id}` and
`dish_rating_aggregates/{id}`. Parent fanout uses `private_search_index_jobs/{id}`.
The source-enabled adapter journals the actual projection mutation in that same
Firestore transaction, including cleanup tombstones. No cross-database transaction
is implied. All staging writers must use this adapter/epoch before enrollment.

Enroll existing eligible projections in bounded pages, then repeatedly call
`PostgisReadModel.catchUp()` until its finite captured target passes exact count/XOR
verification and publishes. Missing or poisoned events block publication. A later
trusted repair/delete may extend a fully received poisoned target only through the
explicit `resumeAfterSourceRepair()` operation. New admission refuses source lag;
existing pinned sessions retain their original membership and current authority.

SQL returns membership only. Native Firestore handlers still validate raw source,
current visibility/availability, guest history, signed usage, opaque identities,
occurrences and delivered grants. Each guest challenge remains capped at 75 IDs.
Native private result documents are cached only for the requested bounded page so
existing Menu/profile/usage boundaries continue to work. No raw account/customer
roots are copied to SQL. Only allowlisted searchable projection fields cross over.

## Local tools and commands

The qualification used the retained PostgreSQL 18.6/PostGIS 3.6.3 runtime, pg_trgm 1.6,
fuzzystrmatch 1.2 and Node 24.21.0/V8 13.6.233.17-node.53 on macOS arm64. The exact
Node executable SHA-256 is recorded in `postgis_runtime.ts`. Other platforms,
binaries or unqualified V8 options fail closed. Node's process-isolated test runner
synthesizes additional flags, so the opted-in SQL/runtime tests use
`--test-isolation=none`. Do not relax the numerical guard just to run a test.

Set `BS_NODE` to the qualified Node binary and run the TypeScript build before tests:

```sh
"$BS_NODE" functions/node_modules/typescript/bin/tsc -p functions
BS_POSTGIS_SQL_TEST=1 "$BS_NODE" --test --test-isolation=none functions/test/postgis_query.test.js
BS_POSTGIS_RUNTIME_TEST=1 "$BS_NODE" --test --test-isolation=none functions/test/postgis_staging_runtime.test.js
```

The real integration fixtures require the local Postgres service at 127.0.0.1:55441,
Firestore emulator at 127.0.0.1:8088, and Auth emulator at 127.0.0.1:9099. Read each
fixture's exact opt-in/project/database guard before running. They use dedicated
synthetic `bsgate0_*` databases and `demo-bs-postgis-*` projects; several deliberately
reset/drop their own synthetic database. Never point them at a shared dataset or
an original proof database. Never run simultaneous fixtures against the same target.

`postgis_integration.test.js` executes real HTTP, verifies real Auth-emulator tokens,
uses actual maintenance/journal/SQL and exercises the native customer protocols.
`postgis_snapshot_integration.test.js` exports external files, prunes acknowledged
source events, deletes its original derived database, restores a fresh one in bounded
pages, resumes interruption and replays a later source edit.
`postgis_cleanup.test.js` checks bounded SQL and Firestore retention.
Source-emulator tests separately exercise transactional enrollment and outbox races.
Pure/native tests and in-memory-provider tests are identified as such in the report.

For actual Flutter rendering, start the explicitly guarded local fixture host in
`functions/test/support/postgis_flutter_host.cjs`. It uses its own 185-projection
synthetic dataset at `demo-bs-postgis-flutter` / `bsgate0_flutter`. It prints only its
loopback URL and nonsecret metadata. The widget test injects only HTTP transport;
responses come from the real native handlers, Firestore/Auth emulators and PostGIS.

```sh
flutter test --no-pub \
  --dart-define=BS_POSTGIS_HTTP_URL=http://127.0.0.1:8188 \
  --dart-define=BS_POSTGIS_UI_EVIDENCE=/absolute/local/ui-evidence.json \
  test/services/postgis_flutter_integration_test.dart
```

No URL means these four network tests skip; that is not an integration pass. Every
run uses fresh synthetic guest client IDs so fixture reseeding cannot reuse an old
session created by a previous binary. The normal client still handles a genuinely
changed/expired session through its existing Fresh Search action. The test records
first useful rendered content and all legitimate protocol continuations/yields.
Its small sample count cannot establish hosted p95/p99 or physical-device latency.

The separate opted-in `postgis_api_benchmark.cjs` runs 100 independent warm clients
for each of Score and Finder at concurrency four. It records start-through-useful-page
latency, retries and errors without retaining tokens, cursors or response payloads.
This is API evidence, not Flutter rendering or a true cold-start measurement.

## Explicit lifecycle operations

`maintainLifecycle()` invokes bounded expired private-binding cleanup and SQL GC.
No scheduler or TTL policy is automatically activated. SQL GC defaults to 100 rows
per category (maximum 500), preserves valid/leased revision pins and every event
newer than the published fence, and tolerates interrupted cleanup. Refinement work
and offer accumulators persist between request budgets and expire with their session.

Export only a fully published, non-staging source snapshot. The local file helper
uses ordered JSONL, an immutable manifest, sparse offsets, exact checksums and fsync.
Acknowledge/prune source journal pages only after validating the actual retained
snapshot bytes. Keep that snapshot independently of SQL. Restore only into a fresh
empty derived database; incomplete restores deny ingestion and admission. Cleanup of
old external snapshot artifacts requires proof that a newer retained snapshot covers
the prune floor. Do not promise indefinite version/event retention or delete the only
recoverable snapshot. A hosted durable snapshot store and control receipts must be
qualified separately before any hosted journal pruning.

## What is deliberately not hosted-ready

The checked-in SQL pool and runtime are strictly local. A future approved deployment
must supply a narrowly scoped encrypted/IAM Cloud SQL connection adapter, explicit
nonproduction service identities/configuration, a Linux numerical/runtime qualification,
and a separately frozen build. The offline spending/watchdog package has no executable
cloud provider adapter. Its durable distributed controller, resource ownership receipts,
real alert delivery and shutdown/absence verification need Gate 1 implementation and
provider testing under separate approval. Local SQLite controller tests do not establish
cloud durability. Current pricing/project/recipients/owner approvals remain unset.

These are precise staging prerequisites, not a request to redesign the search engine.
Do not remove local restrictions, activate production, start a resource deadline or
replace a frozen manifest as a shortcut. Preserve the $100 owner checkpoint and the
original non-resetting maximum 72-hour deadline when a real run is later approved.
