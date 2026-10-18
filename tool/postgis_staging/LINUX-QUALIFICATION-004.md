# Local Linux qualification 004

Run **BS-BITESTAR-POSTGIS-LINUX-QUALIFY-004**. Prompt prepared
**2026-10-17T19:34:00-04:00**; actual start
**2026-10-17T23:42:00.718384Z**. Role: installation, bounded local backend/runtime
qualification and independent review. Expected and actual starting local/remote
`main`: **e14b74adeca5088883d7efe7ee208b233be6616d**. The new checkpoint is the
commit identified by annotated tag `bs-bitestar-postgis-linux-qualify-004`;
post-push SHA, peeled remote tag and completion time are retained in the external
run directory's `completion-receipt.json`.

**Verdict: the selected candidate is functionally and numerically qualified for
this exact local emulated Linux environment. Hosted numerical execution remains
blocked. Paid-run authorization is NOT GRANTED.** This record supersedes the
dated installation/Linux/Storage status in local-003 and `linux/README.md` without
rewriting those historical artifacts. Source-corrected, built, locally tested,
reviewed, committed, deployed, default-active and production-qualified remain
separate states. No deployment or activation occurred.

The permitted source change area was backend runtime qualification and focused
tests. Exactly three existing source files and one new test changed:
`postgis_runtime.ts`, its two hosted callers, and `postgis_runtime.test.cjs`.
No guest/session/controller/safety/client behavior was changed in this run.
Local relays, emulator setup and restart supervision are report-only fixtures.

**Installation and isolation.** The owner's confirmation that ColeSmart LLC has
fewer than 250 employees **and** annual revenue below US$10 million resolves the
earlier size/revenue question. Docker Desktop **4.95.0 (242831)** was installed
from the official Apple-silicon DMG using an ordinary-user `ditto` copy. The
published SHA-256 matched
`7857222d3c009d787e7f8347b12e24bfee44e49a68cf455cb4b612991d2492c1`.
DMG verification, deep strict code-signature verification and notarized Gatekeeper
assessment passed; signer Docker Inc, team `9BNSXJN65R`. The owner was asked to
complete the visible agreement directly; its disappearance and the welcome
screen were observed. The agent did not accept the agreement, create an account,
sign in, use sudo, change macOS security or request credentials. An owner sign-in
appeared independently after the agent skipped sign-in.

