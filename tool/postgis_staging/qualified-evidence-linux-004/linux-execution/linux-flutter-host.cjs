"use strict";
// Task-only fixed relays; only Mac loopback publications exist on the outer relay.
const net=require("node:net"), sockets=new Set();
const servers=[[8189,8188],[9190,9099]].map(([listen,port])=>net.createServer(socket=>{
 const target=net.connect({host:"127.0.0.1",port});sockets.add(socket);sockets.add(target);
 socket.on("error",()=>target.destroy());target.on("error",()=>socket.destroy());
 socket.on("close",()=>{sockets.delete(socket);target.destroy();});target.on("close",()=>{sockets.delete(target);socket.destroy();});
 socket.pipe(target);target.pipe(socket);
}).listen(listen,"0.0.0.0"));
process.once("SIGTERM",()=>{for(const s of servers)s.close();for(const s of sockets)s.destroy();});
require("/app/functions/test/support/postgis_flutter_host.cjs");
