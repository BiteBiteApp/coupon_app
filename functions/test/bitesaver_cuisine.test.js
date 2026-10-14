const assert = require('node:assert/strict');
const test = require('node:test');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {normalizeBiteSaverCuisines,publicBiteSaverCuisines,biteSaverCuisineMatches} = require('../lib/bitesaver_cuisine.js');
const cases=JSON.parse(readFileSync(path.resolve(__dirname,'../../test/fixtures/bitesaver_cuisine_cases.json'),'utf8'));
for (const [i,c] of cases.entries()) test(`shared cuisine matching case ${i}`,()=>assert.equal(biteSaverCuisineMatches(c.query,c.cuisines),c.expected));
test('bounded cuisine writer rejects invalid lists and normalizes valid labels',()=>{
 assert.deepEqual(normalizeBiteSaverCuisines([' BBQ ', 'bbq','New   American']),['BBQ','New American']);
 assert.deepEqual(normalizeBiteSaverCuisines([]),[]);
 for(const value of [null,'Thai',[123],[''],['123'],['!!!'],['Thai\nfood'],['Thai\u0000'],['\ud800Thai'],['x'.repeat(101)],Array(33).fill('Thai')]) assert.throws(()=>normalizeBiteSaverCuisines(value));
 assert.deepEqual(publicBiteSaverCuisines(undefined),[]);
 assert.deepEqual(publicBiteSaverCuisines(['Thai',12]),[]);
});
