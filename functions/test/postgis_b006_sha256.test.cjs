'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),path=require('node:path');
const {PostgisResumableSha256:H}=require(path.resolve(process.env.BS_TRACK_LIB||path.join(__dirname,'../lib'),'postgis_source_sha256.js'));
const digest=b=>createHash('sha256').update(b).digest('hex');
test('serialized SHA256 matches native crypto including NIST and every block boundary',()=>{
 const vectors=[Buffer.alloc(0),Buffer.from('abc'),Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),Buffer.alloc(1000000,97)];
 for(let size=0;size<=257;size++)vectors.push(Buffer.from(Array.from({length:size},(_,i)=>(i*137+size)%256)));
 for(const bytes of vectors){for(const chunk of [1,7,55,56,63,64,65,127,4096]){
 let h=new H();for(let i=0;i<bytes.length;i+=chunk){h.update(bytes.subarray(i,i+chunk));h=new H(JSON.parse(JSON.stringify(h.state())));}
 assert.equal(h.digest(),digest(bytes),`${bytes.length}/${chunk}`);assert.equal(h.digest(),digest(bytes));}}
});
test('malformed serialized hash state fails closed and shaped corruption cannot match digest',()=>{
 const base=new H().update('abc').state();for(const bad of [{...base,version:2},{...base,words:[1]}, {...base,bytes:-1},
 {...base,bytes:2**41},{...base,tail:'!'}, {...base,tail:'YQ=='},{...base,words:base.words.map(()=>-1)}, {...base,words:base.words.map(()=>1)}])assert.throws(()=>new H(bad),/checkpoint/);
 const b=Buffer.alloc(65,37),s=new H().update(b).state();const mutated={...s,words:s.words.map((x,i)=>i?x:(x^1)>>>0)};
 assert.notEqual(new H(mutated).digest(),digest(b));
});
