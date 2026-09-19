"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
if (process.env.BITESAVER_FIRESTORE_EMULATOR_TEST !== "1") {
  test("BiteScore photo transaction/storage integration requires explicit local emulators", {skip:"set BITESAVER_FIRESTORE_EMULATOR_TEST=1 with loopback Firestore+Storage/demo project"},()=>{});
} else {
  const loopback=value=>/^(?:localhost|127\.0\.0\.1):[1-9][0-9]{0,4}$/.test(value??"") || /^\[::1\]:[1-9][0-9]{0,4}$/.test(value??"");
  assert(loopback(process.env.FIRESTORE_EMULATOR_HOST));
  assert(loopback(process.env.FIREBASE_STORAGE_EMULATOR_HOST));
  for (const name of ["FIREBASE_EMULATOR_HUB","FIREBASE_EMULATOR_HUB_HOST"]) if(process.env[name]) assert(loopback(process.env[name]));
  const projectId=process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  assert.match(projectId??"",/^demo-bs-adapter-[a-z0-9-]+$/);
  if(process.env.GCLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT)assert.equal(process.env.GCLOUD_PROJECT,process.env.GOOGLE_CLOUD_PROJECT);
  assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const {initializeApp,deleteApp}=require("firebase-admin/app");
  const {getFirestore}=require("firebase-admin/firestore");
  const {getStorage}=require("firebase-admin/storage");
  const {createCustomerBiteScorePhotoHandler:create,toggleCustomerBiteScorePhotoVoteHandler:vote}=require("../lib/customer_bitescore_photos.js");
  test("real Firestore photo create/vote uses actual Storage metadata and survives contention without private response fields",async()=>{
    const photoProjectId=`${projectId}-photos`;
    const app=initializeApp({projectId:photoProjectId,storageBucket:`${photoProjectId}.appspot.com`});
    const other=initializeApp({projectId:photoProjectId},`photo-contender-${randomUUID()}`);
    const db=getFirestore(app), db2=getFirestore(other), bucket=getStorage(app).bucket();
    const unique=randomUUID(), dishId=`photo dish 寿司🍣-${unique}`, restaurantId=`photo-restaurant-${unique}`, imageId=`photo-${unique}`;
    const userId=`user-${unique}`, storagePath=`bitescore_dishes/${dishId}/images/123.jpg`, token=randomUUID();
    const auth=(uid=userId)=>({uid,token:{email_verified:true,firebase:{sign_in_provider:"password"}}});
    const data={schemaVersion:1,expectedUserId:userId,imageId,dishId,restaurantId,reviewId:null,mode:"gallery",storagePath,
      imageUrl:`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`};
    const runtime="private_bitescore_runtime/aggregation";
    const paths=[runtime,`bitescore_dishes/${dishId}`,`bitescore_restaurants/${restaurantId}`,`bitescore_dish_images/${imageId}`,
      ...Array.from({length:6},(_,i)=>`bitescore_dish_image_votes/${imageId}_${userId}-${i}`)];
    try {
      await bucket.file(storagePath).save(Buffer.from([0xff,0xd8,0xff,0xd9]),{resumable:false,metadata:{contentType:"image/jpeg",metadata:{firebaseStorageDownloadTokens:token}}});
      await db.doc(runtime).set({enabled:true,version:1,epoch:unique});
      await db.doc(`bitescore_dishes/${dishId}`).set({id:dishId,restaurantId,isActive:true,imageCount:0});
      await db.doc(`bitescore_restaurants/${restaurantId}`).set({id:restaurantId,isActive:true,ownerUserId:"PRIVATE_OWNER"});
      await assert.rejects(create(db,{data,auth:null}),{code:"unauthenticated"});
      await assert.rejects(create(db,{data,auth:auth("replacement-user")}),{code:"permission-denied"});
      const created=await Promise.all([create(db,{data,auth:auth()}),create(db2,{data,auth:auth()})]);
      assert.equal((await db.doc(`bitescore_dishes/${dishId}`).get()).data().imageCount,1);
      assert.equal(created[0].image.id,imageId);
      assert.equal(JSON.stringify(created).includes("uploadedByUserId"),false);
      assert.equal(JSON.stringify(created).includes("storagePath"),false);
      await Promise.all(Array.from({length:6},(_,i)=>vote(i%2?db2:db,{auth:auth(`${userId}-${i}`),data:{schemaVersion:1,expectedUserId:`${userId}-${i}`,imageId,dishId,restaurantId,voteType:"helpful"}})));
      assert.equal((await db.doc(`bitescore_dish_images/${imageId}`).get()).data().helpfulCount,6);
      await assert.rejects(create(db,{data:{...data,imageId:`missing-${imageId}`,storagePath:storagePath.replace("123.jpg","missing.jpg"),imageUrl:data.imageUrl.replace("123.jpg","missing.jpg")},auth:auth()}),{code:"failed-precondition"});
      await assert.rejects(vote(db,{auth:auth(),data:{schemaVersion:1,expectedUserId:userId,imageId,dishId,restaurantId:"wrong",voteType:"helpful"}}),{code:"failed-precondition"});
    }finally{
      await Promise.all(paths.map(path=>db.doc(path).delete()));
      await bucket.file(storagePath).delete({ignoreNotFound:true});
      await Promise.all([deleteApp(app),deleteApp(other)]);
    }
  });
}
