# Current-candidate query and consumer qualification

Use `functions/test/fixtures/postgis_gate0.cjs` to build actual source projections.
The utility is deterministic, synthetic and does no database I/O. `documents` are
projection rows; `sources` are raw base fixtures with deliberate private canaries
and must not be copied into SQL. Named cases are additional projections. Persist its
exact dimension/count/fingerprint manifest with every run. The default fixture has
211 projections: 39 Saver restaurants, 63 offers, 39 Score restaurants and 70 dishes.

| Area | Required exact assertion |
|---|---|
| Namespace/identity | Same raw source ID in Saver and Score remains two identities. Dishes and coupons keep their own parent; neither ID proves ownership. |
| Saver membership | No-offer parents do not appear as usable coupon results. Hidden parent/offer and expired/rescheduled coupons are suppressed by current authority. |
| Changed offers | Sole coupon edited in place keeps its offer ID and current title; valid signed preview is not permanently consumed. Newly current offer behavior preserves direct-parent vs offer-only membership fence. |
| Specials | Daily Special schedule/day/time-zone behavior agrees with actual offer authority. Discoverability is not coupon redemption permission. |
| Score match | `submarine` matches Hoagie through existing aliases; `hambuger` follows the existing spelling matcher. Category/cuisine/radius and all sort choices use existing predicates. |
| Exact distance | Reuse the original two near-tie coordinates: both JS distances are `0.9999999999997047` miles from the fixture center while SQL trig previously differed. Correct name/ID tie order must win. |
| Geographic bounds | Radius edge, offset center, >64 distinct coordinates, repeated coordinates, signed zero, polar/dateline/guard edges and farther rows cannot be omitted or reordered. |
| Paging | More than 25 results, full ordered exhaustion, deterministic duplicate-free later pages, native actor/realm/revision-bound cursors and expiry. Finder keeps its eight-suggestion result contract. |
| Incomplete work | Budget exhaustion emits only proved prefix or truthful preparing state and usable continuation. A timeout is an error/retry state, never an empty success. |
| Authority | Guest begin/continue packets <=75 IDs, duplicate/replay/account-switch/session binding, accepted-answer recovery after lost reply and fresh expired-answer rejection. Current histories remain outside SQL. |
| Recovery | Ingestion interruption, duplicate/poison/gap, delete/recreate, atomic publication, failed bootstrap/resume, SQL restart, active cursor revision pin, expiry/GC and stale request cancellation. |
| DTO/navigation | Actual Flutter service/consumer accepts actual server shapes, current private/public identity and Menu/profile/detail routes, Saved and favorites. Ordinary selector OFF preserves legacy paths. |
| Resource failure | Pool acquisition/query timeout, error cleanup and restart release connections. No SQL exception leaks raw query/data/credentials to customer results. |

The historical prototype already tested many mathematical and policy cases, but its
SQLite outbox and authority providers were simulations. Rerun the affected cases
against the real current adapters. A spy/fake Firestore test cannot establish
emulator transaction behavior; a mock query result cannot establish PostgreSQL
query correctness. Record these classifications separately.

Use fresh isolated datasets, never the retained original `pgdata`. Coordinate test
transactions/schema resets with the integrating agent; do not run destructive test
fixtures concurrently against its active dataset. No network or cloud execution is
required by this plan. Local pass does not prove Linux/Cloud SQL arithmetic,
distributed provider failover, hosted cost, nationwide throughput or physical-device
latency. Those remain later approved evidence.
