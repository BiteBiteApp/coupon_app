# Provider permission and later qualification

Run: BS-BITESTAR-SAFETY-BACKEND-RELEASE-PREP-001. Checked October 17, 2026.
This is preparation, not legal/store approval or authorization to send content.

## Permission finding

Apple's [5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing) requires disclosure of third-party personal-data sharing, access to its purpose/destination, and explicit permission before sharing, including with third-party AI. It does not specify a separate checkbox. This assessment addresses that clause only.

The published `legal/terms-of-service.txt`, version `bitestar-terms-v1`, effective October 17, 2026, names OpenAI for written-review screening and Google Cloud Vision for photographs. Its exact SHA-256 is `d47ef4416d17ff016a3c967e415a8d0d77f07672a24fdae8112e6d5fabb39155`. The existing Terms dialogs show the full backend-provided text and version, with Accept Terms and Cancel. The UID-bound trusted writer records acceptance time; clients cannot supply a replacement receipt. Decline preserves browsing and does not submit content. A changed mandatory version requires renewed acceptance.

The published Privacy Policy specifies the submitted headline/notes and photographs, including personal information a contributor puts inside them, and the private Admin review purpose. It is reachable through existing legal navigation. The Terms dialog references Privacy but does not itself provide a clickable Privacy link. Test the actual release navigation and readability on both phones; do not represent this inspection as store acceptance.

Source trace: `BiteScoreTermsGate.ensureAccepted`, `BiteScoreTermsService.ensureAccepted/requireAccepted`, Create & Rate and dish-detail Terms dialogs, `customerBiteScoreTerms`, `requireBiteScoreTermsInFirestore`, customer photo `eligible`, and owner photo admission/pre-provider checks. Owner processing checks the responsible owner's receipt, including an Admin-mediated submission. The Admin's receipt does not substitute for another contributor's. The text writer checks the same receipt inside its publication transaction. Acceptance grants no ownership, subscription or Admin authority.

**Finding: ACCEPT AND CLOSE** for a speculative additional permission UI. The explicit acceptance of this specific disclosed processing is a supported permission mechanism when exact approved Terms, required runtime policy and compatible clients are enabled together. This is an interpretation of the cited rule and traced behavior, not a guarantee of legal compliance. Passive Privacy publication alone would not establish permission. No demonstrated need for a new user-facing choice was found; none was introduced and no published document was rewritten. Current production/default OFF status does not constitute an active consent gate. Do not enable provider processing before the coordinated Terms gate.

## Payload and provider facts

The OpenAI adapter sends only `Headline:\n…\n\nReview:\n…` to `/v1/moderations`, with `omni-moderation-latest`; profile, email, payments and images are not attached. Current [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) list this endpoint as not used for training, with no abuse-monitoring or application-state retention, and eligible for Zero Data Retention. The broader API default is not a reason to claim a universal 30-day retention period for this endpoint. Account settings/opt-ins and the actual provider contract still require review at setup; no provider account was inspected here.

The Vision adapter uses server ADC, sends one base64 image with only `SAFE_SEARCH_DETECTION` to `images:annotate`, and uses the returned adult/violence/racy/medical/spoof likelihoods. The [official SafeSearch guide](https://cloud.google.com/vision/docs/detecting-safe-search) documents this request and authentication. It does not itself prove customer permission, classifier accuracy, provider retention, account quotas or a spending cap. Do not infer those properties from a fake response or API example.

## Specific later setup and acceptance checklist

All actions below require the later explicit release/provider authorization. Exact resource bindings, scopes and ordering are in `release-manifest.json` and `release-dependencies.md`.

- Verify OpenAI project/service credential permissions for the moderation endpoint only; create/bind the proposed `OPENAI_REVIEW_MODERATION_API_KEY` reference only to the text writer. Never log its value. Verify the selected model, account data-sharing settings, quota and billing controls. Keep provider wiring OFF until approved and requalify the changed source bytes.
- Verify the selected Google runtime principal can consume Vision in the intended project through ADC, with only the required API/service-usage and private-object permissions. Enable/verify the API, project/quota attribution and actual quota without granting project-wide administration. Verify the exact manifest bindings before applying any proposal.
- Verify the shared 1,000 image-attempt UTC-month admission policy across customer and owner lanes, per-user admissions/retries and concurrency limits. It counts admitted application attempts; it is not a guaranteed total spending cap and does not cover other cloud costs or every possible provider charge.
- Preserve adapters' bounded requests: text has an eight-second HTTPS timeout, a 32,768-byte response bound and process concurrency of two; Vision has a 20-second request timeout and no transport retries. Verify handler timeouts, leases, attempt IDs, original deadlines and actual concurrency as recorded in the source/config manifest. No automatic replay should turn an uncertain provider result into unbounded calls.
- With separately authorized synthetic provider submissions, verify clean, ambiguous/flagged, unavailable, quota, timeout and malformed-response behavior; exact payload minimization; private Admin preview/decision; no model-only ban; clean rating saves and held edits preserving earlier approved words; no photo publication without exact approval and owner attachment.
- Check provider availability and classifier policy using an owner-approved synthetic test set. Deterministic responses here prove workflow behavior only.
- Verify real Storage generation preconditions, tokenless private object access, approved exact-generation reads, rejected/expired asynchronous removal, finalize recovery, account-deletion cleanup, actual TTL lag and scheduler health. Emulators do not qualify GCS generation preconditions or production TTL.
- Pause by retaining required enforcement and cleanup/privacy protections, while stopping provider processing; verify no unchecked publication. Never remove runtime documents, clear `required`, restore a raw writer, or roll back to open upload Rules as an outage response.
