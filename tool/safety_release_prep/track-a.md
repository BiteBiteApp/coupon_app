# Track A — client, Terms, age and publication workflows

Run: `BS-BITESTAR-SAFETY-BACKEND-RELEASE-PREP-001`.
Prepared from actual starting `main` at `14b341f61eb3e914a5c450cfb4f92de44e665002`.
Role: focused source tracing and local client qualification. No client source or
existing tests needed correction; no production or provider operation performed.

Permitted area was client presentation/state and existing contribution contracts,
with narrow tests if a demonstrated defect required them. Only this report was
added by Track A. Root owns the protected-file/hash inventory and final release
composition. Existing Terms, age, SafeSearch and reviewer safety qualification
reports were reused; newer published legal and closed Admin-movement records
take precedence over historical handoffs.

## Result and actual paths

| System | Actual existing path / current result | Release dependency or remaining evidence |
| --- | --- | --- |
| Shared Terms | `BiteScoreTermsGate`, Create & Rate and dish-editor dialogs render the server's exact text/version, require affirmative **Accept Terms**, and retain drafts on Cancel. `BiteScoreTermsService` checks UID, response schema and returned version. `customerBiteScoreTerms` records the authenticated UID and trusted acceptance time. Current receipt reuse, mandatory version change, wrong UID and account-switch cancellation are covered. | `BiteScoreTermsService.enabled` remains `false`; `approvedBiteScoreTerms` remains `null`. The enabled candidate must provide the published text/version and matching required runtime metadata together. |
| Registration age | Customer/owner email and Google registration use `AccountProviderService`; phone uses shared preflight/sheet; direct invite and deletion-Google account-capable routes use `RegistrationAgePolicy`. Blank input, 12/13 boundary, clearing, cancellation and account/route switching work. Existing registered sessions, email sign-in, recovery and deletion remain supported. | `RegistrationAgePolicy.enabled` remains `false`. This is local self-report, with no persisted age/DOB/eligibility record and no independent age verification. Real supported provider and device continuation remains later evidence. |
| Review/rating publication | Actual Create & Rate modes and dish editor gate before public mutation. `saveCustomerBiteScoreReview` checks the contributor's Terms before preparing/screening text. Held/rejected/failed words are reported separately from saved ratings; earlier approved words survive held edits in the backend contract. | Existing bounded write/read contracts must be ready. Text flag alone does not enable its UI: `ReviewTextModerationService.isEnabled` also requires `CustomerBiteScoreRuntime.isEnabled`. |
| Customer photographs | Existing review, gallery and missing-photo callers use `PhotoScreeningService.submit` when enabled. Its final Terms check precedes serialized photo bytes. Trusted `submitScreenedPhotoHandler` checks the actual contributor before allowance reservation and immediately before the provider. Non-approved outcomes never return a public image success. | `BITESCORE_PHOTO_SCREENING` defaults false and requires bounded runtime; compatible Storage, handlers, review queue and cleanup must ship together. Exact generation/token/GCS properties require later live checks. |
| Owner photographs | `BiteSaverImageUploadService`, media editor, coupon editor and menu handling route through existing `OwnerPhotoScreeningService`. Held receipt survives status reads without another provider attempt; approval yields availability; explicit `use`/save attaches. Account switches cannot install/attach the stale result. | `BITESAVER_PHOTO_SCREENING` defaults false and is independent of customer discovery. Server checks source owner receipt before admission/provider and attachment. Coordinated candidate Storage affects both upload lanes. |
| Reporting and personal blocking | Existing Report Review/Photo preserve exact content identity. Admin photo report UI handles a missing related review and truthful removed/changed state. Blocking invalidates retained dish pages; Unblock from the private list refreshes a retained dish. Empty filtered pages retain continuation, and removing a page does not lose later private records. Private responses are discarded after account switch. | `REVIEWER_SAFETY_CUSTOMER_UI` and `BITESCORE_PHOTO_REPORTING` both default false and also require bounded runtime. Shared food photographs remain visible after personal blocking; no Report Reviewer control or Stage 2D feature was added. |
| Published legal | Existing app, text and static HTML copies agree; customer/owner legal navigation works under Android/iOS presentation and large text. | Published pages remain untouched. Earlier unpublished-legal handoffs are historical, not current release status. |

The customer runtime already enables through its bounded flag **or** the separate
search candidate selector. These safety features depend on established bounded
reader/writer contracts; this does not establish that old discovery must be
activated, choose PostGIS, or resolve the hosted search investigation.

## Provider disclosure and acceptance evidence

The exact published candidate payload is `legal/terms-of-service.txt` including its
trailing newline: SHA-256
`d47ef4416d17ff016a3c967e415a8d0d77f07672a24fdae8112e6d5fabb39155`.
`legal/review-manifest.json` identifies `bitestar-terms-v1`, effective
`2026-10-17`, publication verified. Its SHA-256 is
`04276326cf83fd84b1e55cef46552488a4840de160541bbc45ba22ca41cc51b1`.