Official sources: [Mac installation](https://docs.docker.com/desktop/setup/install/mac-install/),
[license requirements](https://docs.docker.com/subscription-billing/desktop-license/),
[download](https://desktop.docker.com/mac/main/arm64/242831/Docker.dmg),
[published checksum](https://desktop.docker.com/mac/main/arm64/242831/checksums.txt).

The arm64 Mac runs macOS **26.6.2 (25G83)** with 16 GiB physical memory. Docker
CLI/server **29.8.2, build 7fc2dff** uses local `desktop-linux`, Apple
Virtualization and Rosetta amd64 emulation. The VM has 4 CPUs, 8 GiB RAM and 1 GiB
swap. A disk-limit reduction was cancelled when Docker warned it would delete VM
data; the existing 460 GiB maximum was retained. Actual task storage was bounded
and monitored, with about 114 GiB host space remaining at test close. Usage
statistics and Scout analysis were disabled. No cloud builder or image upload
was used.

All test resources were task-named. SQL, Firestore/Auth/Storage and application
services used synthetic identities, the private internal `bs-linux004` network,
and loopback. Mac Flutter reached fixed local relay ports 8188/9099, published
only on `127.0.0.1`; the relay forwarded only to the fixed task container. Backend
workloads had no cloud fallback route. No home directory, credentials, cloud
configuration or Docker socket was mounted. The long-running fixtures had
per-container CPU, memory and PID limits. Controller tests additionally used `--network=none`, a read-only
root and a nonroot user. SQL role `bsgate0` and databases `bsgate0_linux`,
`bsgate0_query`, `bsgate0_integration`, `bsgate0_flutter` were disposable local
fixtures. Linux emulator projects were `demo-bs-postgis-integration`,
`demo-bs-postgis-flutter` and generated demo snapshot-test projects.

**Frozen source and executable identity.** The isolated source is `git archive`
of the starting SHA plus the four reviewed edits. All 16 owner-modified files
use committed versions in the candidate. The new
[combined source manifest](combined-source.linux-004.json) records **649 paths**,
digest **650f5c3d4ecdb18a65887c086d82d122a56908c45353fb14bbff956f2663ec5d**.
This is a selection/provenance inventory, not a claim that every path was newly
tested. All prior v3/v4, local-003 and safety artifacts remain byte-identical.
All **291 protected paths**, including owner changes, website work and historical
evidence, were checked against the starting receipt. Owner work was not staged.

| Artifact | Actual local Docker image ID (manifest digest) |
| --- | --- |
| Final search, `bitestar-postgis-linux-004:qualified-local` | `sha256:a2de5c9804255d17d275a974d2ce1923191f43b4a7e33c64f722f0566b33c6e4` |
| Controller, `bitestar-postgis-controller-004:initial` | `sha256:d31f485673c4638bffc4b5d5dd4b87a711d6182e47f799c877912eb57a49cf2f` |
| Initial search, before guard addition | `sha256:2b449598cf09490b7c3d4699031d26783a94c46d450176ad696c96909c28d12c` |

The Docker containerd image ID is distinct from the OCI config digest. Final
search config digest is
`sha256:0f16f7b7edeed6288f69ae665b8c689422664f04aaacb9dab14ddcbdcb070a32`;
controller config digest is
`sha256:6045d59fe7690a31730682f35db5cdaafe78a106997da8ee19eddc949d790b86`.
The exact final search and controller are also retained in local
`qualified-search-controller.images.tar` (204,947,456 bytes), SHA-256
`4d443b360d1643230421f58021b681b3ea4d992191171460128f16e31bd346ca`.
Saved manifest/config hashes were verified. The large archive, DMG and inspected
ELF remain outside Git in the run directory; concise receipts are committed.

Both intended Dockerfiles used their existing pinned Node/Python base manifests
and dependency locks. Node is **24.21.0**, V8 **13.6.233.17-node.53**, Debian 12
bookworm, Linux **7.0.14-linuxkit**, x64 under Rosetta with CPU model
`VirtualApple @ 2.50GHz`. Executed Node SHA-256 is
`7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c`.
Controller Python is **3.12.13**, executable SHA-256
`4dbf3143240288fb2170257ffaa7bd030cdda5d2703d1f5f30b627042267e2e3`.
The final compiled approval verifier matches the controller's build input.
`search-image.final.files.sha256.json` binds source, compiled output and locks
to the executed image. No `NODE_OPTIONS` or unqualified serving flags were used.

Actual SQL is **PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)** with **PostGIS 3.6.4**,
**pg_trgm 1.6**, **fuzzystrmatch 1.2**, `extra_float_digits=1`. The pinned PG image
manifest is `sha256:7e00e8c3539fdd43f513b98806c8204714dcd09dea683c259e333d7690317119`.
GEOS runtime is 3.14.1; PROJ runtime is 9.8.1. This differs from the proposed
hosted PostGIS 3.6.0 setting and is not evidence that the hosted version works.
Linux emulator tooling is Firebase CLI **15.19.1**, Temurin **21.0.12.1+1**,
Firestore emulator **1.21.0**, Storage Rules runtime **1.1.3**, with its own pinned
report-only build context and npm lock.

**Numerical qualification.** Before editing the guard, the independent reviewer
reconciled the retained exact-rational proof with the actual Node ELF: V8 external
references dispatch to the reviewed fdlibm sin/cos/atan/atan2 implementations;
35 constants and reducer branches agree; reviewed arithmetic uses separate SSE
binary64 operations without FMA/x87, and sqrt uses `sqrtsd`. The retained audit
script/source hashes match and its assertions passed in the actual controller
Python image. Thirteen default/no-flags arithmetic checks and 34 actual SQL pool
float8/numeric bridge cases corroborated the assumptions; maximum observed
coordinate conversion error was 2.842170943040401e-14, below the retained 1e-12
bound. Both initial and rebuilt final image diagnostics passed **318 branch/boundary
pairs** (257 positive bounds) and **1,512 radius-edge vectors** (730 accepted,
**zero misses**).

Finite vectors alone are not the universal proof. Standard compiler/IEEE
instruction assumptions remain; Rosetta was not formally verified. The initial
JIT inspection did not emit optimized function disassembly, so that specific
verification is not claimed. The independent review approved only this exact
local tuple. The guard now requires the precise Node/V8/binary/OS/architecture/
kernel/CPU combination. It preserves the prior exact Darwin tuple and rejects
Linux hosted scope **before** its local cache. Both hosted callers explicitly
request hosted scope before credential/resource construction. There is no
wildcard, environment bypass or native-hosted allowance. Final rebuild and
independent **6/6** guard tests passed without skips; the previous actual Darwin
runtime also passed all six tests using the final compiled guard.

**Executed tests and recovery.** Counts below are suite counts; overlapping
checks are not combined into a misleading grand total.

| Execution | Result and qualification boundary |
| --- | --- |
| Final actual search build | 30/30 hosted/cross-language contracts; no-I/O default dry run passed |
| Final Linux SQL/query/runtime/native HTTP | 30/30 (21 SQL/runtime plus 9 native HTTP); actual local PostgreSQL and appropriate synthetic/in-memory or emulator authority as identified in raw receipts |
| Final image native guest/handler coverage | 304/304 plus 22 differential/security/recovery and 2 supplemental tests; no failures/skips |
| Mac Flutter to final Linux backend | 4/4 flows per serial/window mode; each mode 20 guest, 20 signed-in Saver, 3 BiteScore and 3 Finder samples |
| Initial Linux source/snapshot tests | 12/12: nine source subtests plus parent and two actual Firestore/SQL snapshot integrations; unchanged source/recovery dependencies verified against final image |
| Initial Linux snapshot/cleanup/source-job contracts | 18/18; simulated GCS/provider transports, not real cloud execution |
| Actual controller image | 89 current plus 13 independent cleanup regressions = 102/102; no-I/O dry run passed |
| Requested Storage checks on Mac fixture | 5/5 account-deletion Rules plus 4/4 connected safety workflows = nine requested checks; same four workflows also passed against candidate policies, not four new unique cases |

Source tests exercised fenced bootstrap/catch-up, interruption, transactions,
parent fanout, identity separation, poison gaps and retention. Both snapshot
integrations restored **546 rows** after original SQL database deletion, resumed
an interrupted restore and replayed events beyond the snapshot fence. One used
local files, one simulated the GCS JSON API; neither establishes real GCS safety.
The final SQL/HTTP tests exercised exact matching/order/radius/ties/identities,
paging, acquisition/query deadlines and pool recovery. A real PostgreSQL fast
restart interrupted an active query (`57P01`), rejected the old connection and
reconnected through the same bounded pool. Revision, source fence, 185 entities,
185 heads, 72 pins, ordered IDs and paging boundary were identical afterward.
That is local server-restart evidence, not power-loss or hosted failover evidence.

The Storage fixture used selected source, matching `demo-coupon-app-rules`,
Firestore/Auth/Storage on local 8792/9198/9298 and the already-qualified Mac Node.
No production bucket or weakened Rules was used. The historical intermittent
concurrent-photo emulator failure and 12 old wiring-harness failures remain
separate unresolved historical evidence; these passes do not erase or diagnose
those failures. A nonexistent snapshot test glob in an initial command ran no
additional test and contributes nothing to the counts above.

**Guest results.** Flutter **3.44.1 / Dart 3.12.1 on the Mac** called the Linux
backend through the local relays. Both modes used the same timestamp
`2026-10-18T00:00:00Z`, 185 projections, revision and full source fence. Every final
guest sample rendered the same ordered 25 cards, membership digest
`13a61728a12aacbbff6a3a4d16e0273ef7fa4583ebc3c611ef4f7e8221212fe1`.

| Guest useful page | Serial baseline | Explicit window |
| --- | ---: | ---: |
| Attempts / warm samples | 20 / 19 | 20 / 19 |
| Warm median | 3,059.196 ms | 1,392.252 ms |
| Warm range | 2,918.038–3,365.318 ms | 1,270.881–2,225.986 ms |
| Warm samples at most two seconds | 0/19 | **18/19** |
| First observation | 4,230.706 ms | 2,289.407 ms |
| Search HTTP calls / continuations per page | 28 / 26 | 3 / 1 |
| Requested Firestore documents / transactions | 754 / 138 | 658 / 89 |
| SQL membership queries per page | 191 | 191 |
| Errors / transport retries | 0 / 0 | 0 / 0 |

The warm median improved **54.49%**. The window did **not consistently meet two
seconds**; empirical nearest-rank p95 in these 19 warm samples is the maximum,
2,225.986 ms. It is not hosted tail evidence. The prior Mac-only **754.386 ms warm
median** is retained separately and is neither an average nor a production
guarantee. Signed-in warm medians were 415.965 ms (serial) and 443.49 ms (window).
No nationwide, hosted p95/p99, native-host performance or production guarantee is
claimed.

Independent checks confirmed the global **75-history-ID** bound, exact history
intersection and approved disclosure scope, membership/order/useful pages,
actor/realm/session/revision binding, replay/lost-response recovery, expiry,
cancellation/account-switch fencing and Firestore ownership/redemption authority.
Signed-in Saver, BiteScore and Finder paths passed. QR/deep-link/profile/menu,
Saved/favorites and redemption contracts were not modified. The initial fixture
attempt could not reach the backend through an internal-network published port;
it was interrupted with no backend calls. The next attempt lacked the Mac Auth
relay and produced **2/4 passing tests**, including 19/20 successful guest samples
and failed signed setup. Both failed logs/results are preserved. Fixed, report-only
loopback relays yielded the final 4/4 passes in each mode; assertions and source
were not weakened.

**Which hosted mode is frozen?** Local tests explicitly exercised both modes.
The hosted configuration currently has **no guest-window selector** and would
choose serial once separately qualified for hosted execution. More immediately,
this exact Linux image refuses **all hosted execution**. A local test switch does
not select the future cloud mode. The smallest future source dependency is a
validated, signed, default-off `hosted.guestRestaurantWindow` setting propagated
through the permit-bound cloned configuration, with default/true/invalid/tampered
configuration tests. No production switch was added or enabled here. Native
hosted CPU/server proof reconciliation must precede any hosted guard allowance;
affected source and final image must then be rebuilt, tested and independently
reviewed. Current PASS records cannot be reassigned to changed hashes.

**Independent review, findings and evidence.** Separate reviewers covered the
actual math binary/final guard, guest mode/authority/performance, actual controller
and Storage tests, and final source/recovery/image/preservation evidence. Their
receipts and raw relevant output are in
[qualified-evidence-linux-004](qualified-evidence-linux-004/evidence-index.json).
The index hashes copied evidence; large local recovery objects are referenced by
hash rather than silently omitted. The external run directory is
`/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-LINUX-QUALIFY-004-20261017`.
The actual owner Bug Filter and relevant Sanity Checklist sections were applied.

- **FIX NOW / DIRECTLY REQUIRED:** exact local runtime qualification, hosted
  refusal before cached local approval, and ordinary local fixture reachability;
  corrected and verified within the permitted scope.
- **FIX SEPARATELY — REAL BUG:** the missing hosted window-selection dependency
  would make a future experiment accidentally serial; explicitly identified for
  the next bounded source-preparation task. Historical wiring-harness failures
  retain their prior classification and were not reopened.
- **PRODUCT DECISION REQUIRED:** exact future isolated project/resources,
  identities, recipients/fallback and paid drill authorization. Existing SQL
  cleanup consent stays conditional on actual exclusivity/single-use evidence.
  Docker size/revenue eligibility is already resolved, not a remaining decision.
- **ACCEPT AND CLOSE:** bounded local timing variability and its explicit
  measurement limits; no further performance redesign was justified. No
  outstanding regression caused by the four source edits was found.

**Exact remaining pre-spend handoff.** Reuse
[PROVIDER-GATE1.md](PROVIDER-GATE1.md),
[DURABLE-SNAPSHOTS.md](DURABLE-SNAPSHOTS.md) and the local-003 resource/control
plan. These are proposals, not existing cloud resources.

1. Complete the small local signed hosted-window selection dependency above and
   prepare the separately gated native-host numerical probe. Actual native
   CPU/managed SQL compatibility requires provider evidence in an approved small
   gate; it cannot be inferred from Rosetta. Keep hosted serving closed until
   proof reconciliation, exact tuple review and final rebuild verification pass.
2. Obtain owner approval of one isolated project ID/number and exact never-reused
   resource plan. Derive run-specific SQL/search/load/restore/network/subnet/
   artifact/control names from the existing `resourceNamesProposed` template;
   replace its dated run prefix only in a future signed plan. Preserve the
   proposed `us-central1`, private SQL, zero public SQL IP and bounded instance/
   connection settings unless explicitly approved otherwise. Freeze allowed
   synthetic Firebase project/origins and ingress/App Check policy. No resources
   have been created by this run.
3. Establish scoped controller, watchdog, workload, Workflow and Scheduler
   identities, private networking and SQL IAM user/grants. The watchdog may
   stop/delete/cancel owned resources but not provision; Workflow only invokes
   the watchdog, Scheduler only invokes Workflow. Verify effective rights and
   token refresh without service-account keys. Supply control/config/trust and
   independent evidence bucket identities, provider creation metadata,
   object/prefix/generation/retention policy, separate trust keys and signed full
   configuration. Evidence must outlive disposable SQL.
4. Name two approved alert channels/recipients and a human cleanup/recovery
   fallback. Collect real delivery evidence and watchdog/scheduler-silence
   behavior during the drill; publish acceptance is insufficient. Supply actual
   independently reviewed SQL lifecycle-exclusivity and single-use-name evidence
   bound to exact resource incarnation/start/deadline. Conditional cleanup consent
   does not establish those facts. If unavailable, obtain explicit supervised
   deletion approval; that fallback does not qualify unattended operation.
5. Seek separate approval for **only the small supervised first provider safety
   drill**, initially Gates 1 and 5: current plan $15, including at most $5 and
   900 seconds for bootstrap. Freeze real configuration/approval/evidence and the
   conservative start before any billable setup/upload. Exercise runner loss,
   replay/restart/lost reply without duplicate create/run, independent watchdog,
   cancellation/SQL-stop completion, denied or unknown responses, replacement
   refusal, exact deletion/absence and continuing storage/backups/artifacts/logs/
   control-plane/delayed charges. Prove private SQL authentication, actual native
   numerical compatibility, browser transport and real GCS snapshot restoration.
   No synthetic receipt may set real readiness/guardian/alert flags or approvals.
6. Reconcile that drill before seeking separate broader hosted performance/load
   approval. Retain the approximately **$300 planning ceiling**, **$30 reserve
   within it**, separate signed **$100 forecast checkpoint**, and original,
   non-resetting **72-hour maximum** from before first billable work. The prior
   dated worksheet's $244.85 including reserve is a planning estimate, not a
   guaranteed bill cap. No clock or spending authorization begins here.

All task services were stopped and Mac loopback listeners closed. PostgreSQL,
emulators and the Flutter host exited 0. The stateless task relay required Docker's
stop timeout and exited 137; no graceful-exit claim is made for it. Reviewer
containers were removed; qualified images, stopped task containers, SQL volume
and evidence remain. The installation DMG was unmounted; Docker stays installed.
No global prune or unrelated service/data deletion occurred. The canonical
backlog receives a final append preserving its history, including this resolved
license confirmation and the remaining gates.

**No paid resources. No hosted investigation. No real 72-hour timer.
No production deployment or activation.** No IAM, billing, secrets, DNS, Auth,
customer-data, website, phone/store, real OpenAI/Vision or other production change
was performed.
