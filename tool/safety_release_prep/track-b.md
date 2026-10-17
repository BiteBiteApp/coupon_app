# Track B — connected safety lifecycle qualification

Run: `BS-BITESTAR-SAFETY-BACKEND-RELEASE-PREP-001` · prepared October 17, 2026.
Permitted area: backend logic, integration tests and release evidence. The
integrator authorized three demonstrated completion-error corrections below.
Runtime defaults, provider bindings and published legal content are unchanged.
The integrator's report records the separate policy fix.

## Execution paths reused

| System | Actual trusted path exercised | Existing qualification reused |
| --- | --- | --- |
| Written reviews | `saveCustomerBiteScoreReview` → transaction aggregate/Terms/restriction/deletion checks → `prepareReviewText` → deterministic provider → `finishReviewText`; `decideReviewTextHandler` and `expireReviewTexts`; public projections read approved source fields only | `REVIEW_TEXT_MODERATION_QUALIFICATION.txt`, newer `REVIEW_TEXT_RETENTION_QUALIFICATION.txt` |
| Customer photographs | `submitScreenedPhotoHandler` → account identity/Terms/parents/restrictions → shared admission → real emulator tokenless Storage objects → deterministic provider → exact generation/identity publication → image projection and contribution award | `SAFESEARCH_SOURCE_QUALIFICATION.txt`, newer `SAFESEARCH_RETENTION_QUALIFICATION.txt` |
| Owner photographs | `submitScreenedOwnerPhotoHandler` → exact owner/source/target/Terms/admission → same private storage/provider contract → available asset; `useOwnerScreenedPhotoHandler`, `saveOwnerMedia`, profile attachment checks publish separately | `SAFESEARCH_OWNER_MEDIA_QUALIFICATION.txt` |
| Report Photo | `submitPhotoReportHandler` captures exact source version; `moderatePhotoReportHandler` resolves/removes exact current image independently of a subsequently missing supporting review | Existing photo-report emulator suite and SafeSearch integration evidence |
| Personal blocking | `blockReviewerHandler`/`unblockReviewerHandler`/`getReviewerSafetyStatusHandler` protect account identity, revision and deletion boundaries; public photographs remain shared | Existing reviewer-safety suite, account-deletion integration; client paging/retained-screen coverage is recorded by Track A |
| Posting restrictions | Actual callable wrappers and `setAdminPostingRestrictionHandler` enforce 7-day/14-day/indefinite choices, trusted expiry/release and actor/target fences; review/catalog callers reject while Auth identity remains enabled | Existing posting-restriction unit and emulator suites |
| Retention/deletion | `maintainScreeningPhotos`/`cleanupScreeningPhoto`/`screeningPhotoFinalized`, `expireReviewTexts`, `requestAccountDeletionHandler`/`processAccountDeletionJob`/`createAccountDeletionStep` | Existing retention, deletion and owner-photo full-deletion emulator suites |

Source presence is not a deployment receipt. Current deployed revisions, held
services, policy baseline and exact proposed resource ordering are recorded in
the integrator/Track C release inventory. None is inferred deployed here.

## New combined fixture

`functions/test/safety_release_integration_emulator.test.js` loads the exact
published `legal/terms-of-service.txt`, verifies its manifest SHA-256 and
`bitestar-terms-v1` / October 17, 2026 identity, and passes the approved text only
as an isolated test dependency. Real acceptance writes come from the established
trusted receipt writer using synthetic UIDs and time. It does not fabricate
production receipts or change `approvedBiteScoreTerms = null`.

Four connected cases exercise:

1. Customer/owner acceptance followed by an actual rating save, customer review
   photo publication and owner menu asset approval plus explicit attachment.
   The exact accepted text/time is checked, missing receipts admit no provider
   work, and customer acceptance grants no owner attachment authority.
2. Concurrent text/customer-image/owner-image provider completions racing a
   processing pause. All stay private; the earlier approved words and rating
   survive. Re-enablement and explicit retry preserve text version and original
   submission time, photo identity, and original owner 30-day deadline. Owner
   recovery still requires attachment.
3. Missing/default-OFF versus malformed required policy, with no provider calls
   on denied submissions. Direct customer/owner/Admin upload bypasses stay denied.
4. A screened photo stays publicly readable after a personal block; its exact
   report remains actionable after the supporting review disappears, then exact
   Admin removal prevents resurrection.

The test accepts only `SAFETY_RELEASE_RULES=source|candidate`. Candidate selects
the reviewed baseline-aware files under `tool/safety_release_prep/candidate`;
it never loads arbitrary policy paths or applies any policy to production.
It strictly compares the displayed published Terms with `approved-terms.json`
and the isolated enabled/paused runtime records with `runtime-phases.json`,
including the disabled execution descriptors. Therefore the enabled test
configuration is the exact proposed metadata, not an untracked approximation.

## Safe processing pause and recovery

Keep Terms enforcement and current receipts intact. For text, retain
`required:true`, the exact approved retention configuration and
`cleanupEnabled:true`; pause using `processingEnabled:false`. For images,
retain `required:true`, `ownerRequired:true`, approved retention metadata,
`cleanupEnabled:true` and the coordinated Firestore/Storage cutover policy;
pause new scans with `enabled:false` and `ownerEnabled:false`.

