import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {encode,decode} from '../mailer/firestore-rest.js';import {deliveryId} from '../mailer/public-event-email.js';
function fixture({quota=100,email='zzha.filozofik@uni-pr.edu',enabled=true,now='2026-11-16T07:00:00Z'}={}){
 const props=new Map([['FIREBASE_REFRESH_TOKEN','secret-test'],['EMAIL_ENABLED',String(enabled)]]),cache=new Map(),sent=[],triggers=[],calls=[];let version=0,locked=false;
 const booking={ownerUid:'owner',creatorName:'Teacher',date:'2026-11-16',periodIds:['p1'],title:'Panel',roomId:'',groupIds:[],teacherIds:[],isPublic:true,mode:'online',onlineUrl:'https://example.test/event',description:'Përshkrim'};
 const records=new Map(Object.entries({'periods/p1':{start:'13:00',end:'13:15'},'users/owner':{email:'owner@example.test'},'resourceCatalog/current':{},'mailSettings/publicEvents':{enabled:true,recipients:['staff@example.test']},'publicBookings/event':booking,'cancellationNotifications/cancel':{booking,reason:'Arsye',status:'pending'},'requestNotifications/request':{booking,kind:'request-submitted',status:'pending'}}));
 const versions=new Map();const raw=path=>({name:'projects/filozofiku/databases/(default)/documents/'+path,fields:encode(records.get(path)).mapValue.fields,updateTime:versions.get(path)||'2026-01-01T00:00:00Z'});
 const response=(value,status=200)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(value)});
 const context=vm.createContext({console:{log(){}},Intl,Date:class extends Date{constructor(...args){super(...(args.length?args:[Date.parse(now)]));}static now(){return Date.parse(now);}},JSON,encodeURIComponent,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
  Session:{getEffectiveUser:()=>({getEmail:()=>email})},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
  MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:m=>{assert(quota>0);quota--;sent.push(m);}},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(a,v)=>[...createHash(a).update(v).digest()],getUuid:()=>('12345678-1234-1234-1234-'+String(++version).padStart(12,'0'))},
  ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:n=>({create:()=>triggers.push({getHandlerFunction:()=>handler,minutes:n})})})}),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1)},
  UrlFetchApp:{fetch:(url,options)=>{
   calls.push(url);
   if(url.startsWith('https://securetoken.googleapis.com/'))return response({user_id:'cancellation-mail-worker',id_token:'id-test',refresh_token:'secret-test'});
   const suffix=url.split('/documents')[1],body=options.payload?JSON.parse(options.payload):null;
   if(suffix===':runQuery'){
    const q=body.structuredQuery,name=q.from[0].collectionId,f=q.where.fieldFilter,val=decode(f.value);
    return response([...records.keys()].filter(p=>p.startsWith(name+'/')).filter(p=>f.op==='IN'?val.includes(records.get(p)[f.field.fieldPath]):f.op==='EQUAL'?records.get(p)[f.field.fieldPath]===val:records.get(p)[f.field.fieldPath]>=val).slice(0,q.limit||10000).map(p=>({document:raw(p)})));
   }
   if(suffix===':commit'){
    const w=body.writes[0],path=w.update.name.split('/documents/')[1];
    if(w.currentDocument.exists===false&&records.has(path))return response({error:{status:'ALREADY_EXISTS'}},409);
    if(w.currentDocument.updateTime&&raw(path).updateTime!==w.currentDocument.updateTime)return response({error:{status:'FAILED_PRECONDITION'}},409);
    records.set(path,{...records.get(path),...decode({mapValue:{fields:w.update.fields}})});versions.set(path,'v'+(++version));return response({});
   }
   const path=decodeURIComponent(suffix.slice(1).split('?')[0]);
   if(suffix.includes('?pageSize='))return response({documents:[...records.keys()].filter(p=>p.startsWith(path+'/')).map(raw)});
   return records.has(path)?response(raw(path)):response({error:{status:'NOT_FOUND'}},404);
  }}
 });vm.runInContext(readFileSync('apps-script/Code.gs','utf8'),context);
 return {context,records,sent,props,triggers,booking,calls};
}
test('connection check sends nothing and preserves pending records',async()=>{const f=fixture();const report=await f.context.checkConnection();assert.equal(report.mode,'check');assert.equal(f.sent.length,0);assert.equal(f.records.get('requestNotifications/request').status,'pending');assert(!f.records.has('publicEventWeeks/2026-11-16'));});
test('request priority, shared receipts, public delivery IDs, and repeat suppression',async()=>{const f=fixture();await f.context.runEmailWorker();assert.equal(f.sent[0].to,'arsim.sinani@uni-pr.edu');assert(f.sent.every(m=>m.htmlBody.includes('<html lang="sq">')));assert(f.sent.every(m=>!m.body.includes('Kërkuesi:')&&!m.body.includes('Rezervuar nga:')));assert.equal(f.sent.length,3);assert.equal(f.records.get('publicEventDeliveries/'+deliveryId('2026-11-16','staff@example.test')).status,'sent');assert.equal(f.records.get('cancellationNotifications/cancel').status,'sent');f.props.set('LAST_PUBLIC_SCAN','0');await f.context.runEmailWorker();assert.equal(f.sent.length,3);});
test('paused or quota-exhausted workers do not claim notifications',async()=>{for(const options of [{enabled:false},{quota:0}]){const f=fixture(options);await f.context.runEmailWorker();assert.equal(f.sent.length,0);assert.equal(f.records.get('requestNotifications/request').status,'pending');}});
test('sender enforcement and idempotent timer installation',async()=>{const wrong=fixture({email:'wrong@example.test'});await assert.rejects(wrong.context.checkConnection(),/run it as/);const f=fixture();await f.context.installMinuteTrigger();await f.context.installMinuteTrigger();assert.equal(f.triggers.length,1);assert.equal(f.triggers[0].minutes,1);assert.equal(f.sent.length,0);f.context.stopEmailWorker();assert.equal(f.triggers.length,0);assert.equal(f.props.get('EMAIL_ENABLED'),'false');});

test('public digests wait until Monday 08:00 local and never send 48-hour notices',async()=>{
 for(const now of ['2026-11-15T07:00:00Z','2026-11-16T06:59:59Z','2026-11-17T07:00:00Z']){
  const f=fixture({now});await f.context.runEmailWorker();assert.equal(f.sent.length,2);assert(![...f.records.keys()].some(k=>k.startsWith('publicEventDeliveries/')));
 }
 const f=fixture({now:'2026-11-16T07:00:00Z'});f.records.set('publicBookings/second',{...f.booking,title:'Sunday',date:'2026-11-22'});await f.context.runEmailWorker();assert.equal(f.sent.length,3);assert(f.sent[2].body.includes('Sunday'));assert(f.sent[2].body.includes('unsubscribe.html#id='));
});

test('completed digests do not reread reference collections and recipient receipts each minute',async()=>{
 const f=fixture();await f.context.runEmailWorker();const count=f.calls.length;await f.context.runEmailWorker();
 const followup=f.calls.slice(count);assert(!followup.some(url=>url.includes('/periods?')||url.includes('/rooms?')||url.includes('/mailSettings/')));
 assert.equal(f.sent.length,3);assert(f.props.has('PUBLIC_SCAN_AFTER'));
});
