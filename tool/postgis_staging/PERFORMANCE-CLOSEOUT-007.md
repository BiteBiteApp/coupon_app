# BiteStar PostGIS performance closeout 007

Run **BS-BITESTAR-POSTGIS-PERFORMANCE-CLOSEOUT-007**. Prompt **2026-10-19T17:36:00-04:00**; started **2026-10-19T21:44:09.014994+00:00**. Role: diagnosis, bounded backend correction, local qualification and reviewed checkpoint. Permitted changes: backend logic, focused tests and task-owned measurement/relay artifacts. No client behavior, schema, production infrastructure or policy change.

Expected starting main: `6753dd0f999afe8416e3d536feace7a7bf38347a`. Actual starting main: `39922fd418d5cc5cd191db0af8d3ee12dab64c7a`, which already includes 006 and a newer website checkpoint. Its committed changes and the owner's current uncommitted work were preserved. Isolated archives separated the controlled 006 comparison from final-current-main integration. The actual index had no staged differences; historical staged inventories were not reconstructed.

Source freeze completed **2026-10-19T22:07:35.088104+00:00**. Planned annotated checkpoint: `bs-bitestar-postgis-performance-closeout-007`. Actual commit, completion time, remote main/peeled-tag verification and preservation results are recorded after checkpointing in [CHECKPOINT.json](/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-PERFORMANCE-CLOSEOUT-007-20261019/CHECKPOINT.json). Reports and raw evidence have a separate [hash index](qualified-evidence-performance-007/INDEX.json); they are not silently substituted into the earlier freezes.

Remote preflight still found main at `6753dd0f999afe8416e3d536feace7a7bf38347a`, with no 007 tag. The newer local parent `39922fd418d5cc5cd191db0af8d3ee12dab64c7a` is the website checkpoint authorized in **BS-CUSTOMER-WEBSITE-CHECKPOINT-005-COMMIT-CORRECTION** with an explicit “Do not push” instruction. A normal 007 push would also publish that ancestor. The reviewed 007 local commit/tag can be completed, but publishing both requires owner clarification; no branch rewrite or isolated substitute history is authorized. The checkpoint receipt records the final outcome of that boundary separately from source qualification.

**Verdict: affected source and local correctness qualified; heavy-history latency remains above target; hosted tails and cloud execution remain unqualified.** Firestore remains authoritative and PostGIS remains the derived search index. Nothing was deployed, activated or approved for spending.

## 1. What caused the delay?

Two distinct causes were demonstrated. The local Linux test's TCP relay buffered small packets. Separately, preparing one bounded guest window opened a separate current-authority transaction for each restaurant, although the existing transaction helper can safely validate that whole window together. Repeated history challenges still do substantial necessary work after these corrections.

### Reproducing the three observations

| Observation | Retained 006 result | 007 reproduction before application edits |
| --- | --- | --- |
| A: small Mac useful render, five guest searches | 1,208.9 ms before / 902.7 ms after 006 | Final-006 source: 907.3 ms median; all 16 consumer intents succeeded |
| B: heavy native handler, first/later pages | 7,021.7 / 3,149.2 ms | 7,578.1 / 2,726.8 ms; same 26 challenges, 435 candidate occurrences and 360 suppressed answers |
| C: Linux useful render, five guest searches | 6,764.2 ms median | 5,543.3 ms median; all 16 consumer intents succeeded |

A, B and C have different boundaries and cannot be treated as one regression series. Reproduction source matched all 687 frozen 006 inputs and all 328 compiled implementation files. The retained cap image used for C has those same implementation bytes; the later 006 final image differs in its integration-test reset. The 185-entity consumer fixture's timestamp, revision, manifest and full published source fence matched 006. The heavy fixture reproduced 500 Saver plus 500 Score parents, 4,450 raw documents, 3,300 published heads and 630 stored history IDs. Historical invalid-reference failures remain untouched; heavy exact parity uses the documented corrected unbatched reference, including the 006 timestamp and distance-fingerprint repairs.

### Controlled cause isolation

