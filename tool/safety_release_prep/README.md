# BiteStar safety/backend release preparation

Run **BS-BITESTAR-SAFETY-BACKEND-RELEASE-PREP-001**. Owner prompt prepared
October 17, 2026, 3:26 PM EDT / 19:26 UTC. Role: source integration, local
qualification and proposed coordinated release preparation. Expected and actual
starting `main`: `14b341f61eb3e914a5c450cfb4f92de44e665002`.

The existing safety systems now have a reviewed combined preparation package,
two narrowly scoped source repairs and enabled integration evidence. This is a
**source/preparation checkpoint with an explicit local test limitation**, not
production qualification. The broader backend suite retained one intermittent
concurrent-photo emulator failure; an unchanged isolated repeat passed. Neither
that pass nor the independently verified retry repair proves the cause fixed.

No production deployment, activation, provider request, paid investigation,
secret/IAM change or customer-data mutation occurred. Published legal material,
client/runtime defaults, identity/billing, search implementation and existing
production holds were preserved. Exact future actions remain nonexecuting.

## What changed and why

1. `firestore.rules` now lets the existing Admin Remove Review flow delete the
   review's feedback votes, including votes by other users. Previously that
   legitimate cleanup stopped with permission denied. The change preserves
   account-deletion and dish/restaurant operation locks and grants no additional
   vote creation/update permission. Actual query/delete order is covered.
2. Customer photo, owner photo and written-review completion now distinguish
   expected policy denials from Firestore infrastructure errors. Policy denials
   still keep content private; infrastructure errors reach the transaction SDK.
   A retry reuses the provider result without another provider submission or
   admission charge. Failed text completion still reports an already saved
   numerical rating honestly.

No client source change was necessary. New tests cover the integrated Terms,
screening, owner attachment, processing pause/retry, report retention and personal
block behavior. The isolated candidate verifies the exact published Terms and
proposed runtime metadata. Candidate Rules start from the current live baseline,
preserve deliberate holds and public readers, and include only the safety
cutover and its demonstrated caller dependencies. They are **not deployed**.

## What works locally and what remains separate

| System | Local evidence | Release state / limit |
| --- | --- | --- |
| Shared Terms and registration age | Exact version/text, affirmative acceptance, wrong UID/account switching, cancellation, age 12/13 and existing sign-in/recovery/deletion covered | Terms/age source defaults remain off; exact future bindings and supported build must be selected and retested before activation |
| Review/rating and text screening | Ratings survive held/failed words; earlier approved words retained; same-content retry preserves identity/time; policy/private reads and expiry covered | Deterministic provider only; real credentials/model/limits and production TTL timing remain unverified |
| Customer and owner photos | Trusted admission, private states, pause races, original retention deadlines, explicit owner attachment, exact removal and cleanup covered | One intermittent existing emulator concurrency failure remains; real provider, GCS generations/tokens/ACL/cache/soft-delete behavior require authorized live checks |
| Report Review/Photo, personal block, posting restriction | Private identity/paging, exact content reports, reports after missing supporting review, unchanged shared photos, posting fences covered | Existing UI/source reused; no Report Reviewer control, Stage 2D or Admin review movement was added |
| Retention and account deletion | Existing workers, late-media cleanup, owner-photo deletion and relevant Rules rerun | Physical deletion is asynchronous; bucket metadata has seven-day soft delete. No immediate permanent-purge claim |
| Backend/read dependencies | Exact exports, source wrappers, current revisions/holds, proposed config/IAM/index/TTL order inventoried | Existence/Ready metadata does not prove source parity or a reusable rollback image; later exact revision/image and drift verification required |

The tested combined candidate displays the existing full Terms naming OpenAI
and Google Cloud Vision and obtains affirmative UID-bound acceptance before the
responsible contributor's provider work. The [provider assessment](provider-prerequisites.md) explains why another
permission control was not demonstrated necessary. This is a supported reading
of current official guidance, not legal or store acceptance. No disclosure or
approved retention policy was rewritten.

## Verification and limitations

See [Track A](track-a.md), [Track B](track-b.md),
[independent review](independent-review.md) and `evidence-index.json` for exact
tests, bytes, failures and reruns. Test logs are committed under `evidence/`.

| Check | Result |
| --- | --- |
| Focused Flutter service/widget/legal checks, 28 disjoint files | **644 passed, 0 failed** |
| TypeScript build, Node 24.19.0 | PASS |
| Existing lifecycle batch before completion correction | 213/214 passed, 0 skipped; one concurrent-photo code-3 emulator error |
| Final affected backend batch, nine files | 205/206 passed, 0 skipped; same intermittent concurrent-photo error |
| New deterministic completion-error regression | **6/6 passed**, provider/admission once; preserved before failures |
| Final provider and index contracts | **39/39 passed**, 0 skipped |
| Existing relevant source Rules regressions | **25/25 passed**, 0 skipped |
| New source / baseline-aware candidate Rules | **13/13 and 15/15 passed**, 0 skipped |
| Final connected source / candidate lifecycle with exact metadata | **4/4 and 4/4 passed**, 0 skipped |
| Unchanged concurrent-photo case after isolated emulator restart | **1/1 passed**; does not erase the suite failure |

