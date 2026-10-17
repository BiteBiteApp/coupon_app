# BiteStar PostGIS source integration — Gate 0

Run **BS-BITESTAR-POSTGIS-INTEGRATION-GATE0-001**, prompt prepared October 17, 2026.
Role: integrating engineer with independent source, query/authority and staging reviewers.
Started **2026-10-17 17:22:37 UTC**. Expected and actual starting local/remote `main`:
`56e5e1a165cc5797b1d0e99404f4acfada0e598e`.
The final qualification time, exact source/build/evidence hashes and readiness decisions
are in `readiness-manifest.v3.json` and `candidate-manifest.v3.json`. The checkpoint is the
commit containing these files, tagged `bs-bitestar-postgis-integration-gate0-001`.
The external completion receipt records the final commit, remote verification and shutdown.

**Local source integration Gate 0: PASS. Hosted execution readiness: BLOCKED.**
The candidate is implemented, locally exercised and independently reviewed. It is
not deployed, production-active, Linux-qualified or hosted-performance-qualified.
The operational staging configuration remains unapproved and disabled; its
`gate0Ready: false` is not a claim that the local integration tests failed.

## Scope and sanity check

Permitted changes were search backend logic, the derived SQL schema, dormant client
transport selection, focused tests and staging preparation. Presentation, routing,
ownership, payments, production infrastructure and safety activation were protected.

1. The integration serves the approved faster-search product direction while retaining
   native search results and authority; no competing architecture was introduced.
2. Existing local Node/PostGIS binaries and Firestore/Auth emulators support genuine
   local integration. Hosted adapters, identities, pricing and Linux proof are unavailable.
3. Changes implement source completeness, bounded query delivery, native authority,
   client consumption or safe recovery; unrelated UI/Admin/legal work was not reopened.
4. The original proof artifacts, all 13 pre-existing changed files (including all seven
   owner files), synthetic recovery snapshots and legacy/default-off paths are preserved.

## One source-reconciliation inventory

| Area | Recovered October 1 candidate | Current integration |
|---|---|---|
| Provenance | Corrected prototype, fixtures, 296 historical checks and staging package recovered; 204 source, 367 evidence and 45 staging file hashes matched | Original artifacts retained; new exact manifests bind current source, tests, build and evidence |
| Source and authority | SQLite source/outbox and synthetic authority/interface simulations | Real Firestore maintenance transactions, durable journal/enrollment and native Firestore authority |
| Query | Real local PostgreSQL/PostGIS schema, conservative recall bounds and exact JS refinement | Ported into TypeScript store/query/membership code using current native predicates and result builders |
| Native integration | Copied compiled modules exposed private functions using dynamic injection | Explicit source exports, eight V2 callable handlers and inert staging registration; no injection |
| Identity and current contracts | Historical app snapshot; same-ID edited-offer defect | Current Saver account/occurrence IDs, independent Score IDs, visibility/Specials, guest protocol, Menu and delivered grants retained; defect reproduced and fixed |
| Flutter | Synthetic protocol measurements | Existing Saver browse, Score Home and Create & Rate Finder consumers accept actual local HTTP results behind `BITESTAR_POSTGIS_SEARCH`, default false |

Recovered source manifest SHA-256:
`0ef7d8d30c7ab69d332e60218ad691b430996bfe28ee49574f9c5edb7e0aaa04`.
Evidence and staging hashes are in `provenance.json` and `README.md`.
The five requested Google guidance/backlog documents were read. Saved staging and
October profile/Menu handoffs were reconciled. A distinct October Admin/UI handoff
was not found in the targeted known locations; no claim is made that it was read.

## Actual execution path and protected contracts

`postgis_staging_runtime.ts` composes real source-enabled maintenance, native verified
callable contexts, the SQL store, membership provider and native handlers. It requires
explicit demo-project allowlisting, loopback Firestore/Auth/SQL and synthetic keys.
Importing it does not register or deploy anything. Production `index.ts` exports no V2
candidate. Its changes only extract existing pure identity/snapshot helpers; the Score
wrapper preserves validation order and lazy secret access.

