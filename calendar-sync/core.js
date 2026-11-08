import {calendarInstant} from '../src/calendar-export.js';
export function selection(value){
 if(!value||!['booking','class'].includes(value.kind)||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(value.id))throw Error('Invalid activity.');
 return {kind:value.kind,id:value.id};
}
export const selectionKey=value=>`${value.kind}:${value.id}`;
export function googleEvent(event){
 const body={status:'confirmed',summary:event.title,description:[event.description,event.onlineUrl].filter(Boolean).join('\n\n'),location:event.room||'Pa sallë',start:{dateTime:`${event.date}T${event.start}:00`,timeZone:'Europe/Tirane'},end:{dateTime:`${event.date}T${event.end}:00`,timeZone:'Europe/Tirane'},extendedProperties:{private:{facultyActivity:event.id}}};
 if(event.weekly)body.recurrence=[`RRULE:FREQ=WEEKLY;UNTIL=${calendarInstant(event.until,'23:59').replace(/00Z$/,'59Z')}`,...(event.exclusions||[]).map(date=>`EXDATE;TZID=Europe/Tirane:${date.replaceAll('-','')}T${event.start.replace(':','')}00`)];
 else body.recurrence=[]; // Clear an old recurrence if the source ever changes kind.
 return body;
}
// Dependencies are explicit so retries, cancellations and privacy can be tested
// without any real Google account, calendar, trigger or reservation writes.
export function synchronize({item,event,calendarId,api,digest,save}){
 const path=`/calendars/${encodeURIComponent(calendarId)}/events`,id=digest(selectionKey(item)),target=path+'/'+id;
 if(event.cancelled){api(target,'DELETE',undefined,[404,410]);return {removed:true};}
 const body=googleEvent(event),hash=digest(JSON.stringify(body));
 if(item.hash===hash)return {unchanged:true};
 const existing=api(target,'GET',undefined,[404,410]);
 if(existing&&existing.status!=='cancelled')api(target,'PATCH',body);
 else{try{api(path,'POST',{id,...body});}catch(error){if(error.status!==409)throw error;api(target,'PATCH',body);}}
 save({...item,hash,title:event.title});return {updated:true};
}
