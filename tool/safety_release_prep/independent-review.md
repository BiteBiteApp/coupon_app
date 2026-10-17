# Independent source and release-preparation review

Run: `BS-BITESTAR-SAFETY-BACKEND-RELEASE-PREP-001`.
Reviewer: Track A, acting as a second reader for integrator/Track B/Track C work.
The reviewer did not author the implementation corrections or candidate policies.
The reviewer's client qualification report is not represented as independently
reviewed by its own author.

## Current review status

The files explicitly listed below passed review at the recorded bytes. Other
files, and later replacements of these bytes, do not inherit this verdict.
Backend completion-error corrections passed final-byte review as recorded below.
Final release inventory/configuration and integrator README passed the review
recorded below. The final 648-path combined-source snapshot also passed independent
hash and v4-difference recomputation. This is a source/preparation review with the
explicit emulator limitation,
not production qualification or authorization to execute the proposed release.

| Reviewed path | SHA-256 | Finding |
| --- | --- | --- |
| `firestore.rules` | `5c85dc83ace3374a0d590e08287d5cd19e440234327798647077a387a984f5a8` | PASS: narrow Admin vote deletion, existing fences retained |
| `firestore_rules_tests/test/safety_release_candidate_rules.test.js` | `dc16852784e3723cdcfe16d936230751e3896f80be1c284fc4accabb95d6e437` | PASS: actual query/deletion order, negative boundaries and candidate compatibility |
| `functions/test/safety_release_integration_emulator.test.js` | `52d93731caafb47661d1c3ffc3a0a0cde5ac92888c4b1a8b0b2d0d759ea53b07` | PASS: combined lifecycle fixture, exact published Terms and proposed config assertions; source/candidate 4/4 logs reviewed |
| `functions/src/photo_screening.ts` | `97e8c588185c92eaad07ff5c82330ef03988799220ac0fe01cfb5550b803430f` | PASS: completion policy denial holds; infrastructure error propagates |
| `functions/src/owner_photo_screening.ts` | `33bd9ae05e99e377fe1e7a774021550ad2e5cae001bfcf2a20a25c10afc029d3` | PASS: same narrow distinction; explicit attachment retained |
| `functions/src/review_text_moderation.ts` | `26898d5a4538666b4fe698063e811b0654f8a79ca99deb2307ca50440ac98ac1` | PASS: completion fences retained; infrastructure error propagates |
| `functions/test/safety_transaction_retry.test.js` | `ca3c77cea1fc80ac2765df1c2fb174384a3a2e92bda39a4aa7541a8ed690a8b0` | PASS: real SDK completion retries, single provider/admission and private failure contract |
| `tool/safety_release_prep/track-b.md` | `427a939da0768bc75586910d8581d0aea665ab8a96d0bbfec59beb6c84ebe167` | PASS: final evidence distinguishes deterministic correction from intermittent emulator limitation |
| `tool/safety_release_prep/preflight.md` | `1cea11f9cce62cc5afa7d330ea33c517cda4b34946c0b2811d72ed1f825e2ed0` | PASS: scope, environment and order |
| `tool/safety_release_prep/provider-prerequisites.md` | `d3f6e8c40c6eab96fd2de0fc4e77983d13245247d3c4fd791ba7cf25c2592ea9` | PASS: cited permission interpretation and provider/setup limits |
| `tool/safety_release_prep/candidate/firestore.rules` | `d6b852ffb8a3b313525d6a8692173fa8e5d0bae4b2370585f3dd55e26be4d913` | PASS: bounded overlay, exact compatibility repairs, no Admin review movement |
| `tool/safety_release_prep/candidate/storage.rules` | `d6c78226ac081972d53889bb7042a78ce47f505975f08d980a396f106f9ce269` | PASS: exact approved readers; unchecked uploads remain denied |
| `tool/safety_release_prep/candidate/policy-delta.json` | `1c08d1f0e312fd982d2b99ebe962ba4c5d4a8109e28e638de50b7f6a4c024452` | PASS: candidate/base hashes and nonexecuting status |
| `tool/safety_release_prep/README.md` | `32e2a9a98da8b8cfe379c92acda1787903a01d65e699ae5d003a0e6369d162f1` | PASS: scope, exact evidence, failure limits, before-paid freeze and current status |
| `tool/safety_release_prep/release-manifest.json` | `058c63ac8d083d20da2c30c7465550ac419b51f8cfa8cad7cb8fca63ac6b120e` | PASS: 53 exact targets, dependency ordering, preserved existing releases and no assumed source parity |
| `tool/safety_release_prep/release-dependencies.md` | `b746c339a8aec23d09b591ae563ed300be11da4d88df8b4bd0e11f583ebb58e7` | PASS: caller dependencies, retained holds and future verification boundaries |
| `tool/safety_release_prep/validate_package.py` | `c802cb02fedae6a85a7ba77bb38048d17e87bb15dcac2aeccf1580ad39447306` | PASS: read-only consistency check; personally executed successfully |
| `tool/safety_release_prep/candidate/approved-terms.json` | `3f1bb2296bc3036cfb2f83a786fd0562295c084621564ef3bd0b08c8af6ef243` | PASS: exact published text/version; explicitly not a receipt |
| `tool/safety_release_prep/candidate/runtime-phases.json` | `bb249aef487d6b3051e9fd5ac5f54865af8da8b27e3e7b3d2b965c70dc1d6ebc` | PASS: mandatory paused enforcement and cleanup; isolated enabled composition tested |
| `tool/safety_release_prep/candidate/index-field-deltas.json` | `b5055f23018b4835fcdade50f1197b3a4344130048432cee725037aec1bd957a` | PASS: six source-declared fields only; existing indexes preserved |
| `tool/safety_release_prep/candidate/iam-proposals.json` | `b5d4abe5a1fbdb7afe4a07631a696006c11e9d2494e7a671cc171b93e34e6424` | PASS: exact regional invoker/runtime scopes, minimal proposed grants, existing service agents preserved |
| `tool/safety_release_prep/candidate/execution-descriptor.json` | `331cbafe2cd647531dd865f4e8a23c93f5d075410c6308e68a2e88b8d2edc9cb` | PASS: disabled authority, four explicit future source bindings and freeze before paid investigation |
| `tool/safety_release_prep/candidate/qualification-contracts.json` | `84ce5492a5cb5868efb581ec8e9677741280d4d33dabfa3b4012899f9e9f8a2a` | PASS: 14 referenced groups distinguish file inventory, execution and future acceptance |
| `tool/safety_release_prep/local-verification.json` | `b5b000962b93955a4987085bd4ede93f42895302df7fd00129f9742deefecec8` | PASS: eight file/env/command records match recorded log counts; no new execution |
| `tool/safety_release_prep/evidence-index.json` | `99f61f890aadf4bed2216af329809baa70bd12a75ca7e49ba4680a4aa95d10c3` | PASS: personally compared all 24 copied logs with originals, sizes and hashes |
| `tool/safety_release_prep/preservation.json` | `a3bdcbc070d6926a9862dbcfd6e39b3e388d5f575ae3525a57c1d36f4628cb3a` | PASS: personally checked all 13 protected and 118 frozen paths against original starting state and current bytes |
| `tool/safety_release_prep/local-cleanup.json` | `415969ba0954c764dab5205fd493f18614a1c560f9f8e054c1658b1b27f53c2c` | PASS: integrator cleanup receipt; reviewer independently verified six listed ports closed |
| `tool/safety_release_prep/combined-source.json` | `8ccf369d6b062610a32c23c30327b14f752a75442c3c35d080a957f36e9ccc91` | PASS: independently recomputed all 648 hashes/digest and exact v4 deltas |
| `tool/safety_release_prep/integrator-review.json` | `16f8d1d6d0adae38ef2839d3944fae714f40ea38fb002b59812cb624b4709f83` | PASS: consistent four-source scope, preserved evidence and separate integrator review of Track A |

