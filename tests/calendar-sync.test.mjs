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
 const api=(path,method,body)=>{calls.push({path,method,body});if(method==='GET')return stored.get(path)||null;if(method==='POST')stored.set(path+'/'+body.id,body);if(method==='PATCH')stored.set(path,body);if(method==='DELETE')stored.delete(path);};
 const run=e=>synchronize({item,event:e,calendarId:'app-created',api,digest,save:value=>item=value});
 run(event);const id=digest('booking:one');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(item.hash,digest(JSON.stringify(googleEvent(event))));
 calls.length=0;run(event);assert.equal(calls.length,0);
 run({...event,start:'15:00',end:'16:30',title:'I ndryshuar'});assert.equal(calls.at(-1).method,'PATCH');assert(calls.at(-1).path.endsWith('/'+id));assert.equal(calls.at(-1).body.start.dateTime,'2026-11-08T15:00:00');
 run({cancelled:true});assert.equal(calls.at(-1).method,'DELETE');assert(calls.at(-1).path.startsWith('/calendars/app-created/events/'));assert.equal(stored.size,0);
});
function fixture(){
 let user='alice';const users=new Map(),events=new Map(),requests=[],cache=new Map();let next=0,unavailable=false;
 const state=()=>{if(!users.has(user))users.set(user,{properties:new Map(),triggers:[]});return users.get(user);};
 const encode=v=>typeof v==='string'?{stringValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,v])=>[k,encode(v)]))}};
 const response=(status,data)=>({getResponseCode:()=>status,getContentText:()=>data?JSON.stringify(data):''});
 const fetch=(url,options={})=>{if(url.includes('firestore.googleapis.com')){if(unavailable)return response(503,{});const value=events.get(url.split('/documents/')[1]);return value?response(200,{fields:encode(value).mapValue.fields,updateTime:'2026-11-08T10:00:00Z'}):response(404,{});}
  assert(url.startsWith('https://www.googleapis.com/calendar/v3/'));assert.equal(options.headers.Authorization,'Bearer '+user);requests.push({user,url,...options});
  const body=options.payload?JSON.parse(options.payload):null;
  if(options.method==='POST'&&url.endsWith('/calendars'))return response(200,{id:user+'-calendar-'+(++next)});
  if(options.method==='GET')return response(404,{});return response(200,body||{});
 };
 const ctx=vm.createContext({Intl,Date,console,PropertiesService:{getUserProperties:()=>({getProperties:()=>Object.fromEntries(state().properties),getProperty:k=>state().properties.get(k)||null,setProperty:(k,v)=>state().properties.set(k,v),deleteProperty:k=>state().properties.delete(k)})},LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},ScriptApp:{getOAuthToken:()=>user,getProjectTriggers:()=>state().triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:n=>({create:()=>{assert.equal(n,5);state().triggers.push({getHandlerFunction:()=>handler});}})})}),deleteTrigger:t=>{state().triggers=state().triggers.filter(v=>v!==t);}},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()]},UrlFetchApp:{fetch,fetchAll:rs=>rs.map(r=>fetch(r.url,r))}});
 vm.runInContext(readFileSync(new URL('../calendar-sync/CalendarSync.gs',import.meta.url),'utf8'),ctx);
 return {api:ctx,events,requests,cache,as:value=>{user=value;},fail:value=>{unavailable=value;}};
}
test('standalone app isolates user properties, calendars, tokens and triggers; retries failed sources safely',()=>{
 const f=fixture();f.events.set('publicBookings/one',{title:'Titulli',date:'2026-11-08',periodIds:['p1'],roomId:'r1'});f.events.set('periods/p1',{start:'14:30',end:'16:00'});f.events.set('rooms/r1',{name:'Salla 128'});
 const a=f.api.connectFacultyActivity({kind:'booking',id:'one'});assert.equal(a.items.length,1);assert.equal(a.automatic,true);
 f.as('bob');assert.equal(f.api.facultyCalendarStatus().items.length,0);f.api.connectFacultyActivity({kind:'booking',id:'one'});assert(f.requests.some(r=>r.user==='bob'&&r.url.includes('bob-calendar')));assert(!f.requests.some(r=>r.user==='bob'&&r.url.includes('alice-calendar')));
 f.as('alice');f.api.connectFacultyActivity({kind:'booking',id:'one'});assert.equal(f.api.facultyCalendarStatus().items.length,1);const before=f.requests.length;f.fail(true);f.cache.clear();const failed=f.api.syncFacultyCalendar();assert(failed.lastError);assert.equal(f.requests.length,before);assert.equal(failed.items.length,1);
 f.fail(false);f.events.delete('publicBookings/one');f.cache.clear();f.api.syncFacultyCalendar();assert.equal(f.api.facultyCalendarStatus().items.length,0);assert.equal(f.api.facultyCalendarStatus().automatic,false);assert.equal(f.requests.at(-1).method,'DELETE');
 f.as('bob');assert.equal(f.api.facultyCalendarStatus().items.length,1);const count=f.requests.length;f.api.stopFacultyCalendar();assert.equal(f.requests.length,count);assert.equal(f.api.facultyCalendarStatus().automatic,false);
});
test('connection requires an explicit user action and both languages preserve safe author text',()=>{
 for(const lang of ['en','sq']){const html=connectionPage({kind:'booking',id:'one'},lang);assert(html.includes('google.script.run'));assert(html.includes("$('add').onclick"));assert(!html.includes("call('connectFacultyActivity');"));assert(html.includes('every five minutes')||html.includes('çdo pesë minuta'));}
 const manifest=JSON.parse(readFileSync(new URL('../calendar-sync/appsscript.json',import.meta.url)));assert.equal(manifest.webapp.executeAs,'USER_ACCESSING');assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar.app.created'));assert(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar'));
});
