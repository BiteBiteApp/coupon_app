'use strict';
const assert=require('node:assert/strict');
const geo=require('/app/functions/lib/restaurant_geo_helpers.js');
const bits=value=>{const b=Buffer.alloc(8);b.writeDoubleBE(value);return b.toString('hex');};
const tests=[
 ['ties-even-low',()=>1+Number.EPSILON/2,1],
 ['ties-even-high',()=>(1+Number.EPSILON)+Number.EPSILON/2,1+2*Number.EPSILON],
 ['subnormal-preserved',()=>Number.MIN_VALUE*1,Number.MIN_VALUE],
 ['subnormal-halving',()=>2*Number.MIN_VALUE*.5,Number.MIN_VALUE],
 ['subnormal-underflow-even',()=>Number.MIN_VALUE/2,0],
 ['sqrt-signed-zero',()=>Math.sqrt(-0),-0],
 ['sqrt-min-subnormal',()=>Math.sqrt(Number.MIN_VALUE),2**-537],
 ['sqrt-min-normal',()=>Math.sqrt(2**-1022),2**-511],
 ['sqrt-two',()=>Math.sqrt(2),1.4142135623730951],
 ['sqrt-closed-square',()=>Math.sqrt(Number.MIN_VALUE)**2,Number.MIN_VALUE],
 ['cos-pole-positive',()=>Math.cos(90*(Math.PI/180))>0,true],
 ['sin-subnormal',()=>Math.sin(Number.MIN_VALUE),Number.MIN_VALUE],
 ['atan-subnormal',()=>Math.atan(Number.MIN_VALUE),Number.MIN_VALUE],
];
const evidence=tests.map(([name,f,expected])=>{const actual=f();assert(Object.is(actual,expected),name);return {name,actual:typeof actual==='number'?bits(actual):actual,pass:true};});
let sink=0;
for(let i=0;i<100000;i++)sink+=geo.exactCustomerBiteSaverDistanceMeters({latitude:25.77+(i%31)*1e-6,longitude:-80.2},{latitude:25.77,longitude:-80.19+(i%7)*1e-6});
assert(Number.isFinite(sink));
console.log(JSON.stringify({kind:'finite default-arithmetic corroboration plus JIT inspection; not universal proof',checks:evidence.length,passed:evidence.length,sink,node:process.version,execArgv:process.execArgv,evidence}));
