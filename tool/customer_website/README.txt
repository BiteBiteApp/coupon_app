BiteStar customer website foundation — local only

Real app entry (Firebase-backed customer services; no deployment):
flutter build web --release --no-pub --dart-define=BITESTAR_CUSTOMER_WEBSITE=true --dart-define=BITESAVER_BOUNDED_CUSTOMER=true --dart-define=BITESCORE_BOUNDED_CUSTOMER=true --output=build/customer_website
python3 tool/customer_website/preview.py
Open http://localhost:8765/

Safe synthetic qualification entry (same customer widgets; no Firebase init):
flutter build web --release --no-pub --target=test/customer_website_fixture/main.dart --dart-define=BITESTAR_CUSTOMER_WEBSITE=true --dart-define=BITESAVER_BOUNDED_CUSTOMER=true --dart-define=BITESCORE_BOUNDED_CUSTOMER=true --output=build/customer_website_fixture
python3 tool/customer_website/preview.py --fixture --port 8766
Open http://localhost:8766/

Routes:
/#/browse/coupons
/#/browse/bitescore
/#/account
/#/r/coupons/{URI-encoded permanent bitescore_restaurants document ID}
/#/r/bitescore/{URI-encoded permanent bitescore_restaurants document ID}
/r/coupons/{ID} and /r/bitescore/{ID}: local QR fallback, Continue in Browser.
/ invite paths retain the existing secure app fallback; the Flutter customer
entry asks that secure invitations be opened in the installed app.

All three selectors are local build inputs only. Existing source defaults are
unchanged; PostGIS stays OFF. The customer website selector defaults OFF, is
web-only, and refuses legacy discovery if bounded selectors are absent.
The preview server binds loopback and omits offline-worker registration in its
bootstrap response. If an earlier preview registered a worker, use a fresh port
once (for example --fixture --port 8767). The build files are not modified. Neither build writes build/web, and the
customer QR script exists only under tool/ and is injected only by this server.
There are no changes to published QR/legal/payment/association files or Firebase
Hosting configuration. Do not deploy either preview folder without a separately
authorized coordinated release.

Browser coupon policy: the shared detail widget blocks all usage/proof calls.
Canonical unlimited policy permits viewing/enlarging only; daily specials have
no redemption action. Restricted and unknown policies require the native app.
Existing genuine app-opening host is app.bitestar.app. Store destinations have
not been configured; the UI says so and offers no fabricated installation URL.

Tests:
flutter test --no-pub --platform chrome --dart-define=BITESTAR_CUSTOMER_WEBSITE=true --dart-define=BITESAVER_BOUNDED_CUSTOMER=true --dart-define=BITESCORE_BOUNDED_CUSTOMER=true test/screens/customer_website_navigation_test.dart test/screens/customer_website_coupon_test.dart test/services/customer_website_browser_test.dart
node --test tool/customer_website/qr-preview.test.js
python3 -m unittest discover -s tool/customer_website -p '*_test.py'

Qualification limits / next work:
- Synthetic data proves client behavior, not released backend customer journeys.
- Google Location 003 adds a source-only customer callable with strict matching,
  default-closed paid-call admission and a server secret. No live activation.
  Browser GPS stays separate. New city-only input requires state; an already
  confirmed city/state center can be reused by city name during the same tab.
- BiteSaver browse DTO has an opaque participant restaurant ID and only a
  catalogBindingAvailable boolean, not the permanent catalog document ID.
  Preserve these identities. Direct permanent QR routes reload correctly;
  anonymous Browse/Saved detail routes do not gain shareable permanent URLs.
- Foundation 002 adds nested public menu, coupon, dish and review-section URLs.
  Browser Back/Forward restores registered Browse/Saved visits with fresh access
  checks. Opaque search-bound visits keep their parent URL and use a session-only
  history key; after refresh these recover to Browse rather than inventing a
  permanent account-to-catalog mapping. Public nested URLs reload independently.
- Account/UGC/Saved reuse existing services; real browser sign-in, provider
  restoration, favorites, uploads/ratings/reports need separate end-to-end
  qualification. No production test accounts, reviews or redemptions were made.
- Canonical bitestar.app has no binding in the inspected Firebase project and
  currently serves another site's HTML. Future authorized domain binding/DNS
  cutover and HTTPS readiness are required; current apex HTTPS already works.
- Native-proof production endpoints are held MANUAL/0; source proof tests and
  direct-write Rules denials do not qualify live proof denial. Retain this
  release gate. Existing search/backend releases must be checked before launch;
  keep source-complete services instead of falling back to broad catalog reads.

See CUSTOMER_WEBSITE_FOUNDATION_001_COMPLETION.txt for the frozen run receipt.

