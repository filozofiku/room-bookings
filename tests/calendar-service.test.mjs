import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {reconcileClasses,classKey,parseClasses} from '../public-schedule/build-calendar-classes.mjs';
const source=readFileSync(new URL('../calendar-service/Calendar.gs',import.meta.url),'utf8');
const encode=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,v])=>[k,encode(v)]))}};
function service(){
 const data=new Map(),calls=[];
 const response=(status,body)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(body)});
 const fetch=url=>{calls.push(url);if(url.includes('/calendarDays/')&&!data.has(url))return response(200,{fields:encode({fetActive:true}).mapValue.fields,updateTime:'2026-09-15T00:00:00Z'});if(!data.has(url))return response(404,{});const value=data.get(url);if(value.error)return response(value.error,{});return response(200,value);};
 const ctx=vm.createContext({Intl,Date,URL,console,UrlFetchApp:{fetch,fetchAll:requests=>requests.map(r=>fetch(r.url))},ContentService:{MimeType:{ICAL:'text/calendar'},createTextOutput:body=>({setMimeType:type=>({body,type})})}});
 vm.runInContext(source,ctx);
 const prefix='https://firestore.googleapis.com/v1/projects/filozofiku/databases/(default)/documents/';
 const put=(path,fields,updatedAt='2026-11-08T10:00:00Z')=>data.set(prefix+path,{fields:encode(fields).mapValue.fields,updateTime:updatedAt});
 return {data,calls,put,prefix,get:parameter=>ctx.doGet({parameter})};
}
test('standalone Apps Script serves current single reservations, edits, locations and cancellations',()=>{
 const s=service();s.put('periods/p1',{start:'10:00',end:'10:15'});s.put('periods/p2',{start:'10:15',end:'10:30'});s.put('rooms/r1',{name:'Salla 101'});
 const booking={title:'Titulli, fillestar',date:'2026-11-09',periodIds:['p1','p2'],roomId:'r1',description:'Përshkrim\norigjinal'};
 s.put('publicBookings/id1',booking);const first=s.get({booking:'id1'});assert.equal(first.type,'text/calendar');assert.match(first.body,/UID:id1@filozofiku.github.io/);assert.match(first.body,/DTSTART:20261109T090000Z/);assert.match(first.body,/DTEND:20261109T093000Z/);assert.doesNotMatch(first.body,/RRULE|student|ownerUid/);
 s.put('publicBookings/id1',{...booking,title:'Titull i ndryshuar',date:'2026-11-10',roomId:'',location:'Biblioteka',onlineUrl:'https://example.org/event'},'2026-11-08T11:00:00Z');const changed=s.get({booking:'id1'}).body;assert.match(changed,/UID:id1@filozofiku.github.io/);assert.match(changed,/SUMMARY:Titull i ndryshuar/);assert.match(changed,/LOCATION:Biblioteka/);assert.match(changed,/20261110T090000Z/);assert.match(changed,/https:\/\/example.org\/event/);assert.notEqual(changed.match(/SEQUENCE:(\d+)/)[1],first.body.match(/SEQUENCE:(\d+)/)[1]);
 s.data.delete(s.prefix+'publicBookings/id1');const removed=s.get({booking:'id1'}).body;assert.match(removed,/BEGIN:VCALENDAR/);assert.doesNotMatch(removed,/BEGIN:VEVENT/);
 assert(s.calls.every(url=>/\/(publicBookings|periods|rooms)\//.test(url)));
});
test('weekly classes end inclusively on 31 December, keep local times across DST and exclude holidays',()=>{
 const s=service(),url='https://filozofiku.github.io/calendar-classes.json';
 const event={id:'class-1',d:4,start:'09:45',end:'11:15',title:'Hyrje në Histori',tag:'Ligjërata',teacher:'Enver Hoxhaj',groups:'Histori-1BA',room:'Salla 05',updatedAt:'2026-11-08T10:00:00Z'};
 s.put('calendarDays/2026-11-13',{fetActive:false});s.data.set(url,{semesterStart:'2026-09-15',semesterEnd:'2026-12-31',holidays:['2026-12-25'],classes:[event]});const body=s.get({class:'class-1'}).body;
 assert.match(body,/DTSTART;TZID=Europe\/Tirane:20260918T094500/);assert.match(body,/RRULE:FREQ=WEEKLY;UNTIL=20261231T225959Z/);assert.match(body,/EXDATE;TZID=Europe\/Tirane:20261225T094500/);assert.match(body,/EXDATE;TZID=Europe\/Tirane:20261113T094500/);assert.match(body,/BEGIN:VTIMEZONE/);assert.match(body,/TZOFFSETTO:\+0200/);assert.match(body,/TZOFFSETTO:\+0100/);
 s.data.set(url,{semesterStart:'2026-09-15',semesterEnd:'2026-12-31',classes:[{...event,room:'Salla 201',start:'11:00',end:'12:30'}]});const changed=s.get({class:'class-1'}).body;assert.match(changed,/UID:class-1@/);assert.match(changed,/LOCATION:Salla 201/);assert.match(changed,/DTSTART;TZID=Europe\/Tirane:20260918T110000/);
 s.data.set(url,{classes:[]});assert.doesNotMatch(s.get({class:'class-1'}).body,/BEGIN:VEVENT/);
});
test('source failures do not masquerade as cancellations and parameters cannot access private sources',()=>{
 const s=service();s.data.set(s.prefix+'publicBookings/id1',{error:503});assert.throws(()=>s.get({booking:'id1'}),/unavailable/);assert.throws(()=>s.get({class:'class-1'}),/unavailable/);
 for(const p of [{},{booking:'id1',class:'class-1'},{booking:'../reservations/private'},{class:'https://example.org'},{booking:['id1','id2']}])assert.throws(()=>s.get(p));
 assert(!s.calls.some(url=>url.includes('/reservations/')));
});
test('class identities survive moves and title changes, without merging distinct weekly sessions',()=>{
 const one={d:1,start:'10:00',end:'11:00',title:'Histori',tag:'Ligjërata',groups:'Histori-1BA',teacher:'Arta',room:'Salla 1'},two={...one,d:3};
 const previous=[{...one,id:'class-1'},{...two,id:'class-2'}];
 const moved={...one,d:2,start:'11:00',end:'12:00',room:'Salla 2'};const next=reconcileClasses([moved,two],previous);assert.equal(next[0].id,'class-1');assert.equal(next[1].id,'class-2');
 const renamed={...two,title:'Histori e re'};assert.equal(reconcileClasses([one,renamed],previous)[1].id,'class-2');assert.notEqual(classKey(moved),classKey(one));
});
test('all published classes retain their FET IDs and match the HTML used by the site',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../public-schedule/calendar-classes.json',import.meta.url)));
 assert.equal(catalog.classes.length,380);assert.equal(new Set(catalog.classes.map(e=>e.id)).size,380);assert(catalog.classes.every(e=>/^class-\d+$/.test(e.id)&&e.key===classKey(e)));
});
