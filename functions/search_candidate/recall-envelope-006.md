# Conservative spatial recall envelope (run006)

The serving selector still uses the unchanged native distance, predicates, tuple
ordering, exact tie breakers, continuation heap and numerical runtime guard. This
change only removes candidates that cannot satisfy any supported radius. It does
not substitute PostGIS sphere/spheroid distance, enlarge the public radius, or
use an approximate distance as a cursor.

The existing proved latitude span remains:

`span = (radiusMiles * 1609.344 + 1) / (0.99 * 111000) + 1e-10`.

Only if the entire resulting latitude interval lies within `[-60,60]`, add a
longitude interval of `center ± (4 + 1e-8)` degrees. Split this interval at the
antimeridian into two closed envelopes when necessary. Otherwise retain the
latitude-only path. Thus high latitudes and polar/dateline combinations do not
rely on an unproved cosine approximation. Each envelope is a planar rectangle
against the derived point's geometry and its partial GiST index; there is no SQL
trigonometry in this new predicate. The geo point and latitude/longitude columns
come from the same validated projection in `insertEntity`.

## Whole-domain exclusion proof

This extends the retained exact-rational audit at
`tool/postgis_staging/qualified-evidence-linux-004/linux-review/proof-input/distance-bound-arithmetic-audit.py`
and its pinned Node 24.21 IEEE754 source. Run the extension with:

`python3 functions/search_candidate/recall-envelope-006-audit.py`

It applies only under the unchanged qualified numerical runtime. The script
records all proof-input hashes. Source, runtime and SQL qualification remain
separate; finite regression samples are not this proof.

1. A candidate outside the wrapped longitude interval has absolute raw longitude
   separation between 4 and 356 degrees (with the script auditing an extra 1e-8
   degree on both endpoints). The half-angle supplied to native sine is therefore
   between approximately 0.0349066 and 3.1066861 radians. The extra envelope 1e-8
   degree covers coordinate serialization, endpoint arithmetic and subtraction/
   multiplication rounding, whose ledger is below 1e-10 degree. It is an endpoint
   rounding allowance, not a distance/ranking epsilon.
2. On the direct sine branch, the retained full polynomial enclosure is
   `sin(x)/x > .8969`. On the `n=±1` argument-reduction branch sine dispatches to
   the audited cosine kernel, bounded below by `.6909`. On `n=±2`, the input is
   at least two degrees away from π: the reduction is the ordinary two-term
   `2*pio2_1 + 2*pio2_1t` case, with no near-π cancellation path. Throughout this
   interval `|r| > |w|`; monotone subtraction and FastTwoSum bound the relative
   residual tail by 2u. The smallest residual magnitude occurs at the endpoint;
   the retained tail sine enclosure then exceeds `.03131`. These branches cover
   the entire excluded interval, including their rounded boundary overlap.
   Consequently native `abs(longitudeSine) > .02` everywhere excluded.
3. The retained latitude interval proof gives each native latitude cosine
   greater than `.45` in `[-60,60]`. The nonnegative latitude term cannot reduce
   the haversine. Four rounded positive operations conservatively give
   `h > .45² * .02² * (1-u)^4 > 1/12500`.
4. The clipped native numerator square root is at least `.0089`; the denominator
   is at most 1. For positive atan2, the audited direct atan branch gives an angle
   greater than `.008`, and every reduced atan branch is larger. Clamping at
   `h>=1` likewise produces a larger angle. After the final rounded multiplies,
   native distance exceeds 102,050 meters. The largest supported radius is
   48,280.32 meters (30 miles). Therefore every excluded point is outside every
   supported public radius.

The retained latitude proof first establishes that any eligible point is inside
the latitude band. When that entire band is within the cosine domain above, the
longitude proof excludes all points outside the two-dimensional rectangle. At
all other centers, no longitude restriction is applied. Closed boxes and the
split at ±180 retain endpoints on either coordinate representation.

## Validation and practical limits

The run006 SQL regression creates 50,000 synthetic parents plus radius/near-tie
fixtures through the real projection builders, and uses real PostgreSQL/PostGIS.
It checks all seven supported radii, five geographic regions including the
antimeridian and high-latitude fallback, sparse Saver offers, short/rare/alias/
fuzzy text, category filtering and all dish sorts. An exhaustive native oracle is
regenerated independently from the synthetic source and runs outside measured
selector timing. Full recall IDs and ordered first/later pages are compared.
Actual `EXPLAIN (ANALYZE, BUFFERS)` plans are retained without forcing indexes.

A fixed eight-degree longitude width is deliberately broad; dense local clusters
can still require substantial exact refinement. The change does not establish
nationwide latency, hosted performance, statistical p95/p99 confidence, or a
portable replacement for the existing numerical strategy. The performance and
plan observations belong to the run's hashed evidence, not to this proof.
