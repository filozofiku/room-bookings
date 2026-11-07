import {calendarFile} from '../src/calendar-export.js';
// Only public Firestore documents are fetched, without authentication or secrets.
const DOCUMENTS='https://firestore.googleapis.com/v1/projects/filozofiku/databases/(default)/documents/';
const CATALOG='https://filozofiku.github.io/calendar-classes.json';
function decode(value){
 if('stringValue'in value)return value.stringValue;if('integerValue'in value)return Number(value.integerValue);if('booleanValue'in value)return value.booleanValue;if('timestampValue'in value)return value.timestampValue;
 if('arrayValue'in value)return(value.arrayValue.values||[]).map(decode);if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decode(v)]));return null;
}
function read(url,missing=false){
 const response=UrlFetchApp.fetch(url,{muteHttpExceptions:true}),status=response.getResponseCode();
 if(missing&&status===404)return null;
 if(status!==200)throw Error('Calendar source unavailable. Try again later.');
 return JSON.parse(response.getContentText());
}
function document(path,missing=false){const raw=read(DOCUMENTS+path,missing);return raw?{...decode({mapValue:{fields:raw.fields}}),updatedAt:raw.updateTime}:null;}
export function eventFor(parameters){
 const booking=parameters.booking,cls=parameters.class;
 if(Boolean(booking)===Boolean(cls))throw Error('Specify exactly one booking or class.');
 const id=booking||cls;if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(id))throw Error('Invalid calendar identifier.');
 if(booking){
  const data=document('publicBookings/'+encodeURIComponent(id),true);
  if(!data)return{id,cancelled:true}; // Empty subscribed feed removes a deleted reservation.
  const responses=UrlFetchApp.fetchAll(data.periodIds.map(id=>({url:DOCUMENTS+'periods/'+encodeURIComponent(id),muteHttpExceptions:true})));
  const periods=responses.map(response=>{if(response.getResponseCode()!==200)throw Error('Calendar periods unavailable.');const raw=JSON.parse(response.getContentText());return decode({mapValue:{fields:raw.fields}});}).sort((a,b)=>a.start.localeCompare(b.start));
  if(!periods.length||periods.some((p,i)=>i&&periods[i-1].end!==p.start))throw Error('Invalid booking periods.');
  const room=data.roomId?document('rooms/'+encodeURIComponent(data.roomId)).name:data.location||'Pa sallë';
  return{id,title:data.title,date:data.date,start:periods[0].start,end:periods.at(-1).end,room,description:data.description,onlineUrl:data.onlineUrl,updatedAt:data.updatedAt,sequence:Math.floor(Date.parse(data.updatedAt)/1000)};
 }
 const catalog=read(CATALOG),event=catalog.classes.find(e=>e.id===id);
 if(!event)return{id,cancelled:true};
 const first=new Date(catalog.semesterStart+'T12:00:00Z');while((first.getUTCDay()+6)%7!==event.d)first.setUTCDate(first.getUTCDate()+1);
 const dates=[];for(let date=new Date(first);date.toISOString().slice(0,10)<=catalog.semesterEnd;date.setUTCDate(date.getUTCDate()+7))dates.push(date.toISOString().slice(0,10));
 const days=UrlFetchApp.fetchAll(dates.map(date=>({url:DOCUMENTS+'calendarDays/'+date,muteHttpExceptions:true})));
 const exclusions=new Set(catalog.holidays||[]);let updatedAt=event.updatedAt;
 days.forEach((response,index)=>{
  if(response.getResponseCode()!==200)throw Error('Calendar dates unavailable. Try again later.');
  const raw=JSON.parse(response.getContentText()),day=decode({mapValue:{fields:raw.fields}});
  if(day.fetActive===false)exclusions.add(dates[index]);
  if(raw.updateTime>updatedAt)updatedAt=raw.updateTime;
 });
 return{...event,date:first.toISOString().slice(0,10),weekly:true,until:catalog.semesterEnd,exclusions:[...exclusions].sort(),description:[event.tag,event.groups,event.teacher].filter(Boolean).join('\n\n'),updatedAt,sequence:Math.floor(Date.parse(updatedAt)/1000)};
}
export function serve(request){
 // Do not cache failures or return an empty calendar on transient source errors.
 // Throwing makes Google retain the previous events and retry later.
 const event=eventFor(request?.parameter||{});
 return ContentService.createTextOutput(calendarFile(event)).setMimeType(ContentService.MimeType.ICAL);
}
