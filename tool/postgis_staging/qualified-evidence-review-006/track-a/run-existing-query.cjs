const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
const selected=path.resolve(__dirname,'../selected-source/functions'),file=selected+'/test/postgis_query.test.js';
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
const {createLocalPostgisPool}=require(__dirname+'/compiled/lib/postgis_store.js');
(async()=>{const pool=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_query006',user:'bsgate0'});try{if(!(await pool.query("SELECT datname FROM pg_database WHERE datname='bsgate0_query006_regression'")).rows.length)await pool.query('CREATE DATABASE bsgate0_query006_regression');}finally{await pool.end();}
 m._compile(fs.readFileSync(file,'utf8').replaceAll('bsgate0_query','bsgate0_query006_regression'),file);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
