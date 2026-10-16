'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseSafeSearch,classifySafeSearch,GoogleSafeSearchProvider}=require('../lib/photo_screening_provider');
const clean={adult:'VERY_UNLIKELY',violence:'UNLIKELY',racy:'VERY_UNLIKELY',medical:'VERY_LIKELY',spoof:'VERY_LIKELY'};
test('ordinary photograph approved; medical and spoof never independently prohibit content',()=>{
 assert.equal(classifySafeSearch(clean),'approved');
 assert.deepEqual(parseSafeSearch(clean),clean);
});
for(const category of ['adult','violence','racy'])for(const likelihood of ['UNKNOWN','POSSIBLE','LIKELY','VERY_LIKELY'])test(`${category} ${likelihood} held, never automatically rejected`,()=>{
 assert.equal(classifySafeSearch({...clean,[category]:likelihood}),'needs_review');
});
test('missing, malformed and numeric provider values fail closed',()=>{
 for(const value of [null,[],{}, {...clean,adult:4}, {...clean,violence:'safe'}, {...clean,spoof:undefined}])assert.throws(()=>classifySafeSearch(value));
});
test('real provider hard-denies local/test environment before ADC or network use',async()=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';
 try{await assert.rejects(new GoogleSafeSearchProvider().screen(Buffer.from('synthetic')),/disabled in local tests/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
