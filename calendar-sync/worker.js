import {eventFor} from '../calendar-service/worker.js';
import {selection,selectionKey,synchronize} from './core.js';
import {connectionPage} from './page.js';
const PREFIX='activity:',CALENDAR='facultyCalendarId',HANDLER='syncFacultyCalendar';
const props=()=>PropertiesService.getUserProperties();
const digest=text=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>(b+256)%256).map(b=>b.toString(16).padStart(2,'0')).join('');
function api(path,method='GET',body,allowed=[]){
 const response=UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3'+path,{method,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},contentType:'application/json',...(body?{payload:JSON.stringify(body)}:{}),muteHttpExceptions:true}),status=response.getResponseCode();
 if(allowed.includes(status))return null;
 if(status<200||status>=300)throw Object.assign(Error(`Google Calendar request failed (${status}). Check the Calendar API and account authorization, then retry.`),{status});
 return response.getContentText()?JSON.parse(response.getContentText()):null;
}
const items=()=>Object.entries(props().getProperties()).filter(([key])=>key.startsWith(PREFIX)).map(([,value])=>JSON.parse(value));
function sourceEvent(item){const cache=CacheService.getScriptCache(),key='public:'+selectionKey(item),cached=cache.get(key);if(cached)return JSON.parse(cached);const event=eventFor({[item.kind]:item.id});cache.put(key,JSON.stringify(event),60);return event;}
const save=item=>props().setProperty(PREFIX+selectionKey(item),JSON.stringify(item));
function locked(callback){const lock=LockService.getUserLock();if(!lock.tryLock(1000))throw Error('A synchronization is already running. Please try again shortly.');try{return callback();}finally{lock.releaseLock();}}
function ensureTrigger(){if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===HANDLER))ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(5).create();}
function removeTrigger(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===HANDLER).forEach(t=>ScriptApp.deleteTrigger(t));}
function syncItem(item,event){
 const result=synchronize({item,event:event||sourceEvent(item),calendarId:props().getProperty(CALENDAR),api,digest,save});
 if(result.removed)props().deleteProperty(PREFIX+selectionKey(item));return result;
}
export function status(){return {connected:!!props().getProperty(CALENDAR),items:items().map(({kind,id,title})=>({kind,id,title})),lastSync:props().getProperty('lastSync'),lastError:props().getProperty('lastError'),automatic:ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===HANDLER)};}
export function connect(value){return locked(()=>{
 const selected=selection(value),list=items(),key=selectionKey(selected),old=list.find(e=>selectionKey(e)===key);
 if(!old&&list.length>=50)throw Error('You can connect up to 50 activities. Remove an activity before adding another.');
 const event=eventFor({[selected.kind]:selected.id});if(event.cancelled)throw Error('This activity has been cancelled or removed.');
 let calendarId=props().getProperty(CALENDAR);
 if(!calendarId){const created=api('/calendars','POST',{summary:'Fakulteti Filozofik · Orari',timeZone:'Europe/Tirane',description:'Selected faculty activities. Automatically checked every five minutes.'});calendarId=created.id;props().setProperty(CALENDAR,calendarId);}
 ensureTrigger();save(old||{...selected,title:event.title});syncItem(old||selected,event);props().setProperty('lastSync',new Date().toISOString());props().deleteProperty('lastError');return status();
});}
export function sync(){return locked(()=>{
 if(!props().getProperty(CALENDAR))return status();
 const list=items();let failures=0;const start=Date.now();
 // Start at a rotating cursor so a slow source never starves later selections.
 const cursor=Number(props().getProperty('cursor')||0)%Math.max(1,list.length);let count=0;
 for(;count<list.length&&Date.now()-start<240000;count++)try{syncItem(list[(cursor+count)%list.length]);}catch(error){failures++;}
 props().setProperty('cursor',String((cursor+count)%Math.max(1,list.length)));
 if(failures||count<list.length)props().setProperty('lastError','Some activities could not be refreshed. They will be retried on the next check.');else props().deleteProperty('lastError');
 props().setProperty('lastSync',new Date().toISOString());if(!items().length)removeTrigger();return status();
});}
export function remove(value){return locked(()=>{
 const selected=selection(value),found=items().find(e=>selectionKey(e)===selectionKey(selected));
 if(found){syncItem(found,{cancelled:true});if(!items().length)removeTrigger();}return status();
});}
export function stop(){return locked(()=>{removeTrigger();for(const item of items())props().deleteProperty(PREFIX+selectionKey(item));return status();});}
export function page(request){
 let selected=null;try{const p=request?.parameter||{};if(p.booking||p.class)selected=selection({kind:p.booking?'booking':'class',id:p.booking||p.class});}catch{throw Error('Invalid activity link.');}
 return HtmlService.createHtmlOutput(connectionPage(selected,request?.parameter?.lang==='en'?'en':'sq')).setTitle('Fakulteti Filozofik · Google Calendar');
}
