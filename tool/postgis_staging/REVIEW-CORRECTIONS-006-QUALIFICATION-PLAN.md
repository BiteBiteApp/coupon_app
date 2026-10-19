# Qualification plan after local corrections 006

This is an unexecuted measurement plan, not approval, an execution signature,
a readiness attestation or a proposed production capacity tier. The investigation
still has a non-resetting 72-hour maximum, an approximately $300 planning ceiling
including a $30 reserve, and a separate $100 **forecast** checkpoint. No real T0
starts during source preparation. Current timing, independent-alert and access
policies remain in force; the 005 exceptions remain unapproved.

## Measurement contract

Measure an accepted search center through the first useful native page or visible
cards. Preserve every continuation, admission retry, backoff, rejected candidate,
request failure and incomplete intent in that interval. A failed or incomplete
intent is not a fast success: retain its elapsed time and terminal reason and
count it as exceeding the target. Do not pool only successful requests to report
a passing tail. Record typed-location geocoding separately, then report its
additional user-visible interval when that independently authorized path is tested.

The unchanged targets are warm p95 at most 2 seconds, warm p99 at most 4 seconds,
and cold at most 4 seconds. A single process's first observation is not evidence of
provider cold start. Report process/container/instance restart, SQL connection and
cache state, deployment revision and concurrency explicitly. Never discard the
first observation without retaining and identifying it.

Keep these counters separate: HTTP requests; membership calls; selector SQL and
all SQL including transactions/control; SQL returned rows; requested Firestore
document paths; query-returned documents; logical transactions and attempted
transaction callbacks; source events; projection writes; artifact bytes; provider
operation reservations. These are observed work, **not billed operations**. Compare
actual billing only after an authorized provider run supplies billing evidence.

## Bounded progression

1. Qualify the exact signed candidate/configuration and dataset plan; independently
   verify seed counts, source-fence publication, current authority and ordered
   result parity outside the timed path. A local 50,000-parent SQL fixture does
   not establish construction of 50,000 raw Firestore parents or cloud capacity.
2. Run a small attended pilot within the explicitly approved time, reservation,
   storage and spending ceilings. Check total construction and search work before
   expanding samples. A sample target never overrides a safety stop or cleanup.
3. Select a small number of homogeneous critical cells from the pilot. Obtain at
   least 1,000 complete attempted intents per cell before treating its p95 as
   useful qualification evidence; aim for at least 10,000 per critical cell for
   p99. Preserve raw arrays, errors, censored/incomplete observations, nearest-rank
   empirical values and uncertainty. Do not claim these sizes alone prove an SLO.
4. Obtain 30 separately identified cold observations as exploratory evidence.
   Record actual startup mechanism and include the full wait through useful
   output. This is not a statistical cold-tail guarantee.

Do not run a giant Cartesian product. Use targeted correctness coverage across
all supported radii (1/3/5/10/15/20/30 miles), coordinates, latitude stripes,
dateline/polar fallback, short and rare text, aliases/spelling, categories and
sorts. Select timing cells from demonstrated expensive and common paths, with
each cell's dataset distribution, history state and concurrency fixed and named.

## Critical cells and correctness checks

- Guest Saver: empty history; restricted history; a suppressed prefix longer
  than one private prefetch; the global 75 required-history-ID boundary; later
  pages. Check final current offer/usage authority, exact disclosure, replay and
  cursor/lookahead parity. Do not average these distinct cells together.
- Signed Saver: independent actors, restricted/unlimited offers, no-offer and
  hidden/expired/scheduled parents, current suppression and later pages. Respect
  admission quotas; actor creation is not a way to evade a production limit.
- Score and Finder: sparse/national and dense local distributions, aliases and
  spelling cases, category/sort combinations, later pages, ties and suppression.
  Include Finder's real debounce. Use public catalog IDs separately from Saver.
- Continuing updates: independent edits/deletes/recreation while new admission
  intents finish against finite captured targets and older pins retain membership.
  Report source-to-publication lag, waits and admission completion separately.
- Recovery/retention: interrupted seed and validation, retries, missing/corrupt
  artifacts, resumable pruning, and restore with the original disposable SQL
  database absent. Record rows/bytes/object checks and operation slopes, not just
  wall time. Local filesystem and injected GCS behavior are distinct evidence.

The independent exhaustive native oracle is outside the timed query path. EXPLAIN
ANALYZE/BUFFERS must use actual emitted SQL; do not force indexes or treat every
sequential scan as failure. The retained runtime guard and exact final matcher,
distance, rank and ties remain mandatory. Combined website, real cloud Auth/App
Check/CORS routing, provider cleanup and alert delivery require their own later
evidence; local passes cannot supply it.