Deleting the Terms or review-text runtime documents, or setting their
`required:false`, is deliberately the legacy/default-OFF behavior and is **not a
safe post-activation processing pause**: missing review-text policy allows the
historical direct-word save. Missing photo policy instead denies screened
admission. The fixture proves this distinction rather than falsely claiming
that dormant defaults enforce screening.

An ordinary provider outage must not disable cleanup. If a cleanup incident
requires `cleanupEnabled:false`, new admissions stop, terminal/private states
remain private, and already-issued Storage operations may finish. Restore the
reviewed cleanup worker/configuration first; inspect due/attention cases and
resume bounded cleanup. Never restore old permissive upload Rules as recovery.
Text human approval under valid policy is an intentional independent Admin
action; photo Admin approval and owner attachment retain exact content and
authority checks. Recovery must not turn a held owner asset into publication.

## Demonstrated backend correction

Completion transactions in `photo_screening.ts`, `owner_photo_screening.ts` and
`review_text_moderation.ts` previously caught every error from their policy and
identity reads. A Firestore transaction abort was therefore treated like a
policy denial instead of reaching the SDK's transaction retry handling. The
observable consequence is a valid screened submission incorrectly failing or
remaining unresolved under a transaction read failure. Content did remain
private; this was not an unchecked-publication bypass.

The smallest correction catches expected `HttpsError` policy denials as before
and rethrows infrastructure errors. The transaction SDK can retry completion
reads using the existing provider result. No provider resubmission, admission
reservation, content-policy change, new retry wrapper or timeout change was
introduced. The outer written-review writer continues reporting the already
committed numerical rating honestly if final text completion fails.

`functions/test/safety_transaction_retry.test.js` injects a single Firestore
`ABORTED` code 10 at the actual completion identity read for each of the three
writers, using real emulator transactions. It verifies that the transaction
adapter receives the abort, the completion succeeds after SDK retry, the
provider runs once, and photo attempt/reservation counts stay one. Three more
cases inject nonretryable code 3 and prove no unchecked publication or extra
provider traffic; text still reports the saved rating. The tests use explicit
Storage/identity doubles solely to isolate this transaction boundary; the
combined fixture separately tests actual Storage and synthetic Auth identities.

This issue is classified **FIX NOW / DIRECTLY REQUIRED**. The final injected
regression passes 6/6; the preserved initial run exposed all three swallowed
abort paths. One initial test assertion incorrectly expected the outer text
writer to reject even though its rating had committed. That fixture was
corrected to check the adapter receives the error, the rating survives and the
private proposal remains unresolved; established save behavior was preserved.

## Provider and live qualification still required

The photo adapter uses ADC, `https://vision.googleapis.com/v1/images:annotate`,
only `SAFE_SEARCH_DETECTION`, a 20-second transport timeout and no SDK retry;
handlers bound provider waiting at 22 seconds. Its real adapter explicitly
denies emulator/test contexts. Shared admission covers customer and owner lanes:
1,000 reservations per UTC month, no refund, four global leases, four per-user
admissions/minute and at most two explicit attempts per immutable image/context.
Reservations are **not a guaranteed total spending cap**.

Text uses `omni-moderation-latest` at `/v1/moderations`, sends only headline and
review text, rejects malformed provider responses, bounds transport at eight
seconds and local provider concurrency at two, and makes no automatic retries.
The save wrapper's `reviewTextProviderWiringEnabled=false` and absent secret
binding remain unchanged. Future authorized release must qualify the exact
`OPENAI_REVIEW_MODERATION_API_KEY` reference/binding, provider project/access,
minimum permissions, availability/rate limits, timeout recovery and current
model response schema before activating processing. No key value was read.

Deterministic responses prove application workflow behavior, not classifier
accuracy, real credentials, live provider availability or provider retention.
Real Storage generation preconditions, IAM/ACL/download-token bypass, public
cache behavior, soft delete and asynchronous physical deletion remain live
checks. The Storage emulator does not enforce production GCS generation
preconditions; existing adapter-contract and injected race tests supplement
local byte/Rules tests without claiming that live guarantee.

## Evidence and findings

Raw logs live under
`/Users/colesmart/.codex/reports/BS-BITESTAR-SAFETY-BACKEND-RELEASE-PREP-001/track-b/`.
Final counts and hashes are recorded below after execution.

- `integration-first.log`: initial 1/4 pass, three expected-public-read 403
  failures. The new fixture used a different demo project from the configured
  Storage emulator's cross-service Firestore project. Emulator request logs
  identified those lookups against the configured project. The fixture was
  aligned with that isolated project; all original read assertions retained.
  Classification: **FIX NOW / DIRECTLY REQUIRED** — test-fixture correction,
  not a production source defect. These failing bytes/logs are preserved.
