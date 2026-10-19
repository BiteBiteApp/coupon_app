// Loopback-only local handler qualification. Never imports index/Firebase app,
// never invokes a live provider. GETs reuse the established safe preview server.
const http = require('node:http');
const {resolveCustomerLocationHandler,createCustomerLocationAdmission}=require('../../functions/lib/customer_location.js');
const {candidate,fakeDatabase}=require('../../functions/test/fixtures/customer_location.js');
const db=fakeDatabase();let calls=0;
const reserve=createCustomerLocationAdmission(db);
const server=http.createServer(async(req,res)=>{
 if(req.method==='POST' && req.url==='/__location') {
  let bytes=0,chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>2048){res.writeHead(413);res.end();return;}chunks.push(chunk);}
  const reply={};
  try {
   const data=JSON.parse(Buffer.concat(chunks).toString()).data;
   reply.result=await resolveCustomerLocationHandler(data,null,{
    getGeocodingApiKey:()=> 'LOCAL_FAKE_PROVIDER_KEY',dailyLimit:()=>250,reserve,
    fetchGeocoding:async(url)=>{
     calls++;const query=new URL(url).searchParams.get('address');
     if(query==='Unknownville, FL') return {ok:true,json:async()=>({status:'ZERO_RESULTS'})};
     const result=candidate(query);
     if(query==='34461') result.geometry.location={lat:28.86,lng:-82.49};
     return {ok:true,json:async()=>({status:'OK',results:[result]})};
    },
   });
  } catch(error) {reply.error={code:error.code??'invalid-argument',message:error.code?error.message:'Invalid local request'};}
  reply.mockProviderCalls=calls;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(reply));return;
 }
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 const proxy=http.get({hostname:'127.0.0.1',port:8773,path:req.url}, upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});
 proxy.on('error',()=>{res.writeHead(502);res.end('Start local preview on port8773.');});
});
server.listen(8774,'127.0.0.1',()=>console.log('Local mock Google fixture: http://localhost:8774/ (no live provider)'));
