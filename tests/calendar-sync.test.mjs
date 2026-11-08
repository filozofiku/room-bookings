import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {selection,googleEvent,synchronize} from '../calendar-sync/core.js';
import {connectionPage} from '../calendar-sync/page.js';
const digest=s=>createHash('sha256').update(s).digest('hex');
const event={id:'one',title:'Titulli',description:'Përshkrimi',date:'2026-11-08',start:'14:30',end:'16:00',room:'Salla 128'};
test('API events use local time, semester recurrence and holiday exclusions',()=>{
 const single=googleEvent(event);assert.deepEqual(single.recurrence,[]);assert.equal(single.start.dateTime,'2026-11-08T14:30:00');assert.equal(single.start.timeZone,'Europe/Tirane');assert(!('attendees'in single));
 const weekly=googleEvent({...event,weekly:true,until:'2026-12-31',exclusions:['2026-12-25']});assert.deepEqual(weekly.recurrence,['RRULE:FREQ=WEEKLY;UNTIL=20261231T225959Z','EXDATE;TZID=Europe/Tirane:20261225T143000']);
 for(const value of [{},{kind:'booking',id:'../private'},{kind:'calendar',id:'one'}])assert.throws(()=>selection(value));
});
test('same event is patched on changes, unchanged sources make no writes, and cancellations delete only managed IDs',()=>{
 const calls=[],stored=new Map();let item={kind:'booking',id:'one'};
 let version=0;const api=(path,method,body)=>{calls.push({path,method,body});if(method==='GET')return stored.get(path)||null;if(method==='DELETE'){stored.delete(path);return null;}const key=method==='POST'?path+'/'+body.id:path,result={...body,id:method==='POST'?body.id:path.split('/').at(-1),etag:String(++version),htmlLink:'https://www.google.com/calendar/event?eid=test'};stored.set(key,result);return result;};
 const run=e=>synchronize({item,event:e,calendarId:'app-created',api,digest,save:value=>item=value});
 run(event);const id=digest('booking:one');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(item.hash,digest(JSON.stringify(googleEvent(event))));
 calls.length=0;run(event);assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
 stored.clear();run(event);assert.equal(calls.at(-1).method,'POST');assert.equal(stored.size,1);
 const target=calls.at(-1).path+'/'+id;stored.set(target,{...stored.get(target),etag:'external-edit'});run(event);assert.equal(calls.at(-1).method,'PATCH');
 run({...event,start:'15:00',end:'16:30',title:'I ndryshuar'});assert.equal(calls.at(-1).method,'PATCH');assert(calls.at(-1).path.endsWith('/'+id));assert.equal(calls.at(-1).body.start.dateTime,'2026-11-08T15:00:00');
 run({cancelled:true});assert.equal(calls.at(-1).method,'DELETE');assert(calls.at(-1).path.startsWith('/calendars/app-created/events/'));assert.equal(stored.size,0);
});
function fixture(){
 let user='alice';const users=new Map(),events=new Map(),requests=[],cache=new Map();let next=0,unavailable=false,version=0,googleFailure=null;const invalidated=[];const calendars=new Map(),calendarEvents=new Map(),entries=new Map();
 const state=()=>{if(!users.has(user))users.set(user,{properties:new Map(),triggers:[]});return users.get(user);};
 const encode=v=>typeof v==='string'?{stringValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,v])=>[k,encode(v)]))}};
 const response=(status,data)=>({getResponseCode:()=>status,getContentText:()=>data?JSON.stringify(data):''});
 const fetch=(url,options={})=>{if(url.includes('firestore.googleapis.com')){if(unavailable)return response(503,{});const value=events.get(url.split('/documents/')[1]);return value?response(200,{fields:encode(value).mapValue.fields,updateTime:'2026-11-08T10:00:00Z'}):response(404,{});}
  assert(url.startsWith('https://www.googleapis.com/calendar/v3/'));assert.equal(options.headers.Authorization,'Bearer '+user);requests.push({user,url,...options});
  if(googleFailure&&url.includes(googleFailure.includes))return response(googleFailure.status,{error:{message:googleFailure.status===401?'Invalid Credentials':'Insufficient Permission',errors:[{reason:googleFailure.status===401?'authError':'insufficientPermissions'}]}});
  const body=options.payload?JSON.parse(options.payload):null;
  const path=url.split('/calendar/v3')[1],method=options.method||'GET';
  if(method==='POST'&&path==='/calendars'){const id=user+'-calendar-'+(++next),calendar={id,...body};calendars.set(id,calendar);entries.set(id,{id,selected:false,hidden:true});return response(200,calendar);}
  if(path.startsWith('/users/me/calendarList/')){const id=decodeURIComponent(path.split('/').at(-1));if(!entries.has(id))return response(404,{});if(method==='PATCH')entries.set(id,{...entries.get(id),...body});return response(200,entries.get(id));}
  if(/^\/calendars\/[^/]+$/.test(path))return calendars.has(decodeURIComponent(path.split('/').at(-1)))?response(200,calendars.get(decodeURIComponent(path.split('/').at(-1)))):response(404,{});
  if(method==='GET')return calendarEvents.has(path)?response(200,calendarEvents.get(path)):response(404,{});
  if(method==='DELETE'){calendarEvents.delete(path);return response(204);}
  const key=method==='POST'?path+'/'+body.id:path,result={...body,id:method==='POST'?body.id:path.split('/').at(-1),etag:String(++version),htmlLink:'https://www.google.com/calendar/event?eid=test'};calendarEvents.set(key,result);return response(200,result);
 };
 const ctx=vm.createContext({Intl,Date,console,PropertiesService:{getUserProperties:()=>({getProperties:()=>Object.fromEntries(state().properties),getProperty:k=>state().properties.get(k)||null,setProperty:(k,v)=>state().properties.set(k,v),deleteProperty:k=>state().properties.delete(k)})},LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},ScriptApp:{invalidateAuth:()=>invalidated.push(user),getOAuthToken:()=>user,getProjectTriggers:()=>state().triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:n=>({create:()=>{assert.equal(n,5);state().triggers.push({getHandlerFunction:()=>handler});}})})}),deleteTrigger:t=>{state().triggers=state().triggers.filter(v=>v!==t);}},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()]},UrlFetchApp:{fetch,fetchAll:rs=>rs.map(r=>fetch(r.url,r))}});
 vm.runInContext(readFileSync(new URL('../calendar-sync/CalendarSync.gs',import.meta.url),'utf8'),ctx);
 return {api:ctx,events,requests,cache,invalidated,failGoogle:value=>{googleFailure=value;},as:value=>{user=value;},fail:value=>{unavailable=value;}};
}
test('standalone app isolates user properties, calendars, tokens and triggers; retries failed sources safely',()=>{
 const f=fixture();f.events.set('publicBookings/one',{title:'Titulli',date:'2026-11-08',periodIds:['p1'],roomId:'r1'});f.events.set('periods/p1',{start:'14:30',end:'16:00'});f.events.set('rooms/r1',{name:'Salla 128'});
 const a=f.api.connectFacultyActivity({kind:'booking',id:'one'});assert.equal(a.items.length,1);assert.equal(a.automatic,true);assert.equal(a.calendar.visible,true);assert.equal(a.calendar.id,'alice-calendar-1');assert.equal(a.calendar.name,'Fakulteti Filozofik · Orari');assert(a.calendar.url.includes('alice-calendar-1'));assert(a.items[0].eventUrl);assert.equal(a.action,'connected');
 f.as('bob');assert.equal(f.api.facultyCalendarStatus().items.length,0);f.api.connectFacultyActivity({kind:'booking',id:'one'});assert(f.requests.some(r=>r.user==='bob'&&r.url.includes('bob-calendar')));assert(!f.requests.some(r=>r.user==='bob'&&r.url.includes('alice-calendar')));
 f.as('alice');f.api.connectFacultyActivity({kind:'booking',id:'one'});assert.equal(f.api.facultyCalendarStatus().items.length,1);const before=f.requests.filter(r=>r.method!=='GET').length;f.fail(true);f.cache.clear();const failed=f.api.syncFacultyCalendar();assert(failed.lastError);assert.equal(f.requests.filter(r=>r.method!=='GET').length,before);assert.equal(failed.items.length,1);
 f.fail(false);f.events.delete('publicBookings/one');f.cache.clear();f.api.syncFacultyCalendar();assert.equal(f.api.facultyCalendarStatus().items.length,0);assert.equal(f.api.facultyCalendarStatus().automatic,false);assert(f.requests.some(r=>r.method==='DELETE'&&r.user==='alice'));
 f.as('bob');assert.equal(f.api.facultyCalendarStatus().items.length,1);const count=f.requests.filter(r=>r.method!=='GET').length;f.api.stopFacultyCalendar();assert.equal(f.requests.filter(r=>r.method!=='GET').length,count);assert.equal(f.api.facultyCalendarStatus().automatic,false);
});
test('connection requires an explicit user action and both languages preserve safe author text',()=>{
 for(const lang of ['en','sq']){const html=connectionPage({kind:'booking',id:'one'},lang);assert(html.includes('google.script.run'));assert(html.includes("$('add').onclick"));assert(!html.includes("call('connectFacultyActivity');"));assert(html.includes('every five minutes')||html.includes('çdo pesë minuta'));}
 const manifest=JSON.parse(readFileSync(new URL('../calendar-sync/appsscript.json',import.meta.url)));assert.equal(manifest.webapp.executeAs,'USER_ACCESSING');assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar.app.created'));assert(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar'));
});

