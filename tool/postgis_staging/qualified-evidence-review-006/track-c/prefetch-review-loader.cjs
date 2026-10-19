const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const original=Module._resolveFilename;
const base='/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-REVIEW-CORRECTIONS-006-20261019';
const source=base+'/selected-source/functions/lib/';
Module._resolveFilename=function(...args){const value=original.apply(this,args);if(typeof value==='string'&&value.startsWith(source)){const target=path.join(base,'track-c/prefetch-review-lib',value.slice(source.length));if(!fs.existsSync(target))throw Error('Missing independent compiled dependency.');return target;}return value;};
