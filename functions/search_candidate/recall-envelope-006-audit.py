"""Exact-rational extension for a broad 2-D recall envelope; no sampled inputs.

Loads the retained, unchanged qualified-runtime interval audit, then checks the
additional longitude branches needed to exclude points outside a wrapped 4-degree
fence. This does not qualify another runtime or change native ordering.
"""
from contextlib import redirect_stdout
from fractions import Fraction as F
from pathlib import Path
import hashlib
import io
import json
import runpy

root = Path(__file__).resolve().parents[2]
retained = root / 'tool/postgis_staging/qualified-evidence-linux-004/linux-review/proof-input/distance-bound-arithmetic-audit.py'
with redirect_stdout(io.StringIO()):
    a = runpy.run_path(str(retained))
roundq, bitsq, rad, u = (a[k] for k in ('roundq', 'bitsq', 'rad', 'u'))
# Decimal/float transport and all subtraction/multiplication errors here are
# below 1e-10 degree; the SQL envelope is expanded by 1e-8 degree. Audit a wider
# excluded interval to avoid relying on a floating-point comparison equality.
slack = F(1, 10**8)
assert F(360) * u * 8 < F(1, 10**10)
xmin = roundq(roundq((F(4) - slack) * rad) / 2)
xmax = roundq(roundq((F(356) + slack) * rad) / 2)
assert xmin > F(349, 10000)
assert xmax < F(311, 100)
# n=0: the retained direct kernel enclosure covers the whole interval.
direct_min = xmin * a['general_sin'].lo
assert direct_min > F(2, 100)
# n=+/-1: sin dispatches to the retained cosine kernel, including its tail.
cosine_min = a['cos_bound'].lo
assert cosine_min > F(2, 100)
# n=+/-2: medium reduction has fn=2 and, throughout this domain, no near-pi
# cancellation branch. The upper endpoint has the smallest |negative residue|.
threshold = bitsq(0x4002D97C00000000)
invpio2 = a['named']('invpio2')
assert roundq(roundq(xmax * invpio2) + F(1, 2)) < 3
assert roundq(roundq(threshold * invpio2) + F(1, 2)) >= 1
# A possible n=1 boundary value is already covered by cosine_min above.
p1, p1t = a['p1'], a['p1t']
r_max = roundq(xmax - 2 * p1)
w = 2 * p1t
assert r_max < -F(349, 10000)
assert abs(r_max) > w
# Sterbenz makes x-2*pio2_1 exact for all x in the n=2 domain. FastTwoSum
# reconstructs the residual tail because |r|>|w| throughout that domain.
assert threshold / 2 <= 2 * p1 <= 2 * threshold
assert xmax / 2 <= 2 * p1 <= 2 * xmax
endpoint_head = roundq(r_max - w)
endpoint_tail = roundq(roundq(r_max - endpoint_head) - w)
assert endpoint_head + endpoint_tail == r_max - w
assert abs(endpoint_tail) <= 2 * u * abs(endpoint_head)
assert abs(roundq(roundq(threshold - 2*p1) - w)) < F(786, 1000)
reduced_min = abs(endpoint_head) * a['tail_sin'].lo
assert reduced_min > F(2, 100)
# The retained latitude proof establishes both cosines >.45 in +/-60 degrees.
assert a['cos60_lower'] > F(45, 100)
# Four rounded positive operations cover cos*cos*sin*sin and adding the
# nonnegative latitude term; using .02 is far below all three sine branches.
haversine_min = F(45, 100)**2 * F(2, 100)**2 * (1-u)**4
assert haversine_min > F(1, 12500)
assert F(89, 10000)**2 < F(1, 12500) * (1-u)**2
# sqrt(1-h) <=1; positive atan2 is direct atan or a larger reduced branch.
# Native clamps when h>=1 only increase the angle relative to this lower bound.
atan_min = F(89, 10000) * a['atan_direct'].lo * (1-u)**2
assert atan_min > F(8, 1000)
assert all(b.lo > F(8, 1000) for b in a['atan_reduced'])
meters_min = 2 * F(6378137) * F(8, 1000) * (1-u)**2
assert meters_min > 102000
assert meters_min > 30 * F(1609344, 1000)
result = {
    'kind': 'whole-interval exact-rational branch audit; not sampling',
    'retained_audit_sha256': hashlib.sha256(retained.read_bytes()).hexdigest(),
    'native_ieee754_source_sha256': hashlib.sha256(a['SRC'].read_bytes()).hexdigest(),
    'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'longitude_fence_degrees': 4, 'envelope_rounding_slack_degrees': '1e-8',
    'latitude_domain_degrees': [-60, 60],
    'excluded_sine_absolute_lower': '.02',
    'direct_sine_lower': a['dec'](direct_min),
    'cosine_branch_lower': a['dec'](cosine_min),
    'reduced_sine_lower': a['dec'](reduced_min),
    'excluded_native_distance_lower_meters': a['dec'](meters_min),
    'maximum_supported_radius_meters': '48280.32',
    'runtime_guard_unchanged': True, 'assertions': 'all passed',
}
print(json.dumps(result, indent=2))
