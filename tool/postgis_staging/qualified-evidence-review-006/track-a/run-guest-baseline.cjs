const Module=require('node:module');
const original=Module._resolveFilename;
const selected=require('node:path').resolve(__dirname,'../selected-source/functions/lib')+'/';
Module._resolveFilename=function(...args){const found=original.apply(this,args);return found.startsWith(selected)?__dirname+'/baseline/lib/'+found.slice(selected.length):found;};
require(process.argv[2]);
