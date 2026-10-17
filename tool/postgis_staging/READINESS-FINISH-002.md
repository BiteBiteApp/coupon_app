# Search preparation and guest performance — 2026-10-17

Run **BS-BITESTAR-POSTGIS-READINESS-FINISH-002**. Prompt prepared
2026-10-17 14:27 EDT; work began 18:35:10 UTC. Source implementation, local
qualification and independent review only. Expected and actual starting main:
`3738a8195df4990561d3872ac60003aa7a839d27`.

The checkpoint is the commit containing this report, annotated tag
`bs-bitestar-postgis-readiness-finish-002`. The external completion receipt records
the actual commit, remote verification, completion time, backlog update and local
service shutdown. It is outside the candidate to avoid a self-referential hash.

## Completion states

| Area | Verdict and practical limit |
| --- | --- |
| A. Local integration correctness | PASS for the affected local paths. Previous frozen v3 Gate 0 PASS remains valid. |
| B. Guest performance | Measurably improved; the proposed two-second warm target is **not consistently met**. |
| C. Hosted adapter source | Implemented and locally contract-tested, including the bounded synthetic source job. Real provider behavior remains unverified. |
| D. Actual Linux qualification | **UNVERIFIED**. Reproducible source package prepared; no local Linux engine was available and no image was built or run. |
| E. Local controller/snapshot/recovery | PASS for deterministic provider transports and actual local SQL/emulator recovery. Simulated GCS is explicitly distinguished from real storage. |
| F. Future supervised limited Gate 1 | Source package prepared; execution remains blocked pending Linux/image qualification, exact owner configuration, permissions, recipients and separate paid approval. |
| G. Paid-run authorization | **NOT GRANTED**. |
| H. Actual hosted/provider/scale qualification | **NOT PERFORMED**. |

Source-corrected, locally tested, independently reviewed and checkpointed are
separate from deployed, default-active and production-qualified. Those last three
states remain false. V1 remains available and the production candidate remains OFF.

## Guest behavior and measurement

The existing Flutter consumer rendered results through real loopback HTTP, local
Auth/Firestore emulators and PostgreSQL/PostGIS. Before and after used the same
185 active projections, fixed fixture time, published fence and revision. The
widget harness observed useful rendered content at the same 20 ms interval.

| Measurement | Before | Final |
| --- | --- | --- |
| Guest attempts / complete pages | 10 / 10 | 20 / 20 |
| Warm observations | 9 | 18, across two Flutter processes |
| Warm median render time | 2.719432 s | 2.035989 s |
| Warm range | 2.678806–2.796315 s | 1.948909–2.138979 s |
| Warm observations at or below 2 s | 0 / 9 | 4 / 18 |
| HTTP calls per useful page | 28 | 28 |
| Guest continuations per page | 26 | 26 |
| Cards per page | 25 | 25 |
| Errors / retries in measured runs | 0 / 0 | 0 / 0 |

Warm median improvement is **25.1%**. The first observation in each Flutter
process is retained but is not claimed as a qualified cold-start observation.
All raw times, request counts and inclusive operation measurements are retained
in `qualified-evidence-v4/track-a-performance-authority.json`. Intermediate
measurements remain separate and are not pooled into the final result.

The client now counts time spent successfully awaiting I/O toward its existing
250 ms pacing window instead of adding two unnecessary fixed waits. The 12-step
bound, rounded-up delay and event-loop yield remain; actual retry delays remain
250 ms. Native authority reads that were needlessly serialized are batched or
overlapped, with all original validation and mutation gates retained.

The protocol still performs 26 sequential history challenges in this scenario.
The 75-ID bound, caller/realm binding, exact history intersection, answer recovery,
replay protection, current offer eligibility, occurrence identity, ordering,
revision/session consistency, cancellation, expiry and account switching remain.
All 754 authority document reads per page remain, including repeated checks needed
at separate boundaries. No private answers are shared or cached across callers.
Average SQL work was about 65 ms per page; transaction timings were about 730 ms
inclusive of their reads. Inclusive measurements must not be added together.

Signed-in Saver retained 25 cards and three calls, with final warm median 0.249 s
(before 0.240 s). Score observations were 0.145/0.124/0.119 s and Finder
0.447/0.413/0.417 s, each with two calls; Finder includes its existing 300 ms
debounce. These small local samples establish neither hosted tails nor national
scale. Consistently meeting two seconds would require a separately scoped owner
decision about studying the remaining protocol exchanges and privacy constraints.

## Hosted preparation and recovery

See [HOSTED-ADAPTER.md](HOSTED-ADAPTER.md), [PROVIDER-GATE1.md](PROVIDER-GATE1.md),
[DURABLE-SNAPSHOTS.md](DURABLE-SNAPSHOTS.md) and [linux/README.md](linux/README.md).
The separate entrypoints do not export V2 from the production index or weaken
the local demo/loopback or numerical guards.

The Cloud SQL adapter uses a narrowly pinned supported connector, private-IP
authenticated TLS and IAM database authentication, bounded pools and deadlines,
credential refresh through the connector, and explicit shutdown. Full canonical
configuration and Ed25519 approval bind project, candidate, run, gate and expiry.
Missing, forged or production approvals fail before provider initialization.
Callable transport verifies Firebase identity and optional configured App Check,
limits request/response sizes and concurrent work, applies exact browser origins,
and returns safe errors. No body UID establishes identity.