Final connected source/candidate results are recorded in Track B and the evidence
index. Counts overlap across reruns; do not add them into a unique-test total.
This was focused qualification, not a whole-repository pass. Original failures
were retained. The initial Storage fixture used the wrong demo project and was
corrected without weakening assertions. A new text regression initially expected
a committed rating save to reject; it was corrected to the established contract.

The recurring existing photo test failure was `INVALID_ARGUMENT (3): Transaction
is invalid or closed` after emulator lock timeouts. It occurred before and after
the source repair, and passed unchanged in isolation. The first traced error was
already code 3; evidence does not establish a swallowed code 10 caused it. No
special retry for code 3, weakened concurrency assertion or production behavior
workaround was added. Production contention behavior remains an explicit later
synthetic acceptance check.

## Release package and recovery

[release-manifest.json](release-manifest.json) and
[release-dependencies.md](release-dependencies.md) identify exact function/service
resources and dependencies, preservation requirements, known/unknown live state,
source references, tests and acceptance/recovery. `candidate/` contains the
reviewed policy overlays, canonical Terms, paused/enabled runtime phases,
index/TTL deltas, IAM proposals and a disabled execution descriptor. No broad
deployment command is included.

The proposed release needs trusted writers/readers and deletion/cleanup workers
ready before content admission. Both customer and owner upload lanes require the
coordinated Storage cutover. Existing recent Admin, coupon, media, Hosting and
deletion work is preserved; it is not blindly redeployed from historical reports.
Only the necessary moderation-points reconciliation hold has a specific proposed
release path. Other holds remain recorded and intact.

Recovery pauses processing while keeping Terms/screening enforcement, private
content protections and cleanup. Deleting runtime records or changing required
policy to false restores legacy behavior and is **not** safe recovery. Already
issued storage work may finish; inspect exact identities/generations and recover
cleanup before reopening admission. Owner asset availability never implies
attachment. Retain and verify exact rollback artifacts immediately before a
separately authorized rollout.

## Preservation and search impact

All 13 pre-existing owner/report files and all 118 frozen PostGIS files must match
their starting hashes; `preservation.json` records the final check. They are not
staged by this task. Published legal files and unrelated production source are
unchanged. The two pre-existing modified tests remain owner work in `main`.

Three files in the older 518-file PostGIS v4 source manifest changed: the three
completion modules above; its other 515 paths are unchanged. The root Firestore
policy also changed, but was not included in that older manifest.
`combined-source.json` records old/new hashes and this run's affected qualification without replacing
v4 evidence or claiming all old qualification transfers. The new preparation
snapshot includes the current v4 source set plus directly relevant safety/legal
source/test manifests and this run's candidate resources. It does not turn
disabled bindings into an activated release, choose a search backend or approve
paid work. Any later relevant edit requires affected tests/review and a newly
selected combined freeze.

## Material findings and remaining decisions

| Classification | Finding / disposition |
| --- | --- |
| FIX NOW / DIRECTLY REQUIRED | Admin vote cleanup and three swallowed transaction-error paths repaired and regression-tested |
| FIX NOW / DIRECTLY REQUIRED | Candidate overlay tightened to preserve closed Admin review movement, first-time empty shared-menu linkage and exact Terms-guarded owner/name-request dependencies; reviewed/tested locally |
| FIX NOW / DIRECTLY REQUIRED | New test-project and committed-rating expectation mistakes corrected with original evidence retained |
| ACCEPT AND CLOSE | Bounded local qualification accepts the recorded intermittent emulator limitation, not a claim of no defect. Cause and production relevance remain unproven; preserve the unchanged concurrency test and require the later real contention check before production qualification |
| PRODUCT DECISION REQUIRED | Paid hosted search authorization, investigation findings/production search choice, guest protocol/privacy direction and SQL exclusive ownership versus supervised deletion remain owner decisions |
| ACCEPT AND CLOSE | Existing affirmative provider-disclosing Terms, approved 30-day pending/seven-day failed retention, owner-operated review and shared 1,000-attempt allowance retained; no speculative new system |

The required next sequence is:

1. Finish any intervening source work and **select/freeze the tested combined
   source before paid investigation**. This checkpoint supplies the safety
   preparation evidence and exact pending bindings.
2. Separately authorize the approximately $300 hosted search investigation.
   Resolve the actual Linux execution/image evidence, performance findings
   (guest search does not consistently meet two seconds), privacy/protocol and
   deletion-ownership choices; approve the production search choice.
3. Recheck source/dependency/live-state drift, approve exact provider/prerequisite
   configuration and targeted rollout, and qualify authorized synthetic live
   workflows including contention, storage privacy, retention and deletion.
4. Complete final Android/iPhone acceptance and store readiness on the selected
   build. No website build or extra product workflow is part of this preparation.

## Checkpoint

This report is intended for the exact reviewed commit on `main`, tagged
`bs-bitestar-safety-backend-release-prep-001`. The containing commit resolves the
final source identity; the external completion receipt records actual commit,
annotated tag, remote verification, completion time, backlog update and service
cleanup after execution. Committed evidence must not be edited to manufacture a
later qualification. Source-corrected, tested, reviewed, committed, deployed,
default-active and production-qualified remain separate statuses.
