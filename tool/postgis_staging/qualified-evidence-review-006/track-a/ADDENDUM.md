# Track A qualification amendment

The larger real source fixture exposed two directly required correctness repairs after the initial Track A freeze. The initial receipt and all baseline failures remain retained.

The SQL adapter now decodes the existing typed offer projection before native availability evaluation. PostgreSQL JSON DTOs had lost Timestamp methods, so expired or scheduled offers could be selected and then rejected by the native result builder, failing a page. The native eligibility rules and current authority checks did not change.

Guest continuation fingerprints now encode only noninteger restaurant distance fields with the existing lossless binary64 helper. Integer-only fingerprints retain their old bytes, and stored/public cursors retain numeric distances. The general fingerprint serializer still rejects unsupported fractional fields. Serial and windowed searches now pass 110-parent tests with 76 excluded history IDs, exact first/later pages, replay and one-ULP tamper rejection.

Final affected verification is 370/370 Node tests: 304 native handlers, 30 prior batching/independent guest diagnostics, 5 new distance-boundary tests, 10 timestamp/native-SQL tests, 18 existing real SQL tests and 3 large-fixture/query/Finder tests. The large-fixture matrix still covers 55 queries, 110 actual plans and 164 exact Finder score vectors. This rerun verifies correctness; overlapping local recovery work makes its timings unsuitable for new performance conclusions.

See `track-a-qualified-addendum.json` for exact source hashes, failure disposition and final logs. The original Track A report remains the source of bounded F6 feasibility and initial performance observations. No primary repository, Git, cloud or runtime guard change was made.