The candidate was compared against the recorded live Firestore hash
`8fcae3e7205961bcb2329db4fd7caa44a5814ceee842cb5bae6daff4adeb8a20`
and Storage hash
`62c6e45edff76a231a1fe49aa31c7b1d00a045981698a1d07c3b3c8f13c50702`,
as well as the intended existing source. Baseline provenance is the integrator's
read-only metadata evidence; the reviewer did not independently read live data.

## Findings corrected and rechecked

- **FIX NOW / DIRECTLY REQUIRED:** the existing Admin Remove Review caller
  queries and deletes feedback votes before the review. Its own-user-only
  vote-deletion Rules denied other users' votes. A failing actual-operation
  regression was preserved. The source correction adds only the existing Admin
  role to deletion, retaining actor/voter account-deletion fences and dish and
  restaurant operation locks. Vote creation/update authority is unchanged.
- **FIX NOW / DIRECTLY REQUIRED:** the initial candidate restored broader Admin
  review updates than needed for exact removal. The final candidate retains
  `dish_reviews` update denial regardless of screening runtime, keeping unwanted
  Admin review movement closed. Exact deletion is independently allowed.
- **FIX NOW / DIRECTLY REQUIRED:** the safety overlay needed the actual first-time
  shared-menu entry dependency. It now permits only existing empty metadata
  initialization, atomic exact owner/catalog linkage with revision and lock
  checks, and a subsequent timestamp-only touch. Unrelated menu item/section
  holds remain explicit. This does not rebuild menu identity or authoring.
