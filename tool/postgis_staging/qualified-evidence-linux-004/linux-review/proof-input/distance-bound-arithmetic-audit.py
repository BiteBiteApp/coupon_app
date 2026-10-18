"""Exact-rational interval audit for the latitude-bound proof. No DB or random inputs.

This verifies polynomial branch inequalities, not universal equivalence of runtimes.
Each interval primitive permits rounding or no rounding, covering multiply/add
contraction. Bounds are over entire intervals, not sampled coordinate points.
"""
from fractions import Fraction as F
from decimal import Decimal, localcontext, ROUND_FLOOR, ROUND_CEILING
from pathlib import Path
import hashlib, json, re
ROOT=Path(__file__).resolve().parent
SRC=ROOT/'evidence/math/node-v24.21.0-ieee754.cc'
text=SRC.read_text()
u=F(1,2**53)
# Covers even a subnormal local error divided by the smallest non-tiny
# direct-kernel argument: 2^-1075 / 2^-27 = 2^-1048 < 2^-1000.
eta=F(1,2**1000)

def bitsq(bits):
    sign=-1 if bits>>63 else 1
    exponent=(bits>>52)&2047; mantissa=bits&((1<<52)-1)
    assert exponent!=2047
    if exponent: mantissa+=1<<52; exponent-=1023+52
    else: exponent=-1074
    return sign*F(mantissa)*(F(2)**exponent)

def named(name):
    m=re.search(r'\b'+re.escape(name)+r'\s*=.*?/\*\s*0x([0-9A-Fa-f]{8}),\s*0x([0-9A-Fa-f]{8})',text)
    assert m, name
    return bitsq(int(m[1]+m[2],16))

def array(name,section):
    s=section.split('static const double '+name+'[] = {',1)[1].split('};',1)[0]
    return [bitsq(int(a+b,16)) for a,b in re.findall(r'0x([0-9A-Fa-f]{8}),\s*0x([0-9A-Fa-f]{8})',s)]

class I:
    count=0
    def __init__(self,lo,hi=None): self.lo=F(lo);self.hi=F(lo if hi is None else hi);assert self.lo<=self.hi
    def rawadd(self,b): b=iv(b);return I(self.lo+b.lo,self.hi+b.hi)
    def rawneg(self):return I(-self.hi,-self.lo)
    def rawmul(self,b):b=iv(b);v=[x*y for x in (self.lo,self.hi) for y in (b.lo,b.hi)];return I(min(v),max(v))
    def rounded(self):
        I.count+=1;e=u*max(abs(self.lo),abs(self.hi))+eta
        return I(self.lo-e,self.hi+e)
    def __add__(self,b):return self.rawadd(b).rounded()
    def __sub__(self,b):return self.rawadd(iv(b).rawneg()).rounded()
    def __mul__(self,b):return self.rawmul(b).rounded()
    def __truediv__(self,b):
        b=iv(b);assert b.lo>0 or b.hi<0
        return self.rawmul(I(1/b.hi,1/b.lo)).rounded()

def iv(x):return x if isinstance(x,I) else I(x)
def dec(q,lower=True):
    with localcontext() as c:
        c.prec=45;c.rounding=ROUND_FLOOR if lower else ROUND_CEILING
        return str(Decimal(q.numerator)/Decimal(q.denominator))
def out(a):return {'lower':dec(a.lo),'upper':dec(a.hi,False)}

S=[named('S'+str(i)) for i in range(1,7)]
C=[named('C'+str(i)) for i in range(1,7)]
atan=text.split('double atan(double x)',1)[1]
A=array('aT',atan);HI=array('atanhi',atan);LO=array('atanlo',atan)
assert len(A)==11 and len(HI)==len(LO)==4

# z bounds include the possible rounded square. The exact square is below Z.
def sin_ratio(Z,tail=False):
    I.count=0;z=I(0,Z).rounded();v_over_x=z.rounded()
    r=I(S[5])
    for c in reversed(S[1:5]):r=I(c)+z*r
    if not tail:result=I(1)+v_over_x*(I(S[0])+z*r)
    else:
        Y=I(-2*u,2*u)
        result=I(1)-(z*(I(F(1,2))*Y-v_over_x*r)-Y-v_over_x*I(S[0]))
    return result,r,I.count

general_sin,sr,nsg=sin_ratio(F(618,1000))
small_sin,_,nss=sin_ratio(F(16,10000))
tail_sin,_,nst=sin_ratio(F(618,1000),True)
assert general_sin.lo>F(89,100)
assert small_sin.lo>F(9997,10000)
assert tail_sin.lo>0
assert max(abs(sr.lo),abs(sr.hi))<F(846,100000)