Holding source/image, amd64 architecture, one CPU/768 MiB allocation, dataset, source fence, current-availability time and transport constant, an original/corrected/corrected/original relay experiment produced **4,779.9 → 1,722.3 ms guest median**, four observations per condition. The warm second-intent subset was **4,277.1 → 1,175.9 ms**, two observations each. Every response delivered the same ordered 25 cards. Disabling Nagle buffering on both accepted and upstream sockets is the only relay difference. [Node's versioned documentation](https://nodejs.org/download/release/v24.21.0/docs/api/net.html#socketsetnodelaynodelay) describes this buffering and `setNoDelay(true)`. The experiment establishes a substantial fixture effect; it does not establish that emulation is the sole cause or quantify native-cloud performance.

The original historical relay remains unchanged. Its corrected task-local successor is retained as `loopback-relay-nodelay.cjs` in the evidence package. Its fixed emulator addresses/ports belong to this local fixture, not a cloud deployment recipe. No global Docker setting, application allocation or production server choice changed.

### Critical path and resources

Removable synthetic-only instrumentation recorded SDK reads/queries/transactions/commits, SQL acquisition/statements, admission, CPU, event-loop/GC and container resources. It did not record credentials or personal histories. Final timing comparisons ran without expensive tracing. Overlapping intervals were partitioned rather than added together:

| Traced second guest intent | Handler wall | Firestore interval | SQL interval | Outside measured I/O | CPU, overlapping wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original relay / baseline | 4,459.2 ms | 3,926.1 | 87.4 | 445.7 | 1,287.4 |
| Corrected relay / baseline | 1,011.2 ms | 700.2 | 33.2 | 277.8 | 733.3 |
| Corrected relay / final source | 955.2 ms | 653.0 | 42.7 | 259.5 | 649.2 |

Those illustrative traces were taken at different fixture-load stages; only the balanced relay experiment supports the causal timing comparison. SQL work remained 77 statements for the ordinary guest intent, explaining why previously reduced SQL counts did not eliminate the relay-dominated delay.

For the final traced intent, correctly rendered wall time was 1,121.5 ms: 955.2 ms handler, 50.4 ms combined transport/auth/serialization/client-parsing residual, and 115.9 ms combined client processing/scheduling/rendering residual. These are broad residuals, not separately measured wire or JSON costs. There was no explicit client backoff. The heavy probe retained one unavailable attempt and its explicit 200 ms harness wait; neither was removed from latency results.

Heavy two-page traced handler wall was 11,040.9 → 10,404.4 ms, partitioned respectively into Firestore 7,748.5 → 7,053.4; SQL 1,095.8 → 905.8; outside measured I/O 2,196.7 → 2,445.2 ms. CPU overlapped those intervals at 4,962.3 → 4,859.8 ms. CPU profiling found time in date/time evaluation, crypto/key handling, hashing, serialization and GC as well as idle waits; it does not justify an unrelated rewrite. Across 932 SQL activity samples there were no lock waiters and one I/O wait sample. Acquisition was small; finite admission did not introduce repeated ordinary-guest waiting. Transaction/retry events remain in raw traces rather than being hidden in a successful-only counter.

Resource evidence shows neither an OOM nor a universally idle host. In the 16.70-second final consumer observation interval, the application used about 236 MiB of 768 MiB and accumulated 384 ms of CPU throttling across 14 periods; PostgreSQL used about 363 MiB of 2 GiB, with no throttling; the emulator used about 1,844 MiB of 2 GiB and 25 ms of throttling. Host load varied roughly 3–6. These are interval totals, not additive request latency. Both PostgreSQL and emulator retained two-CPU/two-GiB allocations. The emulator's load and host contention remain possible contributors to small-sample jitter. No capacity increase was used to obtain a pass.

## 2. What changed and does it work?

The sole production hunk is in `currentOffersForExpiredGuestBatch`'s `restaurantWindow` branch. After the same initial parent/result checks, it calls the existing `evaluateOfferSeedsAtCoherentSnapshot` once for the existing window and corroborates results in original order. That transaction rereads every parent and raw offer. It is bounded by 26 parents and 75 offers, with no individual document-read call above 100. Account/type/source identity remains part of the lookup key. Answer checks and final delivery still obtain separate fresh snapshots. There is no cross-request cache, larger history disclosure, concurrency increase, new protocol or omitted authority work.

The heavy trace reduced SDK transactions **720 → 370** while requested SDK documents remained **4,566 → 4,566** (authority documents 4,549); SQL remained **737 statements**. The ordinary guest trace changed **90 → 40 SDK transactions** while keeping **625 requested SDK documents**, 608 authority documents and 77 SQL statements. These are operation/request counters, **not billed reads or cloud savings**.

### Matched timing results without expensive tracing

Controlled comparisons used clean 006 archives with/without the production hunk, the corrected relay where applicable, the same fixture/current-time context seam and unchanged runtime limits. The injected availability time was **2026-10-19T23:00:00Z**; runtime guards, real monotonic timers and expiry machinery were not replaced. SQL entity data/indexes were unchanged; captured last auto-analyze times preceded the comparisons and entity modification counters were zero. Runs were balanced; all attempts, failures and first observations remain available. No performance experiment overlapped another task build/test run, although ordinary host activity was not controlled away.

| Matched measurement | Before | After | Evidence boundary |
| --- | ---: | ---: | --- |
| Linux guest useful render | 2,058.4 ms | 1,653.5 ms | Four observations each, balanced ABBA, same ordered 25 cards |
| Empty history: first / later native page | 1,217.9 / 1,064.1 ms | 1,213.7 / 1,256.1 ms | Three two-page attempts each; 2 challenges, 108 candidates, 0 suppressed |
| Matching moderate history: first / later native page | 1,399.2 / 1,019.8 ms | 1,324.9 / 960.7 ms | Three attempts each; 30 stored IDs, 10 suppressed, 4 challenges, 116 candidates |
| Heavy history: first / later native page | 7,649.0 / 3,209.8 ms | 7,150.0 / 3,470.7 ms | Three attempts each; 630 stored IDs, 26 challenges, 435 candidates, 360 suppressed |

Medians are descriptive. In particular, empty and heavy later-page medians became slower; this is not a universal latency improvement. Exact first/later membership and ordering matched across variants. Heavy output additionally matched the corrected independent reference. The 75-ID disclosure ceiling and complete-page/lookahead semantics remained enforced.

An initial 30-ID “moderate” cohort happened not to intersect the candidates. All six observations are retained as a **nonmatching-history control**, not presented as moderate suppression. Review identified this and the matching moderate cohort above was added. Review also caught an unconditional harness evidence label that claimed corrected-reference comparison outside the heavy mode. `evidence-corrections.json` supersedes that label: empty/moderate parity is asserted against the baseline variant; only heavy uses the retained corrected independent reference. No raw result was deleted or silently relabelled. `trace-segments.json` explains a trace file containing two host lifetimes and preserves both original and split data.

### Final current-main qualification

Final integration rebuilt the actual starting main plus the same two source/test paths. All **54 search runtime dependency files** match the controlled candidate, and **495 source/compiled files** match the final image. Newer website inputs were preserved exactly; this does not qualify unrelated website behavior.

- **314 native tests passed**, no failures/skips, on both the controlled candidate and final integration. The two added focused cases assert one bounded coherent window snapshot, separate answer/final checks, and refusal after parent/raw-offer withdrawal. Existing cases cover bounded challenges, suppressed prefixes, expiry, replay/lost replies, account denial, refill, order and continuation.
- **179 relevant Dart tests passed** on final integration, covering client services, transport, guest storage, coordinators and customer screens, including cancellation/account/stale-result boundaries.
- **Five actual local Firestore/PostGIS checks passed**: cross-account denial, lost completion reply replay, expired-window reissue with old-answer denial, parent withdrawal, raw-offer withdrawal. The last two are deterministic before-transaction edits, not concurrent transaction-conflict stress qualification.
- Final image build checks passed **49 cases**. Four actual Flutter consumer tests completed **16/16 intents**: guest five-sample median **996.1 ms**; signed Saver five-sample median **432.1 ms**; BiteScore three-sample median **209.1 ms**; Finder three-sample median **479.8 ms**. All five guest intents returned the same ordered 25-card digest `13a61728a12aacbbff6a3a4d16e0273ef7fa4583ebc3c611ef4f7e8221212fe1`.

This final-current-main run is an integration check, not another controlled before/after estimate. Its first observations are not certified cold starts. Suite counts overlap and are not added into one total.

The independent read-only reviewer inspected the changed bytes, authority/identity/order/boundary checks, raw comparisons, corrected evidence labels, final build/source hashes and test output. **No unresolved source finding** remained. The reviewer did not rerun tests while measurements were active. [Review receipt](qualified-evidence-performance-007/review-007-code.json).

Final image: `sha256:8838c8de6d738fa587c67da3e8af8385d6a260ef0bef229e8cee5f1410f22043` (local linux/amd64, Node 24.21.0). [New source manifest](combined-source.performance-007.json): **689 files**, digest `103d837f78f2a14a4d6c33e999fd3c2d097a56c708842eda90c9d459869cd81c`. Earlier images, manifests and evidence remain unchanged. Unaffected 003–006 query, publication, recovery, Storage and safety evidence is reused within its recorded limits; no fresh provider qualification is implied.

All task-owned running services were stopped; retained containers, images and SQL volumes were not removed. The pre-integration check preserved **1,813 existing file hashes and the exact index entries**. The final checkpoint receipt verifies preservation again. One unused final container had a caught emulator-host typo and was never started; the verified replacement supplied all final results.

Other preserved unsuccessful setup attempts include a runtime-guard rejection of CPU-profiler CLI flags (profiling subsequently used removable inspector instrumentation without changing the guard), an unsupported Python extraction option and wrong setup working directory, and a test-fixture mapping assumption/command typo corrected before authority mutation. These are labelled test-setup failures, not excluded successful-search samples. See retained logs.

## 3. What remains before spending?

**Heavy suppression is still slow:** the matched candidate needs roughly **7.15 seconds for its first page and 3.47 seconds for its later page**, with 26 challenges, 435 candidate occurrences, 360 suppressions, 370 SDK transactions and 4,566 requested documents across two pages. Coalescing removes redundant transaction overhead but does not remove the repeated authority and challenge work. Further local speculative optimization is not justified by this bounded experiment. The smallest next measurement is the same representative, exact-result workload on the separately approved native provider setup, with current-authority timing and useful-page tails. It must establish how much delay survives without local relay/emulator/emulation effects; hosting must not be assumed to eliminate application work. Any later proposal to change privacy, page guarantees, authority checks or architecture requires its own consequential decision.

Targets stay **warm p95 ≤2 seconds, p99 ≤4 seconds, cold ≤4 seconds**. Small local samples do not prove them. This checkpoint is not a full performance PASS or permission for an investigation.

The following existing gates from [006](REVIEW-CORRECTIONS-006.md) remain unchanged:

1. One finite whole-workload reservation covering seeding, catch-up, load, snapshots, restore, cleanup, elapsed time, storage growth and holding liabilities. Logical seed limits are not proof the complete managed run fits.
2. Provider IAM/certificate refresh and reconnect lifecycle qualification beyond the short diagnostic; actual private routing, least privileges, Auth/App Check, CORS, service URLs, exact object generations and managed recovery proof.
3. Explicit runtime portability decisions; no runtime guard replacement or changed numerical/ranking semantics was authorized.
4. Snapshot-pruning retention protection and additional storage liabilities. No locked retention is silently approved or applied; exact generations need protection for the original recovery horizon.
5. Bootstrap duration (current 900-second guard versus proposed two hours), attended-window semantics and notification exceptions. The proposed six-hour lifetime includes the teardown lead; it does not reset the outer clock. Email preference does not create a tested inbox receipt or automatic SMS fallback. Unattended cleanup remains unapproved without independent verified watchdog behavior.
6. Temporary SQL setup access, exact privileges/revocation and actual cleanup ownership evidence. Historical pre-start exclusivity cannot be fabricated after temporary access.
7. Exact isolated project, region, resources, immutable images/configuration, principals, network/API/secret steps, alert destinations, approved retention, finite workload and cleanup plan, followed by separate spending authorization and real signed approvals.

The **$300 planning ceiling includes the $30 cleanup reserve**. The separate **$100 forecast checkpoint** and **original non-resetting 72-hour maximum** remain. The clock is **unstarted**. No monthly tier, registry upload, cloud resource, paid test, alert, production-data access, IAM/billing/network/API change, deployment, activation, website development or phone/store work occurred.

### Bug Filter and Operational Sanity disposition

The actual governing Bug Filter, Operational Sanity checklist and canonical backlog were read. Consequence, likelihood and proportionality support the bounded work here: the measured relay delay affects these reachable local tests; redundant per-parent transactions affect every relevant guest window; both corrections are executable, necessary for reliable diagnosis/progress and recoverable without infrastructure changes.

- **FIX NOW / DIRECTLY REQUIRED:** relay buffering, repeated within-window authority transactions and the inaccurate evidence labels identified by review. Corrected and qualified in their respective fixture/source/reporting scopes.
- **FIX SEPARATELY — REAL BUG:** the retained heavy-history response-time gap. Exact results are correct, but the reachable synthetic suppression workload remains slow. It stays open for the bounded native measurement and any separately justified follow-up; it is not excused as “unrealistic.”
- **PRODUCT DECISION REQUIRED:** retained operating exceptions, runtime/retention/setup choices and exact spending scope above. None approved by this run.
- **ACCEPT AND CLOSE:** corrected test-setup mistakes, with their unsuccessful attempts retained. No production defect or weakened assertion remains from those mistakes.

The existing canonical backlog is updated in place after checkpoint verification, preserving its earlier completion and approval history. Source-corrected, tested, reviewed and committed status remains separate from deployed, default-active and production-qualified status.