- **FIX NOW / DIRECTLY REQUIRED:** pending owner name requests require contributor
  Terms. Existing Admin rejection is now permitted only as an exact rejected
  status/server-time update, with deletion fences. Direct approval remains
  held; the existing trusted approval checks the responsible owner.
- **FIX NOW / DIRECTLY REQUIRED:** the new combined fixture initially used a
  different demo project from Storage's cross-service Firestore project, causing
  three expected-public-read 403s. The project alignment corrected the harness;
  exact Storage assertions and production Rules were retained. The original
  failing log is preserved.
- Review requested stronger same-content retry evidence. The final combined test
  retries the same held words, checks original text version/creation time and
  approved words, and checks the owner asset's original 30-day deadline. Approval
  still requires explicit attachment.

- **FIX NOW / DIRECTLY REQUIRED:** three completion transactions caught Firestore
  infrastructure errors as policy denials. Each now handles only `HttpsError`
  as a private hold and rethrows other errors. A deterministic regression injects
  gRPC ABORTED (10) and nonretryable INVALID_ARGUMENT (3) in each actual SDK
  transaction. The inspected final log passes 6/6 against the preserved before
  failure evidence. Provider invocation remains outside completion transactions,
  so the SDK retry reuses the response without spending another attempt. No new
  manual retry loop was introduced. A nonretryable failure leaves words/photos
  private; the text writer truthfully reports the previously saved rating with
  `screening_failed` instead of claiming that the committed rating failed.

The earlier intermittent emulator photo-contention code-3 failure is distinct:
the demonstrated swallowed-error defect does not establish its original cause or
prove that every contention scenario is fixed. The broader affected suite still recorded this failure (205/206); the exact
unchanged case passed 1/1 after one task-emulator restart. The reviewer accepts
its documented local-emulator limitation for source preparation while preserving
concurrent missing-photo publication as required later live acceptance. An initial text regression expected the outer saved-rating
operation to reject; the final assertion respects the pre-existing committed-rating
response and independently verifies that the inner transaction error surfaced.


Release-package review also corrected imprecise implementation-module references,
explicitly listed the four future source bindings without enabling them, and
confirmed three existing owner-detachment projection callbacks are represented.
The callbacks preserve their existing runtime/key identities and do not authorize
old discovery activation. The final package freezes combined source before the
paid investigation, rechecks drift before rollout, and requires demonstrated
usable revision/image/traffic recovery instead of treating Ready metadata as proof.
Exact invoker principals and regions are listed for schedules/triggers, including
the `us-east1` Storage finalizer. Existing Admin, website, deletion, identity,
secret references, indexes and unrelated holds remain preserved.