Six source bindings observe `restaurant_accounts/{id}`, its `coupons/{id}` and
`daily_specials/{id}`, `bitescore_restaurants/{id}`, `bitescore_dishes/{id}` and
`dish_rating_aggregates/{id}`. Existing `private_search_index_jobs/{id}` continues
bounded parent fanout. Actual `restaurant_search_index`, `bitesaver_offer_index` and
`dish_search_index` mutations and cleanup tombstones journal in the same Firestore
transaction. Enrollment rereads bounded pages transactionally, captures concurrent
changes and records a finite fence with per-shard count/XOR checksums. This preserves
the existing asynchronous projection boundary; it does not promise instantaneous
raw-source completeness or a cross-database transaction.

`postgis_store.ts` durably receives contiguous ordered events, rejects gaps/conflicts,
records interrupted work and publishes only an exactly reconciled finite target.
Semantic poison blocks publication; explicit later source repair can resume without
skipping events. Admission rejects source lag. `postgis_query.ts` applies conservative
SQL recall then exact native matching/ranking and deterministic tuple refinement.
`postgis_membership.ts` supplies bounded native rows, streaming offers in pages of 75
into the existing three-preview accumulator with durable checkpoints.

`postgis_handlers.ts` exposes Saver start/status/page/offer-page/guest-continue and
Score start/advance/page. Finder uses Score criteria. Native admission, actor/realm,
request replay, fixed expiry, current visibility, occurrence identity, guest history
and signed usage remain authoritative. SQL contains only allowlisted searchable
projections. It never grants ownership or redemption. The guest challenge cap stays
75. A revision pin is published with the native ready marker after admission; V1
workers cannot scan a V2 session. Native delivered-result grants preserve Menu and
redemption-preparation continuity.

Flutter service instances freeze endpoint selection for session consistency. Only
the eight discovery endpoints gain `V2`. Multiplexed public profile/media/profile-use
requests, Menu, Saved, favorites, QR/deep links, coupon usage and redemption keep their
existing services and IDs. No screen layout or navigation implementation changed.
Terms/age/moderation/account-deletion/Stripe infrastructure was not altered or activated.

Local SQL pools cap at four connections, connection acquisition at two seconds, SQL
statements at five seconds and driver queries at 5.5 seconds. Timeouts remain errors.
Pins have bounded expiry; explicit bounded GC preserves active pins, unfinished work
and unpublished events. Binding cleanup is explicit and inert, with no TTL deployment.
External snapshot files are verified before journal pruning; interrupted fresh-database
restore blocks admission/ingestion until exact final reconciliation.

## Verification and exact limits

Counts below describe separate suites and overlap; they are not a unique-test total.
Final logs, dataset/review hashes and raw evidence locations are in `qualified-evidence/qualification.json`.