- `lifecycle.log`: initial existing lifecycle run passed 213/214 with no skips.
  The unmodified concurrent missing-photo case failed with Firestore emulator
  code 3, `Transaction is invalid or closed`, following emulator lock timeouts.
  A focused repeat and read trace are retained as `photo-contention-rerun.log`
  and `photo-contention-trace.log`. The first surfaced trace error was already
  code 3, so it does not prove that an earlier swallowed code 10 caused that
  exact emulator failure. This investigation exposed the independently proven
  transaction-retry suppression defect above. The unchanged concurrency test
  later passed 1/1 in `photo-contention-after-source.log`, then encountered the
  same code 3 in the final affected suite (`affected-final.log`: 205/206 passed,
  no skipped tests). The report does not equate a focused pass with proof of
  the emulator error's precise cause or silently claim that failure fixed.
  After one restart of only the task-owned emulators, that exact unchanged
  case passed 1/1 again in `photo-contention-after-restart.log`. Classification:
  **ACCEPT AND CLOSE** for this bounded local emulator limitation, preserving
  all failures and adding exact concurrent missing-photo publication to later
  authorized live acceptance. No source retry shim or weakened assertion was
  introduced to hide the emulator error. This is not a production guarantee.
- **ACCEPT AND CLOSE** — intentional dormant legacy behavior remains unchanged;
  recovery explicitly avoids using it to pause an enabled candidate.
- **ACCEPT AND CLOSE** — 30-day pending/seven-day failed policy, owner-operated
  review, conservative hold and shared 1,000-attempt allowance are already
  approved; this preparation does not reopen them or add a blanket metadata
  retention duration.

The checks make sense because they connect already-built trusted writers,
readers and cleanup with the same enabled policy. They can execute now using
isolated emulators and deterministic providers. They are necessary for
composition and recovery evidence. Recovery is bounded and safe because only
synthetic project state is touched and task-owned services are stopped by the
integrator after all tracks finish.

## Verification records

All final runs use bundled Node **24.19.0**. A preliminary 59-test unit run used
the shell's Node 26; final Node 24 runs supersede that preliminary evidence.

| Log | Result and scope |
| --- | --- |
| `build.log` | TypeScript build PASS after all three source corrections |
| `lifecycle.log` | Initial 213/214, no skips; existing text/photo/owner/report/reviewer/restriction/Terms/account-deletion and provider contracts |
| `transaction-regression-before.log` | Preserved failing injection evidence; all three transaction paths swallowed infrastructure errors |
| `transaction-regression-after.log` | 5/6 after source correction; remaining failure was the fixture's incorrect expectation that a committed rating save rejects |
| `transaction-regression-final.log` | Corrected contract assertions 6/6 PASS, no skips |
| `affected-final.log` | 205/206 after source correction, no skips; full affected text/customer/owner photo lifecycles, finalized-media deletion, review aggregate, public reads/photo DTOs, combined fixture and transaction regression; only documented intermittent emulator code 3 failed |
| `provider-index-final.log` | 39/39 PASS, no skips; photo/text provider contracts and strict index contract |
| `rules-source.log` | 25/25 PASS, no skips; photo report, review text, account deletion, reviewer-safety and posting-restriction Rules after the integrator's narrow Admin cleanup policy correction |
| `photo-contention-after-restart.log` | Exact unchanged previously failing case 1/1 PASS after one task-owned emulator restart; prior intermittent failures remain recorded |
| `integration-source-final.log` | Final combined fixture and exact candidate metadata assertions 4/4 PASS against repository Rules, no skips |
| `integration-candidate-final.log` | Same final fixture/metadata 4/4 PASS against baseline-aware candidate Firestore and Storage policies, no skips |

Do not add these counts together as unique tests: focused reruns overlap.

Independent Track A reviewer verified the final three source files and
transaction regression below, and rereviewed the combined fixture after its
metadata-binding assertions were added. Verdict PASS; review was static plus
inspection of the execution evidence, not an independent live provider run.

| Final file | SHA-256 |
| --- | --- |
| `functions/src/photo_screening.ts` | `97e8c588185c92eaad07ff5c82330ef03988799220ac0fe01cfb5550b803430f` |
| `functions/src/owner_photo_screening.ts` | `33bd9ae05e99e377fe1e7a774021550ad2e5cae001bfcf2a20a25c10afc029d3` |
| `functions/src/review_text_moderation.ts` | `26898d5a4538666b4fe698063e811b0654f8a79ca99deb2307ca50440ac98ac1` |
| `functions/test/safety_transaction_retry.test.js` | `ca3c77cea1fc80ac2765df1c2fb174384a3a2e92bda39a4aa7541a8ed690a8b0` |
| `functions/test/safety_release_integration_emulator.test.js` | `52d93731caafb47661d1c3ffc3a0a0cde5ac92888c4b1a8b0b2d0d759ea53b07` |

Track B verdict: existing source reused; three small completion-transaction
corrections locally tested and independently reviewed; the connected enabled
candidate and exact proposed policy/configuration pass the four composition
cases. The documented intermittent emulator concurrency limitation and later
provider/live/device checks remain explicit. No production deployment,
activation, paid resources or real provider submission occurred.
