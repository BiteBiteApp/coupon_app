"use strict";
const net=require("node:net");
// Fixed task-network destinations, never supplied by callers. No app/credentials loaded.
for(const [listen,port] of [[8189,8189],[9099,9190]])net.createServer(socket=>{const target=net.connect({host:"172.18.0.2",port});socket.on("error",()=>target.destroy());target.on("error",()=>socket.destroy());socket.on("close",()=>target.destroy());target.on("close",()=>socket.destroy());socket.pipe(target);target.pipe(socket);}).listen(listen,"0.0.0.0");