| Verification | Result | Evidence boundary |
|---|---:|---|
| Native Saver/Score/bridge regression | 319/319 | Native handlers; bridge provider mocked in this suite |
| Shared worker, cursor, availability, Menu/profile, builder and normalization contracts | 278/278 | Native unit/contract tests |
| Existing maintenance contracts | 190/190 | Final focused maintenance requalification |
| Source codecs and transactional source behavior | 17/17 | Pure checks plus actual Firestore emulator |
| SQL query, revision, poison repair, timeout and bounded work | 18/18 | Real local PostGIS; synthetic in-memory source transport |
| Actual maintenance → journal → SQL → verified HTTP/native authority | 9/9 | Real Firestore/Auth emulators and local PostGIS |
| External snapshot/prune/drop/restore/replay | 1/1 | 546 real projection rows; original derived DB deleted; eight restore pages; later source edit replayed |
| Bounded SQL and binding cleanup | 2/2 | Real SQL and Firestore emulator |
| Opted-in runtime/registration | 3/3 | Qualified exact Node binary; no cloud provider |
| Legacy runtime wrapper requalification | 32/32 | Normal isolated test runner, after final helper extraction |
| Offline spending/controller/watchdog guards | 49/49 | Local synthetic fixtures, including repaired $100 checkpoint and explicit versioned-manifest selection |
| Flutter core/controller and runtime wrappers | 23/23 and 40/40 | Native-shaped fixtures and legacy/default-off coverage |
| Existing paced guest continuation | 1/1 | 25 challenges complete across the existing 12-step yields |
| Actual Flutter useful-page rendering | 4/4 | Three observations per flow; actual HTTP/native/Firestore/Auth/SQL responses |
| Actual PostgreSQL server restart | PASS | Active query failed `57P01`; pool reconnected; revision, 305 entity versions, 185 heads, 272 pins and ordered page preserved |
| Flutter Score after database restart | 1/1 | Three useful renders through the still-running HTTP host |
| TypeScript build / scoped Flutter analysis / diff whitespace | PASS | Eight analyzed Dart files; no issues |

The SQL fixture initially has 525 projection documents: 94 Saver parents, 157 offers,
94 Score parents and 180 dishes, with 514 raw source documents and additional named
edge cases. Tests cover sparse/radius/category cases, no-offer parents, all seven dish
sorts, aliases/spelling, later tied pages, scoped identical coupon IDs, source updates,
delete/recreate, retained revisions and eight concurrent selections. A separate
230-offer parent proves durable accumulation across two-query request budgets.
The native HTTP fixture initially has 155 projections: 35 Saver parents, 60 offers,
20 Score parents and 40 dishes, plus four named edge-case records. Its 59 HTTP calls
include expected authorization rejections; these are correctness tests, not error-free
load statistics. Private canaries were absent from SQL and public responses.

The Flutter/API fixture has 185 projections: 35 Saver parents, 60 offers, 30 Score
parents and 60 dishes. Five Saver parents have no offers. Actual customer-useful
render observations, including legitimate continuations and Finder's real debounce:

| Flow | Three local elapsed observations | Calls per useful page |
|---|---:|---:|
| Guest BiteSaver | 3.193, 2.716, 2.739 seconds | 28, including 26 guest continuations |
| Signed-in BiteSaver | 0.270, 0.264, 0.261 seconds | 3 |
| BiteScore dish Home | 0.131, 0.109, 0.105 seconds | 2 |
| Create & Rate Finder | 0.454, 0.420, 0.415 seconds | 2 |

All 12 observations rendered useful correct content with zero transport errors.
These desktop widget observations are neither physical-device tests nor true cold
starts. Three observations do not support p95/p99 claims. Guest warm observations
exceed the historical two-second target: performance acceptance remains open.

A separate 100-client warm API benchmark per flow, concurrency four, excluded five
warmups per flow (ten total): Score p50/p95/p99 = 84.84/112.61/122.68 ms; Finder =
40.88/49.87/50.47 ms. All 420 HTTP calls completed with zero errors/retries.
These are descriptive small-sample API percentiles, not Flutter or hosted acceptance.
No integrated 1,000/5,000/10,000-parent or national-million run was performed.

Observed runtime: PostgreSQL 18.6, PostGIS 3.6.3, pg_trgm 1.6, fuzzystrmatch 1.2;
Node 24.21.0/V8 13.6.233.17-node.53, macOS arm64, Apple M5/16 GiB.
Exact-rational numerical proof reproduced; current bound/radius vectors passed
318/1,512 cases respectively. Other binaries/options fail closed. Peak SQL pool use
was four. RSS records are point observations only, excluding emulator/shared/backend
memory; process peak memory was not measured. Source fence/catch-up completeness was
verified, but sustained ingestion lag and true cold-cache latency were not measured.