# Kernel cosine: r is fully interval-evaluated, including every source
# primitive rounding. Reconstruction qx cancels algebraically; its separate
# operation ledger is <3u (see appendix), no global 64 multiplier is assumed.
I.count=0;z=I(0,F(618,1000)).rounded();cr=I(C[-1])
for c in reversed(C[:-1]):cr=I(c)+z*cr
cr=z*cr
xy=I(-F(786,1000)*F(1,2**50),F(786,1000)*F(1,2**50))
real_cos=I(1).rawadd(z.rawmul(F(-1,2))).rawadd(z.rawmul(cr)).rawadd(xy.rawneg())
cos_bound=real_cos.rawadd(I(-3*u,3*u))
assert max(abs(cr.lo),abs(cr.hi))<F(27,1000)
assert cos_bound.lo>F(67,100)
cos_sites=I.count
# Do not assume that an implemented sine has magnitude <=1. These complete
# intervals prove the weaker bound sufficient to handle the source clamp.
assert F(786,1000)*general_sin.hi<F(102,100)
assert max(abs(cos_bound.lo),abs(cos_bound.hi))<F(102,100)
assert F(4,100)*small_sin.hi<1

# Atan source separates odd/even coefficient paths using w=z*z.
def atan_p(Z):
    I.count=0;z=I(0,Z).rounded();w=z*z
    s1=I(A[10])
    for j in (8,6,4,2,0):s1=I(A[j])+w*s1
    s1=z*s1
    s2=I(A[9])
    for j in (7,5,3,1):s2=I(A[j])+w*s2
    s2=w*s2
    p=s1+s2
    ratio=I(1)-p.rounded() # normalized r*P followed by final subtraction
    return p,ratio,I.count

P,atan_direct,np=atan_p(F(192,1000))
Psmall,atan_small,nps=atan_p(F(1,100))
assert max(abs(P.lo),abs(P.hi))<F(9,100)
assert atan_direct.lo>F(91,100)
assert atan_small.lo>F(996,1000)

# All reduced-argument intervals use actual dyadic branch endpoints.
R0=I(F(7,16),F(11,16)); R1=I(F(11,16),F(19,16)); R2=I(F(19,16),F(39,16))
T=[(I(2)*R0-I(1))/(I(2)+R0), (R1-I(1))/(R1+I(1)),
   (R2-I(F(3,2)))/(I(1)+I(F(3,2))*R2), I(-F(16,39),0).rounded()]
# Interval division is deliberately dependency-insensitive, so these T
# enclosures are wider than the exact endpoint range, but still sufficient.
atan_reduced=[]
for i,t in enumerate(T):
    assert max(abs(t.lo),abs(t.hi))<F(4375,10000)
    # Reconstruction real identity HI+LO+t*(1-P), followed by <=8u error.
    b=I(HI[i]+LO[i]).rawadd(t.rawmul(I(1).rawadd(P.rawneg()))).rawadd(I(-8*u,8*u))
    atan_reduced.append(b)
    assert b.lo>(F(4,10)*F(11,16) if i==0 else F(4,10))

# Exact IEEE rounding of a rational, used for endpoint values. No hardware
# trig operation or random coordinate sample participates in this check.
def roundq(q):
    if not q:return F(0)
    sign=-1 if q<0 else 1;q=abs(q)
    exponent=q.numerator.bit_length()-q.denominator.bit_length()
    if q<F(2)**exponent:exponent-=1
    quantum=F(2)**max(exponent-52,-1074)
    r=q/quantum;k,rem=divmod(r.numerator,r.denominator)
    if 2*rem>r.denominator or (2*rem==r.denominator and k%2):k+=1
    return sign*k*quantum

pi=bitsq(0x400921fb54442d18);rad=roundq(pi/F(180));xmax=roundq(F(90)*rad)
p1=named('pio2_1');p1t=named('pio2_1t');p2=named('pio2_2');p2t=named('pio2_2t')
near_min=bitsq(0x3ff921fb00000000)
nonnear_max=bitsq(0x3ff921faffffffff)
n1_min=bitsq(0x3fe921fc00000000)
assert p1/2 <= n1_min <= xmax <= 2*p1 # Sterbenz head subtraction
reduction={}
for name,x,corrs in [('near_endpoint',xmax,(p2,p2t)),('nonnear_endpoint',nonnear_max,(F(0),p1t))]:
    z=roundq(x-p1)
    if corrs[0]:z=roundq(z-corrs[0])
    c=corrs[1];y0=roundq(z-c);y1=roundq(roundq(z-y0)-c)
    assert z<0 and y0<0
    assert abs(z)>=abs(c)
    assert y0+y1==z-c # exact FastTwoSum identity at limiting endpoint
    assert abs(y1)<=2*u*abs(y0)
    reduction[name]={'source_x':dec(x),'z':dec(z),'tail_constant':dec(c),
                     'leading':dec(y0),'tail':dec(y1),'tail_over_leading_abs':dec(abs(y1/y0),False)}
