'use strict';
const assert=require('node:assert/strict');
const {createLocalPostgisPool}=require('/app/functions/lib/postgis_store.js');
const pool=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_linux',user:'bsgate0'});
const bits=v=>{const b=Buffer.alloc(8);b.writeDoubleBE(v);return b.toString('hex')};
const step=(v,n)=>{const b=Buffer.alloc(8);b.writeDoubleBE(v);b.writeBigUInt64BE(b.readBigUInt64BE()+BigInt(n));return b.readDoubleBE()};
(async()=>{
 const values=[0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,2**-1022,-(2**-1022),... [4,60,90,180].flatMap(x=>[-1,0,1].flatMap(n=>[step(x,n),-step(x,n)])),50000/111000,1/111000,50000/44400,1/44400];
 const conn=await pool.connect(); const rows=[];
 try {
  await conn.query('BEGIN READ ONLY');
  const session=(await conn.query("SELECT current_setting('extra_float_digits') AS extra_float_digits,version() AS version")).rows[0];assert.equal(session.extra_float_digits,'1');
  for(const input of values){
   const row=(await conn.query("SELECT $1::float8 AS transported,($1::float8)::numeric::text AS decimal, (($1::float8)::numeric)::float8 AS roundtrip, (least(50000::numeric,111000::numeric*abs(($1::float8)::numeric))/1609.344::numeric)::float8 AS capped_miles",[input])).rows[0];
   // JS/pg text serializes negative zero as zero; that identity has no geometric effect.
   assert(input===0?row.transported===0:Object.is(row.transported,input),'transport mismatch');
   assert(Math.abs(row.roundtrip-input)<1e-12,'numeric bridge exceeds retained coordinate allowance');
   assert(Number.isFinite(row.capped_miles));rows.push({inputBits:bits(input),transportBits:bits(row.transported),decimal:row.decimal,roundtripBits:bits(row.roundtrip),absoluteError:Math.abs(row.roundtrip-input),cappedMiles:row.capped_miles});
  }
  const cap=(await conn.query('SELECT (49499::numeric/1609.344::numeric)::float8 AS latitude_cap,(49999::numeric/1609.344::numeric)::float8 AS longitude_cap')).rows[0];
  assert(Math.abs(cap.latitude_cap-49499/1609.344)<1e-10);assert(Math.abs(cap.longitude_cap-49999/1609.344)<1e-10);
  await conn.query('ROLLBACK');console.log(JSON.stringify({kind:'read-only actual-pool numeric bridge corroboration',session,cases:rows.length,maxAbsoluteCoordinateError:Math.max(...rows.map(x=>x.absoluteError)),cap,rows},null,2));
 } finally {conn.release();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
