"use strict";
const net=require("node:net"),sockets=new Set();
const server=net.createServer(client=>{const upstream=net.connect({host:"127.0.0.1",port:8088});for(const s of [client,upstream]){sockets.add(s);s.on("close",()=>sockets.delete(s));s.on("error",()=>{client.destroy();upstream.destroy();});}client.pipe(upstream);upstream.pipe(client);});
server.listen(8792,"127.0.0.1",()=>console.log(JSON.stringify({kind:"task-only-loopback-firestore-relay",pid:process.pid,from:8792,to:8088})));
process.once("SIGTERM",()=>{for(const s of sockets)s.destroy();server.close(()=>process.exit(0));});