Actual job commands cover initialization, fixed synthetic fixture writes through
native maintenance/journaling, enrollment, catch-up, lifecycle, snapshots, restore
and pruning. They are signed, bounded and serialized. An interrupted fixture
batch blocks subsequent publication until reconciled. This limited Gate 1 plan
is not a general multiwriter deployment or national load orchestrator.

The provider controller implements generation-CAS ownership, immutable original
start/deadline, reservations, lost-response reconciliation, bounded operation
polling, watchdog cleanup and exact absence checks. Initial execution also
requires signed Gate 5 cleanup authority through its bounded reconciliation
horizon. Workload admission and actual job startup require enough signed execution
time for the complete bounded invocation, including provider queue delay. A 403
or missing response never means a resource is gone. Cloud SQL
deletion lacks an atomic incarnation precondition: automatic deletion requires
an explicit owner-approved exclusive-ownership/single-use-name policy; otherwise
the watchdog stops the instance and requires supervised deletion. This provider
limitation is not concealed by a matching name or label.

The independent GCS adapter uses create-only generations, exact-generation reads,
checksums, run/configuration binding and a terminal complete manifest. Hosted
SQL snapshots stream bounded pages directly to that store. Restore requires a
genuine approved store and separately branded restore database. Pruning validates
the retained bytes and source fence. The real local recovery tests restored 546
projection rows after the original SQL database was dropped; the simulated-GCS
case also removed all local export files, resumed an interrupted restore and
replayed the later source event. Real GCS was never contacted.

The future signed configuration needs existing approved control/evidence bucket
metadata, a locally qualified immutable Linux image, exact project/identities,
private route, SQL IAM user/grants, mounted isolated key versions and recipients.
Real login/refresh, provider failures, delivered alerts, watchdog independence,
managed recovery and cleanup/retained billing require later supervised evidence.
No ordinary adapter implementation is intentionally deferred to that hosted test.

## Verification and review

The evidence index records exact final source hashes, logs and per-suite counts;
counts overlap and should not be combined as independent coverage. Affected
native authority tests passed 307/307, Flutter coordinator tests 106/106, actual
native integration 9/9, native runtime/default-off guards 3/3, preserved wiring
32/32, and Flutter selector tests 6/6. Actual Flutter rendered flows all passed.
Final snapshot qualification passed 15 injected contracts and two real local
SQL/emulator recovery scenarios. Controller/legacy safety/pricing discovery
passed 81/81. Hosted contracts and sole-writer emulator results are recorded in
the final track B and independent review receipts.

The expanded native suite exposed 12 pre-existing failures in the Saver runtime
test harness (313 pass / 12 fail): its Storage mock and expected export inventory
are stale. The unchanged production index and owner-media module match v3; the
changed session module is mocked by those failing tests. These failures are
recorded for separate repair, not hidden or weakened. Initial integration fixture
project-selection and snapshot assertion failures were fixed and rerun; their
original logs are retained.

Independent review covered final guest changes, adapter/controller code and the
integrator's snapshots/pricing. Findings about mutable configuration, identity
binding, error redaction, watchdog reconciliation, approval duration, Linux build
dependencies and actual provider body limits were fixed and rechecked on final hashes. Reviewer-authored
changes received a separate review. The final evidence index identifies the
reviewer, scope and exact bytes; a passing earlier hash is not reused for later
source changes.

## Cost and decisions

The [dated worksheet](pricing-2026-10-17.json) and current evidence estimate
**$214.85 plus $30 cleanup reserve = $244.85**, $10.69 below the historical
$255.54 estimate. It includes idle compute, storage/index operations, backups,
retained data, logs, artifacts, snapshots, networking and control services.
Assumptions and unpriced allowances remain explicit. The $300 forecast ceiling,
72-hour maximum, six active load hours and separate $100 owner checkpoint remain.
No estimate is a guaranteed maximum or authorization.

Current service-specific spend caps do not cover the whole proposed stack:
Cloud SQL, Firestore and Cloud Storage remain outside the verified coverage.
Budgets alert; caps can have delayed or continuing charges and do not remove
resources. Independent bounded execution and teardown are still required.

Material Bug Filter decisions:

- **FIX NOW / DIRECTLY REQUIRED:** measured avoidable guest waits/serialization;
  configuration and snapshot binding; safe error output; lost-response/async
  cleanup, approval horizon, job serialization and provider body enforcement.
  Corrected and covered by local verification.
- **FIX SEPARATELY — REAL BUG:** the 12 stale native runtime harness failures.
- **PRODUCT DECISION REQUIRED:** any protocol/privacy change to consistently meet
  two seconds, and the future SQL exclusive-deletion policy versus supervised
  deletion. No such policy or protocol was silently changed.
- **ACCEPT AND CLOSE:** a finite one-shot limited Gate 1 job plan does not need
  a new general six-hour load scheduler; six hours remains a ceiling.

Seven owner-modified files and six pre-existing reports were hashed before work
and preserved byte-for-byte. Prior manifests and evidence remain unchanged; v4
is a separate freeze of this candidate. Exact-path staging excludes all thirteen
pre-existing files. No branch was created or switched.

The coordinated safety/backend rollout remains the next separate workstream
before any paid search investigation. Phone acceptance and store launch remain
later. No paid resources. No hosted investigation. No real 72-hour timer.
No production deployment or activation.
