import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modificationEmail} from '../mailer/modification-email.js';
import {deliverCancellation} from '../mailer/cancellation-email.js';
const before={title:'Titulli i vjetër',date:'2026-10-28',roomId:'r1',periodIds:['p01'],ownerUid:'owner',groupIds:['g1'],teacherIds:['t1'],eventType:'Panel',isPublic:false,mode:'physical'};
const booking={...before,title:'Titulli i ri',date:'2026-10-29',roomId:'',periodIds:['p02'],mode:'online',onlineUrl:'https://example.test',description:'Përshkrimi',isPublic:true};
const periods=[{id:'p01',start:'08:00',end:'08:15'},{id:'p02',start:'09:00',end:'09:15'}];
const rooms=[{id:'r1',name:'Salla 014'}],catalog={groups:{g1:'Grupi 1'},teachers:{t1:'Mësimdhënësi 1'}};
test('modification email explains old/new values in Albanian',()=>{
 const mail=modificationEmail({before,booking,modifierName:'Jon'},periods,rooms,catalog);
 assert.equal(mail.subject,'Njoftim për ndryshimin e rezervimit');
 for(const text of ['Titulli i vjetër','Titulli i ri','2026-10-28','2026-10-29','08:00–08:15','09:00–09:15','Salla 014','Pa sallë','Grupi 1','Mësimdhënësi 1','https://example.test','Përshkrimi','Jon','mos iu përgjigjni'])assert.ok(mail.text.includes(text),text);
});
test('modification queue sends to original owner and suppresses duplicate delivery',async()=>{
 let record={before,booking,modifierName:'Jon',status:'pending'};
 const sent=[];
 const db={runTransaction:fn=>fn({get:async()=>({exists:true,data:()=>record}),update:(ref,patch)=>record={...record,...patch}}),collection:name=>({get:async()=>({docs:(name==='periods'?periods:rooms).map(v=>({id:v.id,data:()=>v}))})}),doc:path=>({get:async()=>({data:()=>path==='resourceCatalog/current'?catalog:{}})})};
 const deps={db,auth:{getUser:async uid=>{assert.equal(uid,'owner');return {email:'owner@example.test'}}},send:async mail=>sent.push(mail),now:()=>1,timestamp:ms=>({toMillis:()=>ms}),token:'token'};
 await deliverCancellation({id:'reservation__1'},deps);await deliverCancellation({id:'reservation__1'},deps);
 assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.test');assert.match(sent[0].messageId,/^<modification-/);assert.equal(record.status,'sent');
});