Published Terms explicitly name OpenAI for written-review screening and Google
Cloud Vision for photograph screening, identify private Admin review and refer
to the Privacy Policy. The published Privacy Policy specifies headline/notes to
OpenAI, photographs to Google Cloud Vision, and which account/payment/profile
fields are not appended to the text request. The normal app menu exposes the
Privacy Policy. The acceptance dialog itself uses plain selectable Terms text;
its Privacy reference is not a separate clickable link.

This is an affirmative acceptance mechanism, not passive reliance on publication:
the complete named-provider Terms are presented before acceptance, Cancel stops
the contribution, and the trusted writer checks the responsible contributor's
receipt. Customer photo checks include the pre-provider boundary. Written-review
screening follows the checked save transaction; retries repeat that save. Delayed
text approval checks the proposal's contributor. Owner screening and later
attachment check the source owner, including when an authorized Admin uploads
on the owner's behalf; an Admin receipt cannot substitute for the owner. An
Admin-owned source still requires that same Admin's owner receipt at the server
even though the client owner gate exempts Admin authoring prompts.

Under the exact coordinated candidate, the existing flow provides evidence for
specific disclosure plus affirmative permission. No separate permission control
was shown necessary solely because there is no extra just-in-time checkbox.
Root's current official-guidance assessment and final candidate test evidence
remain authoritative. This is not App Store acceptance, a live provider test,
classifier-accuracy evidence, or a claim that today's dormant defaults obtain
screening consent. No legal text or policy choice was silently changed.

## Local verification performed in this run

Environment: Flutter `3.44.1`, Dart `3.12.1`, local widget/service tests using
synthetic identities and deterministic fake SDK/callable responses. No Flutter
test below called OpenAI/Vision, a real Auth account, payment provider or geocoder.
Backend emulator integration is recorded separately by Track B/root.

1. **493 passed, 0 failed**, 17 focused files, `flutter test --no-pub --reporter expanded`:
   `test/services/bitescore_terms_service_test.dart`,
   `test/widgets/bitescore_terms_gate_test.dart`,
   `test/screens/bitescore_create_rate_terms_test.dart`,
   `test/screens/bitescore_category_terms_test.dart`,
   `test/services/reviewer_safety_service_test.dart`,
   `test/screens/reviewer_safety_ui_test.dart`,
   `test/services/account_provider_service_test.dart`,
   `test/screens/registration_age_test.dart`,
   `test/account_deletion_screen_test.dart`,
   `test/services/photo_screening_service_test.dart`,
   `test/services/owner_photo_screening_service_test.dart`,
   `test/services/review_text_moderation_service_test.dart`,
   `test/screens/photo_screening_admin_screen_test.dart`,
   `test/screens/review_text_admin_screen_test.dart`,
   `test/screens/bitesaver_media_editor_test.dart`,
   `test/screens/restaurant_create_coupon_lifecycle_test.dart`,
   `test/screens/restaurant_menu_bounded_test.dart`.
2. **84 passed, 0 failed**, 8 reporting/recovery files:
   `test/services/photo_report_service_test.dart`,
   `test/screens/photo_reporting_ui_test.dart`,
   `test/widgets/photo_report_admin_test.dart`,
   `test/widgets/reviewer_report_admin_test.dart`,
   `test/screens/bitescore_review_report_test.dart`,
   `test/services/password_recovery_test.dart`,
   `test/screens/password_recovery_test.dart`,
   `test/services/review_save_outcome_test.dart`.
3. **67 passed, 0 failed**, 3 legal artifact/navigation files:
   `test/legal/legal_artifacts_test.dart`,
   `test/screens/legal_information_screens_test.dart`,
   `test/screens/legal_information_navigation_test.dart`.

These three sets are disjoint: **644 client tests passed**. No whole-repository
pass is claimed. No stale search/runtime fixture repair was necessary.

Raw local logs are under
`/Users/colesmart/.codex/reports/BS-BITESTAR-SAFETY-BACKEND-RELEASE-PREP-001/track-a/`:

| Log | SHA-256 |
| --- | --- |
| `flutter-focused.log` | `093660ead555a2e39f30d9de527a2fb192a50d6e83f6b9ac15016c699d20aace` |
| `flutter-protective-recovery.log` | `752b386d68dd0f35505d2723459f726021b8a51e7c0694e12931f4f05810dd60` |
| `flutter-legal.log` | `5f77459465b4341191d8473d88f1e6fa50defc3d4df9ada4d12cec3fd1eab9df` |

## Bug filter, sanity and limits

**ACCEPT AND CLOSE:** no demonstrated client integration defect required a source
repair in this track. Existing hooks and service boundaries were reused instead
of rebuilding tested features. Closed Stage 2D and unwanted Admin review movement
remain closed. General runtime/search test problems were not relabeled as safety
defects.

The four sanity questions are satisfied for this local work: the same customer
and owner callers need to cooperate; available deterministic tests can execute
now; reusing and rerunning relevant evidence is necessary for the combined
candidate; defaults and production remain unchanged, and no service recovery is
needed for these completed Flutter test processes.

Remaining client evidence is the actually selected release build and runtime
composition, real Android/iPhone/web provider and route continuation, live
provider/storage behavior and final store acceptance. These are separate from
source correctness. No age identity platform, new consent system, discovery
redesign, website work, production activation or new product decision was added.