test('calendar-list permission errors do not block writes; 401 errors explain reauthorization and preserve user selections',()=>{
 const f=fixture();f.events.set('publicBookings/one',{title:'Titulli',date:'2026-11-08',periodIds:['p1'],roomId:'r1'});f.events.set('periods/p1',{start:'14:30',end:'16:00'});f.events.set('rooms/r1',{name:'Salla 128'});
 f.failGoogle({includes:'/users/me/calendarList/',status:403});const connected=f.api.connectFacultyActivity({kind:'booking',id:'one'});assert.equal(connected.action,'connected');assert(connected.items[0].eventUrl);assert.match(connected.calendar.visibilityWarning,/calendar visibility failed \(403\)/);assert.equal(connected.calendar.error,undefined);
 f.failGoogle({includes:'/calendar/v3/',status:401});const status=f.api.facultyCalendarStatus();assert.equal(status.calendar.errorStatus,401);assert.match(status.calendar.error,/authError: Invalid Credentials/);assert.throws(()=>f.api.connectFacultyActivity({kind:'booking',id:'one'}),/\(401\)/);
 const reset=f.api.reauthorizeFacultyCalendar();assert.equal(reset.authorizationReset,true);assert.equal(f.invalidated.length,1);assert.equal(f.api.facultyCalendarStatus().items.length,1);assert.equal(f.api.facultyCalendarStatus().automatic,false);
 f.failGoogle(null);const again=f.api.connectFacultyActivity({kind:'booking',id:'one'});assert.equal(again.calendar.id,connected.calendar.id);assert.equal(again.automatic,true);assert.equal(again.items.length,1);
});
