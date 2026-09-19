"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./helpers/bitescore_read_fixture.js');
const s = require('../lib/customer_bitescore_suggestions.js');
const {buildBiteScoreDishIndex} = require('../lib/search_index_builders.js');
const {customerBiteScoreGenerationShardPaths, nextCustomerBiteScoreGenerationDocument} = require('../lib/customer_bitescore_search_contract.js');
const request = (extra = {}) => ({schemaVersion:1,clientInstanceId:'instanceabcdefghijkl',kind:'catalog',query:'pizza',clientRequestId:'requestabcdefghijkl',queryGeneration:1,...extra});
async function complete(db,context,r) {let page;let calls=0;do{page=await s.getCustomerBiteScoreSuggestionsHandler(db,{...r,cursor:page?.nextCursor},context);calls++;if(page.state==='preparing')assert.deepEqual(page.items,[]);}while(page.nextCursor);return {...page,calls};}
test('catalog score preserves token substring, aliases, bonuses and UTF16 name length',()=>{
  const exact=s.customerBiteScoreCatalogCandidate('a',{canonicalName:'Pizza',aliases:[' PIE ','Italian PIZZA'],ownerUid:'private'},'pizza');
  assert.deepEqual(exact.value,{canonicalName:'Pizza',aliases:['pie','italian pizza']});
  assert.equal(exact.score,955);
  assert.equal(s.customerBiteScoreCatalogCandidate('x',{name:'Margherita',aliases:['Wood fired pizza']},'wood piz').score,20-10);
  assert.equal(s.customerBiteScoreCatalogCandidate('x',{name:'Pizza'},'pizza fish'),null);
  assert.equal(s.customerBiteScoreCatalogCandidate('x',{title:' Pizzas '},'pizza').value.canonicalName,'Pizzas');
});
test('similar scorer preserves exact, containment, shared tokens and ordinary edit distance',()=>{
  assert.equal(s.customerBiteScoreSimilarDishScore('Fish & Chips',' fish-chips '),1);
  assert.equal(s.customerBiteScoreSimilarDishScore('Pizza','Pizza pie'),.88+.1*5/9);
  assert.ok(Math.abs(s.customerBiteScoreSimilarDishScore('Chicken taco','Chicken curry')-.68)<1e-12);
  assert.equal(s.customerBiteScoreSimilarDishScore('pizaz','pizza'),.6);
  assert.equal(s.customerBiteScoreSimilarDishScore('','pizza'),0);
});
test('catalog scans beyond first25 and keeps global top8 with canonical duplicate collapse',async()=>{
  const {db,context}=fixture();
  for(let i=0;i<65;i++)db.values.set('dish_catalog/'+String(i).padStart(3,'0'),{canonicalName:'Pizza '+String(i).padStart(3,'0'),privateNote:'secret'});
  db.values.set('dish_catalog/900',{canonicalName:'Pizza'});
  db.values.set('dish_catalog/901',{canonicalName:'PIZZA',aliases:['best pizza']});
  const result=await complete(db,context,request());
  assert.equal(result.calls,3);assert.equal(result.items.length,8);
  assert.equal(result.items[0].canonicalName,'Pizza');
  assert.equal(new Set(result.items.map(i=>i.canonicalName.toLowerCase())).size,8);
  assert.equal(JSON.stringify(result).includes('secret'),false);assert.ok(db.limits.every(n=>n===25));
});
test('continuations bind exact criteria, actor, generation and source version; duplicate retries do not scan twice',async()=>{
  const {db,context}=fixture();for(let i=0;i<35;i++)db.values.set('dish_catalog/'+i,{name:'Pizza '+i});
  const r=request();const first=await s.getCustomerBiteScoreSuggestionsHandler(db,r,context);
  const count=db.limits.length;
  const retry=await s.getCustomerBiteScoreSuggestionsHandler(db,r,context);assert.equal(retry.state,'preparing');assert.equal(db.limits.length,count);
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,{...r,cursor:first.nextCursor},{...context,actorId:'other'}));
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,{...r,query:'pie',cursor:first.nextCursor},context));
  const second=await s.getCustomerBiteScoreSuggestionsHandler(db,{...r,cursor:first.nextCursor},context);assert.equal(second.state,'ready');
  const again=await s.getCustomerBiteScoreSuggestionsHandler(db,{...r,cursor:first.nextCursor},context);assert.deepEqual(again.items,second.items);
  await s.reconcileCustomerBiteScoreSuggestionCatalog(db);
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,{...r,cursor:first.nextCursor},context));
});
test('older query is retired and large/malformed requests fail closed',async()=>{
  const {db,context}=fixture();for(let i=0;i<30;i++)db.values.set('dish_catalog/'+i,{name:'Pizza '+i});
  const first=await s.getCustomerBiteScoreSuggestionsHandler(db,request(),context);
  await s.getCustomerBiteScoreSuggestionsHandler(db,request({queryGeneration:2,clientRequestId:'newrequestabcdefghijkl'}),context);
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,{...request(),cursor:first.nextCursor},context));
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,request({query:'x'.repeat(801)}),context));
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,request({kind:'similar',restaurantId:' restaurant '}),context));
});
test('similar preview scans full restaurant and retains exact dish IDs even for equal names',async()=>{
  const {db,context}=fixture(); const restaurant=db.values.get('bitescore_restaurants/restaurant');
  for(let i=0;i<62;i++){
    const id='dish'+String(i).padStart(3,'0');const dish={name:i>=54?'Pizza':'Pizza '+i,restaurantId:'restaurant',isActive:true};
    const index=buildBiteScoreDishIndex({sourceDocumentId:id,dish,restaurantDocumentId:'restaurant',restaurant,aggregate:{overallBiteScore:80,ratingCount:1},now:new Date()});
    db.values.set('bitescore_dishes/'+id,dish);db.values.set('dish_search_index/'+index.indexDocumentId,index);
  }
  const r=request({kind:'similar',restaurantId:'restaurant'});const result=await complete(db,context,r);
  assert.equal(result.calls,3);assert.equal(result.items.length,8);assert.ok(result.items.every(i=>i.displayName==='Pizza'));
  assert.deepEqual(result.items.map(i=>i.sourceDocumentId),Array.from({length:8},(_,i)=>'dish'+String(54+i).padStart(3,'0')));
  const firstId=result.items[0].sourceDocumentId;db.values.get('bitescore_dishes/'+firstId).isActive=false;
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,r,context));
});
test('catalog winner mutation is rejected before a ready replay even before trigger processes it',async()=>{
  const {db,context}=fixture();db.values.set('dish_catalog/a',{name:'Pizza'});const r=request();
  await complete(db,context,r);db.values.set('dish_catalog/a',{name:'Pepperoni'});
  await assert.rejects(s.getCustomerBiteScoreSuggestionsHandler(db,r,context));
});

test('new client instance for same authenticated actor starts its own generation',async()=>{
 const {db,context}=fixture();db.values.set('dish_catalog/a',{name:'Pizza'});
 await complete(db,context,request({queryGeneration:10}));
 const result=await complete(db,context,request({clientInstanceId:'anotherinstanceabcdefghijkl',queryGeneration:1}));
 assert.equal(result.items.length,1);
});