Earlier failures led to in-scope fixes. Stale test-only storage/snapshot mocks and a
Flutter wrapper cast were corrected to existing product behavior. A combined legacy
mock/runtime diagnostic under `--test-isolation=none` had one module-cache identity
collision; correctly separated suites passed. Retained failing logs are diagnostic
history, not hidden final failures. The final meaningful suites have no unresolved failure.

## Review, Bug Filter and remaining prerequisites

Independent reviewers inspected actual source and final hashes, not only this report.
Track C reviewed source/recovery and query/membership; Track A reviewed query/store
and local runtime; Track B reviewed staging controls and native context extraction.
Track C also reviewed the edited-offer/guest authority repairs and dormant client
selectors. Final review receipts have no unresolved material source-correctness finding.

**FIX NOW / DIRECTLY REQUIRED — resolved:** same-ID edited-offer disappearance;
current-parent fingerprint capture for new guest checks without weakening subsequent
replay fences; native/SQL tied-ID cursor encoding; bounded streamed offer work;
semantic poison repair; bounded revision/binding cleanup; exact runtime qualification;
and the $100 checkpoint's previously omitted delayed/holding/cleanup exposure.

**FIX NOW / DIRECTLY REQUIRED — remaining before hosted readiness:** implement the
approved encrypted/IAM Cloud SQL connection/deployment adapter; qualify the Linux
runtime/numerics and freeze its actual image; implement the cloud controller/provider
adapter and independently durable snapshot store. The local adapters intentionally
reject hosted targets. These precise missing components prevent a staging-readiness
PASS; they do not invalidate the tested local integration.

**PRODUCT DECISION REQUIRED:** separate paid-run approval with exact isolated project,
identities, recipients, cleanup rights and currently verified costs. Preserve the
non-resetting 72-hour maximum and a new owner approval at the conservative $100 forecast
checkpoint. Historical cost arithmetic is not current pricing or spending permission.

**FIX SEPARATELY — REAL BUG:** guest useful-page performance remains above the proposed
warm target on this small local fixture. Preserve the 75-ID authority protocol; measure
and correct the demonstrated round-trip cost before claiming hosted acceptance.

**ACCEPT AND CLOSE:** historical microbenchmarks, local-only runtime restrictions and
small-sample limits are explicitly bounded evidence; they are not production guarantees.
No unrelated backend defect was found that justifies expanding this assignment.

The next hosted gates must prove real alert delivery, watchdog independence, immutable
deadline, shutdown/absence and retained-charge accounting; actual hosted ingestion and
authority/billing calibration; dense/national workloads, sustained concurrency, cold/warm
useful-page targets, storage growth, failure recovery and teardown. See `README.md` and
`LOCAL-INTEGRATION.md` for exact controls and reproduction. Safety/backend activation
remains a separate preceding workstream; mobile beta and app-store qualification were
not begun.

No paid cloud resources, project, billing enablement, staging run or 72-hour timer was
created. No production search cutover, Firestore/Functions/Rules/Storage deployment,
production data write or safety/Terms/age/AI activation occurred. All seven owner files
and six other pre-existing report files remain byte-for-byte intact and outside this
checkpoint. The existing canonical backlog receives the factual completion update;
this qualification report is not a second backlog.

Qualification amendments: v2 corrected only the report's API warmup count (five per
flow, ten total). V3 adds an explicit `--manifest` option to the dry-run guard and
updates its documented command, avoiding accidental verification of a superseded
manifest. Its 49 offline tests and independent review passed. Backend/client source,
runtime and measured results are unchanged. Earlier manifests and original report,
guard/test/README and evidence-index bytes are preserved as superseded records.
Use `readiness-manifest.v3.json` and `candidate-manifest.v3.json` for current evidence.
All task-owned SQL, HTTP, Firestore and Auth services have stopped; synthetic data,
logs and snapshots remain intact. Shutdown receipts are included in qualified evidence.
