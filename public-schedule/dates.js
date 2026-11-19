const zone='Europe/Tirane';
const sqMonths=['janar','shkurt','mars','prill','maj','qershor','korrik','gusht','shtator','tetor','nëntor','dhjetor'];
const sqWeekdays=['E diel','E hënë','E martë','E mërkurë','E enjte','E premte','E shtunë'];
const enWeekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const enMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const monthName=(number,language='sq')=>(String(language).startsWith('en')?enMonths:sqMonths)[number-1];
export function parseDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
export function formatDate(value,language='sq'){
 const date=parseDate(value);if(!date)return value||'—';
 const weekday=(String(language).startsWith('en')?enWeekdays:sqWeekdays)[date.getUTCDay()];
 return `${weekday} · ${date.getUTCDate()} ${monthName(date.getUTCMonth()+1,language)} ${date.getUTCFullYear()}`;
}
export function formatDateTime(value,language='sq',fallback='—'){
 const date=typeof value?.toDate==='function'?value.toDate():typeof value?.seconds==='number'?new Date(value.seconds*1000):value instanceof Date?value:typeof value==='number'||typeof value==='string'?new Date(value):null;
 if(!date||!Number.isFinite(date.getTime()))return fallback;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
 return formatDate(`${parts.year}-${parts.month}-${parts.day}`,language)+` · ${parts.hour}:${parts.minute}`;
}
export function localDate(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
// FET's exported footer uses a US-style numeric date and a local clock.
export function formatTimetableStamp(value,language='sq'){
 const source=String(value||''),match=/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(source);
 let date=/^\d{4}-\d{2}-\d{2}/.test(source)?source.slice(0,10):null;
 if(!date&&match){const first=Number(match[1]),second=Number(match[2]),year=Number(match[3])+(match[3].length===2?2000:0);date=`${year}-${String(first>12?second:first).padStart(2,'0')}-${String(first>12?first:second).padStart(2,'0')}`;}
 if(!parseDate(date))return source;
 const time=/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/i.exec(source);
 let clock='';if(time){let hour=Number(time[1]);if(time[3])hour=hour%12+(time[3].toUpperCase()==='PM'?12:0);clock=` · ${String(hour).padStart(2,'0')}:${time[2]}`;}
 return formatDate(date,language)+clock;
}
