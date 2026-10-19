// Task006 fixed local synthetic fixture ports only. No cloud proxy or credentials.
'use strict';
const net=require('node:net');
for(const [port,host,target] of [[55441,'127.0.0.1',5432],[8088,'172.17.0.3',8088],[9099,'172.17.0.3',9099],[9199,'172.17.0.3',9199]]){
 const server=net.createServer(socket=>{socket.setNoDelay(true);const upstream=net.connect(target,host);upstream.setNoDelay(true);socket.pipe(upstream).pipe(socket);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());});
 server.listen(port,'127.0.0.1',()=>console.log('local fixture relay '+port));
}
