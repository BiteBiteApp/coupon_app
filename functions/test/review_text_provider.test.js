'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {OpenAIReviewTextProvider, parseReviewTextSignal, reviewTextCategories, reviewTextModel, reviewTextPolicy} = require('../lib/review_text_provider');
const fixture = (category = null) => ({id:'modr-synthetic', model:reviewTextModel, results:[{
 flagged:!!category, categories:Object.fromEntries(reviewTextCategories.map(k=>[k,k===category])),
 category_scores:Object.fromEntries(reviewTextCategories.map(k=>[k,k===category ? .8 : .001])),
 category_applied_input_types:Object.fromEntries(reviewTextCategories.map(k=>[k,['text']]))}]});
for (const text of ['Wonderful burger.', 'The food was awful. Terrible service.', 'Damn good burger.', 'Yeah, cold fries. Living the dream.', 'Call me at 555-0100.']) test(`deterministic clean outcome: ${text}`,async()=>{
 let sent;const provider=new OpenAIReviewTextProvider(()=> 'synthetic-test-key',async(body)=>{sent=JSON.parse(body);return fixture();});
 const result=await provider.screen('Food',text);assert.equal(result.flagged,false);assert.deepEqual(sent,{model:reviewTextModel,input:`Headline:\nFood\n\nReview:\n${text}`});assert.equal(Object.keys(sent).length,2);
});
for(const category of ['harassment/threatening','hate','harassment','sexual','violence'])test(`category risk signal requires human review: ${category}`,()=>{const r=parseReviewTextSignal(fixture(category));assert.equal(r.flagged,true);assert.equal(r.categories[category],true);});
test('broad flag and inconsistent category flags are conservative holds, no score thresholds',()=>{
 const a=fixture();a.results[0].flagged=true;assert.equal(parseReviewTextSignal(a).flagged,true);
 const b=fixture('hate');b.results[0].flagged=false;assert.equal(parseReviewTextSignal(b).flagged,true);
 const c=fixture();c.results[0].category_scores.hate=.99;assert.equal(parseReviewTextSignal(c).flagged,false);assert.equal(reviewTextPolicy,'openai-clean-or-human-v1');
});
test('malformed cardinality, schema, model, scores and input modality fail closed',()=>{
 for(const mutate of [x=>x.results.push(x.results[0]),x=>x.results=[],x=>x.model='gpt-4',x=>x.id='invalid',x=>delete x.results[0].categories.hate,x=>x.results[0].categories.other=false,x=>x.results[0].category_scores.hate=NaN,x=>x.results[0].category_scores.hate=1.1,x=>x.results[0].category_applied_input_types.hate=['image'],x=>x.results[0].flagged='false']){const f=fixture();mutate(f);assert.throws(()=>parseReviewTextSignal(f));}
 const f=fixture();f.model='omni-moderation-2024-09-26';assert.equal(parseReviewTextSignal(f).model,f.model);
});
test('input limits, missing key, unavailable provider and bounded concurrent requests',async()=>{
 let calls=0;const p=new OpenAIReviewTextProvider(()=>'',async()=>{calls++;return fixture();});await assert.rejects(p.screen('ok','ok'));assert.equal(calls,0);
 const bounded=new OpenAIReviewTextProvider(()=> 'synthetic-test-key',async()=>{calls++;throw Error('synthetic failure');});
 await assert.rejects(bounded.screen('a'.repeat(201),''));await assert.rejects(bounded.screen('','a'.repeat(4001)));assert.equal(calls,0);await assert.rejects(bounded.screen('ok','ok'));assert.equal(calls,1);
 let release;const blocked=new Promise(r=>release=r);const concurrent=new OpenAIReviewTextProvider(()=> 'synthetic-test-key',async()=>{await blocked;return fixture();});const first=concurrent.screen('a','a'),second=concurrent.screen('b','b');await assert.rejects(concurrent.screen('c','c'));release();await Promise.all([first,second]);
});
for (const scenario of ['http-error','invalid-json','oversized','timeout','valid']) test(`fixed HTTPS transport: ${scenario}`,async(t)=>{
 const https=require('node:https'),{EventEmitter}=require('node:events');
 t.mock.timers.enable({apis:['setTimeout']});let options,sent,request;
 t.mock.method(https,'request',(o,callback)=>{options=o;request=new EventEmitter();request.destroy=(error)=>{request.emit('error',error);request.emit('close');};request.end=body=>{sent=JSON.parse(body);if(scenario==='timeout')return;const res=new EventEmitter();res.statusCode=scenario==='http-error'?429:200;callback(res);queueMicrotask(()=>{res.emit('data',Buffer.from(scenario==='oversized'?'x'.repeat(32769):scenario==='invalid-json'?'{':JSON.stringify(fixture())));res.emit('end');request.emit('close');});};return request;});
 const p=new OpenAIReviewTextProvider(()=> 'synthetic-key');const result=p.screen('Food','Tasty');
 if(scenario==='timeout')t.mock.timers.tick(8000);
 if(scenario==='valid')assert.equal((await result).flagged,false);else await assert.rejects(result);
 assert.equal(options.hostname,'api.openai.com');assert.equal(options.path,'/v1/moderations');assert.equal(options.method,'POST');assert.deepEqual(Object.keys(sent).sort(),['input','model']);
});