The reviewer requested and rechecked a final acceptance-contract clarification:
personal blocks omit reviewers from review results while approved public photos
remain shared. Numerical ratings remain independent of text approval. Test-file
inventory is explicitly separated from current execution evidence. No live
provider, runtime or IAM state is inferred from these local contracts.

Photo reports deliberately use `supportingReviewId`, not the legacy top-level
`reviewId`, and reviewer reports keep nested evidence. The actual review-removal
query therefore preserves those independent reports; the regression checks this.

## Execution evidence and limits

The reviewer personally ran the 644 client tests listed in `track-a.md`, with no
client edits. For independently reviewed backend/Rules work, the reviewer read
actual source, diffs and logs rather than independently rerunning the suites.
The inspected evidence includes the failing Admin vote regression, corrected
query/delete workflow and 15/15 candidate Rules checks. For final backend bytes,
the reviewer inspected the successful TypeScript build, 6/6 transaction
regression, 39/39 provider/index contracts, 25/25 existing source Rules checks,
205/206 broader affected suite with the disclosed intermittent emulator failure,
the unchanged failing case's 1/1 pass after restart, and final exact-metadata
combined source 4/4 and candidate 4/4 passes. These counts overlap; they are not
summed as unique tests. The final combined runs replace earlier fixture evidence
for these changed bytes. None of these backend/Rules runs was personally
executed by this reviewer.


The reviewer also personally ran `validate_package.py` after reading it: PASS,
53 exports and 14 qualification groups. It performs file/JSON/hash checks only.
All 24 committed-copy evidence files (335,653 bytes) matched their original local
logs byte-for-byte and matched the index hashes. All 131 preservation records
matched the starting-state file lists/hashes and current contents. All six
listed loopback ports were independently closed. Original process ownership and
termination are supported by the integrator's cleanup receipt; the reviewer did
not independently observe that earlier termination action.

The reviewer independently opened the current official Apple 5.1.2(i), OpenAI
API data-controls endpoint table and Google SafeSearch guide, and checked the
actual text/photo adapter payloads, timeouts and retry limits. The existing full
Terms text names provider/purpose; affirmative UID-bound acceptance is a supported
permission mechanism when exact Terms and required policy are composed together.
This is an interpretation of the cited rule, not store or legal approval. No
extra checkbox was inferred solely from absence of a separate prompt.

No review here proves production GCS generation preconditions, live provider
availability or classifier accuracy, production TTL/deletion timing, physical
phone acceptance, Linux image execution, or the hosted search decision. No
production deployment, provider submission, activation, IAM/secret change or paid
resource use was performed by this reviewer. Safe recovery retains enforcement
and deletion/privacy protections; default-OFF is not a post-activation pause.

## Final preparation verdict

PASS for the exact reviewed source/preparation bytes, with the existing
intermittent emulator contention limitation explicitly retained. This does not
assert a fully passing broader backend suite or production qualification.

The reviewer recomputed all 648 source hashes and candidate digest
`803765331aa21d9594018d42f14011f5fe3d46a309375cc70d5bc018eb9e4d0c`.
Against the immutable 518-path v4 manifest, exactly the three completion modules
changed and 515 paths match. Root `firestore.rules` was not in v4; its separately
recorded starting-HEAD and current hashes were verified. The corrected README
states this distinction. Reviewed source/tests/candidate metadata are included;
protected owner paths and circular report references are excluded and bound by
the containing commit instead. Any later relevant source, binding or candidate
edit requires affected qualification/review and a newly selected freeze.

No material unresolved review finding remains within this preparation scope.
The disclosed local test failure and future provider/storage/TTL/contention,
search, device and release-authorization gates remain as stated above. Root
separately reviews Track A's authored client report and this review record.