assert xmax==pi/2
assert near_min<xmax
assert reduction

# To establish universal sign, monotonicity of rounded subtraction makes
# these endpoint z values upper bounds throughout each source branch.
# For each branch |z|>=|z_endpoint|>tail_constant, so FastTwoSum applies
# everywhere, not only at the displayed limiting endpoint.
assert abs(roundq(roundq(xmax-p1)-p2))>p2t
assert abs(roundq(nonnear_max-p1))>p1t

# Optional longitude lower bound: SQL's guards are |latitude|<=60 and
# |raw longitude difference|<=4. Allow 1e-8 degree beyond each guard here,
# far exceeding the decimal-conversion/guard error (<=2e-12 degree).
# This is a full interval endpoint/monotonicity argument, not sampling.
latitude_guard_slack=F(1,10**8)
x60max=roundq((F(60)+latitude_guard_slack)*rad)
z60=roundq(x60max-p1); y60=roundq(z60-p1t)
assert n1_min<x60max<nonnear_max
assert z60<0 and abs(z60)>p1t
assert y60<-F(5235,10000)
# For the reduced cos branch, |y0|>=|y60| and its tail sine ratio is
# the already-audited positive tail_sin interval. Direct cos is larger.
cos60_lower=min(cos_bound.lo,F(5235,10000)*tail_sin.lo)
assert cos60_lower>F(45,100)
longitude_half_max=roundq(roundq(F(4)+latitude_guard_slack)*rad)/2
assert longitude_half_max<F(4,100)
# Three longitude-product rounds and a sqrt are safely covered by .9999;
# another .9999 covers the atan2 ratio, .996 covers its small atan branch.
assert (1-u)**3>F(9999,10000)**2/(1-u)**2
longitude_factor=F(45,100)*F(9997,10000)*F(9999,10000)**2*F(996,1000)
assert longitude_factor>F(4479,10000)

R=F(6378137);factors=F(996,1000)*F(9999,10000)**2*F(9997,10000)
assert F(500000)/(2*R)<F(4,100)
assert factors>F(9955,10000)
assert F(8,100)*R>F(510000)
large_factors=F(4,10)*F(9999,10000)*F(98,100)*F(4,10)
assert F(98,100)*F(102,100)<1 # clipped sqrt value 1 >= .98*s
assert F(9999,10000)*F(98,100)*F(4,10)*(pi/2)<1 # min(r,1) lower bound
assert large_factors*F(500000)>F(78000)
assert F(99,100)*F(50000)-1>F(30)*F(1609344,1000)
assert longitude_factor*R*pi/F(180)>F(4,10)*F(111000)
assert F(50000)-1>F(30)*F(1609344,1000)

result={
 'kind':'exact-rational interval/branch audit; no sampling or DB',
 'source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),
 'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'u':'2^-53','normalized_underflow_allowance':'2^-1000',
 'general_sin_ratio':out(general_sin),'small_sin_ratio':out(small_sin),
 'tail_sin_ratio':out(tail_sin),'sin_r':out(sr),'cos_r':out(cr),
 'cos_output_lower_enclosure':out(cos_bound),'atan_correction':out(P),
 'atan_direct_ratio':out(atan_direct),'atan_small_ratio':out(atan_small),
 'atan_reduced_outputs':[out(b) for b in atan_reduced],
 'atan_reduced_argument_intervals':[out(t) for t in T],
 'endpoint_sign':reduction,
 'rounding_intervals_evaluated':{'sin_direct':nsg,'sin_small':nss,'sin_tail':nst,'cos_polynomial':cos_sites,'atan_direct':np,'atan_small':nps},
 'small_case_distance_ratio_lower':dec(factors),
 'latitude_sine_absolute_upper':'1.02',
 'large_case_clamp_sqrt_ratio_lower':'0.98',
 'large_case_distance_ratio_lower':dec(large_factors),
 'large_case_minimum_meters':dec(large_factors*F(500000)),
 'longitude_bound':{
  'guard_latitude_degrees':'60','guard_raw_longitude_difference_degrees':'4',
  'audited_guard_slack_degrees':'1e-8',
  'guard_max_latitude_radians':dec(x60max,False),
  'guard_least_negative_reduced_latitude':dec(y60,False),
  'latitude_cosine_lower':dec(cos60_lower),
  'longitude_half_argument_upper':dec(longitude_half_max,False),
  'small_atan_distance_arc_ratio_lower':dec(longitude_factor),
  'meters_per_raw_degree_lower_before_conversion_error':dec(longitude_factor*R*pi/F(180)),
  'proposed_meters_per_raw_degree':'44400','saturated_bound_meters':'49999'},
 'latitude_bound_saturation_meters':'49499','supported_radius_max_meters':'48280.32',
 'assertions':'all passed'}
print(json.dumps(result,indent=2))