Foundation 002 qualification (separate folders preserve Foundation 001 builds):
flutter build web --release --no-pub --dart-define=BITESTAR_CUSTOMER_WEBSITE=true --dart-define=BITESAVER_BOUNDED_CUSTOMER=true --dart-define=BITESCORE_BOUNDED_CUSTOMER=true --output=build/customer_website_002
flutter build web --release --no-pub --target=test/customer_website_fixture/main.dart --dart-define=BITESTAR_CUSTOMER_WEBSITE=true --dart-define=BITESAVER_BOUNDED_CUSTOMER=true --dart-define=BITESCORE_BOUNDED_CUSTOMER=true --output=build/customer_website_fixture_002
python3 tool/customer_website/preview.py --build-directory build/customer_website_fixture_002 --port 8771

Public nested paths (hash routes):
/r/coupons/{catalog ID}/menu
/r/coupons/{catalog ID}/offer/{public opaque offer ID}
/r/bitescore/{catalog ID}/menu
/r/bitescore/{catalog ID}/dish/{dish ID}
/r/bitescore/{catalog ID}/dish/{dish ID}/reviews
Components are URI encoded exactly once; parent identity is checked on dish reload.
Forward does not reuse a disposed route or its auth binding. Expired authority
returns to the retained safe parent. No session capabilities/UIDs/DTOs are stored
in browser history. Source/default/protection gates from Foundation 001 remain.

Foundation 002 historically stopped at the missing public browser resolver.
Google Location 003 now supplies that source-only integration; deployment and
controlled live qualification remain separate approvals.

Google Location 003 local qualification:
flutter build web --release --no-pub --dart-define=BITESTAR_CUSTOMER_WEBSITE=true --dart-define=BITESAVER_BOUNDED_CUSTOMER=true --dart-define=BITESCORE_BOUNDED_CUSTOMER=true --output=build/customer_website_003
flutter build web --release --no-pub --target=test/customer_website_fixture/main.dart --dart-define=BITESTAR_CUSTOMER_WEBSITE=true --dart-define=BITESAVER_BOUNDED_CUSTOMER=true --dart-define=BITESCORE_BOUNDED_CUSTOMER=true --dart-define=BITESTAR_LOCAL_LOCATION_FIXTURE=true --output=build/customer_website_fixture_003
python3 tool/customer_website/preview.py --build-directory build/customer_website_fixture_003 --port 8773
node tool/customer_website/location_preview.cjs
Open http://localhost:8774/ ; all location transport stays on loopback, real handler
and admission code run against deterministic Google and Firestore test doubles.
The fixture never initializes Firebase or calls Google. Mock call count and actual
outgoing search criteria are visibly labeled. 34461 and Ocala, FL succeed;
Unknownville, FL is ZERO_RESULTS. These coordinates are synthetic test values.

The production callable resolves only schemaVersion/query/clientInstanceId and
returns schemaVersion/latitude/longitude/provider/cacheSeconds. No key reaches
Flutter. BITESTAR_CUSTOMER_LOCATION_DAILY_LIMIT defaults to 0; valid future values
are 1..250 attempted provider calls per UTC day. One private transaction document
caps total/minute, per-actor/minute+day and concurrent leases. Failed attempts and
replays count. Guest IDs are not strong identity; shared allowance is the provider
cost boundary. Function/Firestore traffic and existing Admin geocoding are outside
that allowance, so it is not a project spending cap.

Only explicit typed submission calls the provider. Radius/mode/navigation reuse the
confirmed center; simultaneous identical submissions share a request. Google
coordinates in the resolver are memory-only, expire after 24h and are not written to
preferences. Existing search sessions contain search coordinates under their existing
60-minute absolute expiry and active Firestore TTL; deletion/backup retention remains
a live release check. Existing user-entered location text persists. Reload restores
text with a Search prompt, avoiding automatic paid lookup. GPS uses Geolocator.

Official attribution asset assets/images/google_maps_attribution.png is the
unmodified GoogleMaps_Logo_DarkGray_4x.png from:
https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip
It is displayed at16dp with accessible name Google Maps and clear space.
Policies: https://developers.google.com/maps/documentation/geocoding/policies
Service terms: https://cloud.google.com/maps-platform/terms/maps-service-terms
Usage: https://developers.google.com/maps/documentation/geocoding/usage-and-billing
Security: https://developers.google.com/maps/api-security-best-practices
The implementation chooses a conservative 24h memory lifetime, below the documented
30-day temporary latitude/longitude allowance. No map is introduced. Confirm the
project's applicable agreement/billing region and public policy/Terms requirements
before launch; no legal text was changed.

See CUSTOMER_WEBSITE_GOOGLE_LOCATION_003_COMPLETION.txt for exact tests, metadata,
independent review and controlled-live qualification prerequisites.
