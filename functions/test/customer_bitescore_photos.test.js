"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {MemoryFirestore} = require("./helpers/bitescore_read_fixture.js");
const {createCustomerBiteScorePhotoHandler:create, toggleCustomerBiteScorePhotoVoteHandler:vote} = require("../lib/customer_bitescore_photos.js");
const ownerKey=uid=>require("node:crypto").createHash("sha256").update(`bitestar.dish-upload.v1:${uid}`).digest("hex");
const bucket="demo-photos.firebasestorage.app", token="download-token";
const auth=(uid="user", overrides={})=>({uid,token:{email_verified:true,firebase:{sign_in_provider:"password"},...overrides}});
const input=(overrides={})=>({schemaVersion:1,expectedUserId:"user",imageId:"image",dishId:"dish",restaurantId:"restaurant",reviewId:null,
  imageUrl:`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`bitescore_user_uploads/${ownerKey("user")}/dish_images/dish/123.jpg`)}?alt=media&token=${token}`,
  storagePath:`bitescore_user_uploads/${ownerKey("user")}/dish_images/dish/123.jpg`,mode:"gallery",...overrides});
const request=(data=input(), actor=auth())=>({data,auth:actor});
const options={now:new Date(1000),readUploadedObject:async name=>({bucket,name,size:100,contentType:"image/jpeg",downloadTokens:[token],generation:"10",metadata:{ownershipVersion:"1",uploaderKey:name.split("/")[1],dishId:name.split("/")[3]}})};
function db(){const value=new MemoryFirestore();value.values.set("private_bitescore_runtime/aggregation",{enabled:true,version:1,epoch:"new"});
  value.values.set("bitescore_dishes/dish",{id:"dish",restaurantId:"restaurant",isActive:true,imageCount:0,privateOwner:"CANARY"});
  value.values.set("bitescore_restaurants/restaurant",{id:"restaurant",isActive:true,ownerUserId:"owner",privateOwner:"CANARY"});return value;}
const voteRequest=(voteType="helpful",uid="user")=>request({schemaVersion:1,expectedUserId:uid,imageId:"image",dishId:"dish",restaurantId:"restaurant",voteType},auth(uid));

test("photo create verifies actual caller, target upload and returns only public fields; retry preserves one image",async()=>{
 const store=db(); const result=await create(store,request(),options); await create(store,request(),options);
 assert.equal(store.values.get("bitescore_dishes/dish").imageCount,1);
 assert.equal(store.values.get("bitescore_dish_images/image").uploadedByUserId,"user");
 assert.equal(result.image.id,"image");assert.equal(result.image.createdAtMs,1000);
 for(const privateField of ["uploadedByUserId","storagePath","CANARY"]) assert.equal(JSON.stringify(result).includes(privateField),false);
 assert.deepEqual(store.limits,[]);
});
test("photo storage identity preserves canonical Unicode and spaces without accepting sanitized aliases",async()=>{
 const store=db(),dishId="dish crème 寿司🍣",storagePath=`bitescore_user_uploads/${ownerKey("user")}/dish_images/${dishId}/123.jpg`;
 store.values.set(`bitescore_dishes/${dishId}`,{id:dishId,restaurantId:"restaurant",isActive:true,imageCount:0});
 const data=input({dishId,storagePath,imageUrl:`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`});
 const result=await create(store,request(data),options);assert.equal(result.image.dishId,dishId);
 assert.equal(store.values.get("bitescore_dish_images/image").storagePath,storagePath);
 const aliasPath="bitescore_user_uploads/user/dish_images/dish_cr_me_/123.jpg";
 await assert.rejects(create(store,request({...data,imageId:"alias",storagePath:aliasPath,imageUrl:`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(aliasPath)}?alt=media&token=${token}`}),options),{code:"invalid-argument"});
});
test("photo authentication fails before Storage or database reads",async()=>{
 let reads=0;const never={...options,readUploadedObject:async()=>{reads++;throw Error("unexpected");}};
 for(const actor of [null,{},auth("user",{firebase:{sign_in_provider:"anonymous"}}),auth("user",{email_verified:false}),auth(" user "),auth("user",{email_verified:"true"})]){
   await assert.rejects(create(db(),request(input(),actor),never));
   await assert.rejects(vote(db(),{...voteRequest(),auth:actor}));
 }
 assert.equal(reads,0);
});
test("photo account pin rejects a replaced actual actor before any Firestore or Storage access",async()=>{
 let accesses=0;
 const never=new Proxy({}, {get(){accesses++;throw Error("unexpected database access");}});
 const guarded={...options,readUploadedObject:async()=>{accesses++;throw Error("unexpected Storage access");}};
 for(const expectedUserId of ["old-user", " replacement ", null]) {
  await assert.rejects(create(never,request(input({expectedUserId}),auth("replacement")),guarded),{code:"permission-denied"});
  await assert.rejects(vote(never,{...voteRequest("helpful","replacement"),data:{...voteRequest("helpful","replacement").data,expectedUserId}}),{code:"permission-denied"});
 }
 assert.equal(accesses,0);
});
test("photo creation preserves Admin metadata right but voting requires verified actor",async()=>{
 const store=db();await create(store,request(input({expectedUserId:"admin-user",storagePath:input().storagePath.replace(ownerKey("user"),ownerKey("admin-user")),imageUrl:input().imageUrl.replace(ownerKey("user"),ownerKey("admin-user"))}),auth("admin-user",{email_verified:false,admin:true})),options);
 assert.equal(store.values.get("bitescore_dish_images/image").uploadedByUserId,"admin-user");
 await assert.rejects(vote(store,{...voteRequest(),auth:auth("admin-user",{email_verified:false,admin:true})}),{code:"permission-denied"});
});
test("photo create rejects spoofed uploader fields, mismatched upload path/url/token/bucket and invalid objects",async()=>{
 for(const change of [{uploadedByUserId:"other"},{dishId:" dish"},{storagePath:"bitescore_dishes/other/images/123.jpg"},
   {imageUrl:"https://evil.example/image.jpg"},{imageUrl:input().imageUrl.replace(token,"wrong")},
   {imageUrl:input().imageUrl.replace(bucket,"another.firebasestorage.app")},{mode:"missing",reviewId:"foreign"}]) {
  const store=db();await assert.rejects(create(store,request(input(change)),options));assert.equal(store.values.has("bitescore_dish_images/image"),false);
 }
 for(const change of [{size:5*1024*1024+1},{size:0},{contentType:"text/html"},{name:"wrong/path"}]) {
  await assert.rejects(create(db(),request(),{...options,readUploadedObject:async name=>({...await options.readUploadedObject(name),...change})}),{code:"failed-precondition"});
 }
});
test("photo parent, review attribution, runtime and destructive locks are authoritative",async()=>{
 for(const [path,data] of [["bitescore_dishes/dish",{restaurantId:"other",isActive:true}],
  ["bitescore_dishes/dish",{restaurantId:"restaurant",isActive:false}],
  ["bitescore_restaurants/restaurant",{isActive:false}],
  ["private_bitescore_runtime/aggregation",{enabled:false}],
  ["private_rating_dish_operation_locks/dish",{active:true}],
  ["private_rating_restaurant_operation_locks/restaurant",{active:true}],
  ["private_dish_merge_review_locks/dish",{blocksClientAggregates:true}]]) {
   const store=db();store.values.set(path,data);await assert.rejects(create(store,request(),options));assert.equal(store.values.has("bitescore_dish_images/image"),false);
 }
 const store=db();store.values.set("dish_reviews/review",{dishId:"dish",restaurantId:"restaurant",userId:"other"});
 await assert.rejects(create(store,request(input({mode:"review",reviewId:"review"})),options),{code:"permission-denied"});
 store.values.set("dish_reviews/review",{dishId:"dish",restaurantId:"restaurant",userId:"user"});
 await create(store,request(input({mode:"review",reviewId:"review"})),options);
 assert.equal(store.values.get("bitescore_dish_images/image").reviewId,"review");
});
test("concurrent missing-image additions allow one image and reject identity reuse by another actor",async()=>{
 const store=db();const results=await Promise.allSettled(["a","b"].map(imageId=>create(store,request(input({imageId,mode:"missing"})),options)));
 assert.equal(results.filter(v=>v.status==="fulfilled").length,1);assert.equal(store.values.get("bitescore_dishes/dish").imageCount,1);
 const winner=results.findIndex(v=>v.status==="fulfilled")===0?"a":"b";
 await assert.rejects(create(store,request(input({imageId:winner,expectedUserId:"other"}),auth("other")),options),{code:"invalid-argument"});
});
test("photo vote toggles, switches and concurrent users preserve authoritative counts",async()=>{
 const store=db();await create(store,request(),options);
 await Promise.all(Array.from({length:15},(_,i)=>vote(store,voteRequest("helpful","voter"+i),{now:new Date(2000)})));
 assert.equal(store.values.get("bitescore_dish_images/image").helpfulCount,15);
 let result=await vote(store,voteRequest("notHelpful","voter0"));assert.equal(result.image.helpfulCount,14);assert.equal(result.image.notHelpfulCount,1);
 result=await vote(store,voteRequest("notHelpful","voter0"));assert.equal(result.currentUserVoteType,null);assert.equal(result.image.notHelpfulCount,0);
 assert.equal(store.values.has("bitescore_dish_image_votes/image_voter0"),false);
 for(const field of ["uploadedByUserId","storagePath"]) assert.equal(Object.hasOwn(result.image,field),false);
});
test("photo votes reject missing image, wrong parent, locks and another actor's colliding vote document",async()=>{
 const store=db();await assert.rejects(vote(store,voteRequest()),{code:"failed-precondition"});
 await create(store,request(),options);
 await assert.rejects(vote(store,{...voteRequest(),data:{...voteRequest().data,restaurantId:"other"}}),{code:"failed-precondition"});
 store.values.set("bitescore_dish_image_votes/image_user",{userId:"foreign",imageId:"other",dishId:"dish",restaurantId:"restaurant",voteType:"helpful"});
 await assert.rejects(vote(store,voteRequest()),{code:"failed-precondition"});
 store.values.delete("bitescore_dish_image_votes/image_user");store.values.set("private_rating_dish_operation_locks/dish",{active:true});
 await assert.rejects(vote(store,voteRequest()),{code:"unavailable"});
 assert.equal(store.values.get("bitescore_dish_images/image").helpfulCount,0);
});

test("new photo ownership rejects foreign metadata and forged proof on retired paths",async()=>{
 for(const metadata of [{ownershipVersion:"1",uploaderKey:ownerKey("B"),dishId:"dish"},{ownershipVersion:"1",uploaderKey:ownerKey("user"),dishId:"B"},{ownershipVersion:"2",uploaderKey:ownerKey("user"),dishId:"dish"},{}]) {
  const store=db(); await assert.rejects(create(store,request(),{...options,readUploadedObject:async name=>({...await options.readUploadedObject(name),metadata})}),{code:"failed-precondition"});
  assert.equal(store.values.has("bitescore_dish_images/image"),false);
 }
 const storagePath="bitescore_dishes/dish/images/old.jpg";
 await assert.rejects(create(db(),request(input({storagePath,imageUrl:`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`})),options),{code:"invalid-argument"});
 const store=db(); store.values.set("private_account_deletions/user",{});
 await assert.rejects(create(store,request(),options),{code:"failed-precondition"});
});
