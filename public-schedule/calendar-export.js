// Reservations use local wall-clock times in Europe/Tirane, including summer time.
export function calendarInstant(date,time){
  const target=Date.parse(`${date}T${time}:00Z`);let value=target;
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Tirane',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
    const shown=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    value+=target-shown;
  }
  return new Date(value).toISOString().replace(/[-:]/g,'').replace('.000','');
}
const escapeText=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
function fold(line){let out='',bytes=0;for(const char of line){const point=char.codePointAt(0),n=point<128?1:point<2048?2:point<65536?3:4;if(bytes+n>75){out+='\r\n ';bytes=1;}out+=char;bytes+=n;}return out;}
export const SEMESTER_END='2026-12-31';
const stamp=value=>new Date(value||Date.now()).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const wall=(date,time)=>`${date.replaceAll('-','')}T${time.replace(':','')}00`;
// Explicit timezone rules keep weekly classes at the same local time across DST.
const timezone=['BEGIN:VTIMEZONE','TZID:Europe/Tirane','BEGIN:DAYLIGHT','DTSTART:19700329T020000','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU','TZOFFSETFROM:+0100','TZOFFSETTO:+0200','END:DAYLIGHT','BEGIN:STANDARD','DTSTART:19701025T030000','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU','TZOFFSETFROM:+0200','TZOFFSETTO:+0100','END:STANDARD','END:VTIMEZONE'];
export function calendarFile(event){
  const recurring=event.weekly===true;
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fakulteti Filozofik//Rezervimet//SQ','CALSCALE:GREGORIAN','X-WR-TIMEZONE:Europe/Tirane',`X-WR-CALNAME:${escapeText(event.title||'Fakulteti Filozofik')}`,'REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
  if(recurring)lines.push(...timezone);
  if(event.cancelled!==true)lines.push('BEGIN:VEVENT',`UID:${escapeText(event.id)}@filozofiku.github.io`,`DTSTAMP:${stamp(event.updatedAt)}`,`LAST-MODIFIED:${stamp(event.updatedAt)}`,`SEQUENCE:${event.sequence||0}`,
    recurring?`DTSTART;TZID=Europe/Tirane:${wall(event.date,event.start)}`:`DTSTART:${calendarInstant(event.date,event.start)}`,
    recurring?`DTEND;TZID=Europe/Tirane:${wall(event.date,event.end)}`:`DTEND:${calendarInstant(event.date,event.end)}`,
    ...(recurring?[`RRULE:FREQ=WEEKLY;UNTIL=${calendarInstant(event.until||SEMESTER_END,'23:59').replace(/00Z$/,'59Z')}`,...(event.exclusions||[]).map(date=>`EXDATE;TZID=Europe/Tirane:${wall(date,event.start)}`)]:[]),
    `SUMMARY:${escapeText(event.title)}`,`LOCATION:${escapeText(event.room||'Pa sallë')}`,`DESCRIPTION:${escapeText([event.description,event.onlineUrl].filter(Boolean).join('\n\n'))}`,'STATUS:CONFIRMED','END:VEVENT');
  lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
}
let configuration;
async function subscription(event){
  configuration ||= fetch('https://filozofiku.github.io/calendar-config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('configuration');return r.json();}).catch(error=>{configuration=null;throw error;});
  const config=await configuration;
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.endpoint||'')){configuration=null;throw Error('configuration');}
  let id=event.id;
  if(event.weekly){
    const response=await fetch('https://filozofiku.github.io/calendar-classes.json',{cache:'no-store'});if(!response.ok)throw Error('classes');
    const catalog=await response.json();const item=catalog.classes.find(c=>c.key===event.classKey);if(!item)throw Error('class');id=item.id;
  }
  const feed=new URL(config.endpoint);feed.searchParams.set(event.weekly?'class':'booking',id);return feed.href;
}
export function calendarActions(event,t=value=>value){
 const box=document.createElement('details');box.className='calendar-actions';const summary=document.createElement('summary');summary.textContent=t('Shto në kalendar');box.append(summary);
 const note=document.createElement('p');note.textContent=t('Abonimi përditëson ndryshimet dhe anulimet kur Google rifreskon kalendarin; përditësimi nuk është i menjëhershëm. Kopjet e shtuara më parë nuk përditësohen.');box.append(note);
 const link=document.createElement('a');link.target='_blank';link.rel='noopener noreferrer';link.textContent=t('Abonohu në Google Calendar');link.hidden=true;box.append(link);
 const instructions=document.createElement('p');instructions.textContent=t('Duke përgatitur abonimin…');box.append(instructions);
 const address=document.createElement('input');address.type='url';address.readOnly=true;address.hidden=true;address.setAttribute('aria-label',t('Adresa e abonimit në kalendar'));address.style.cssText='width:100%;max-width:100%;box-sizing:border-box';address.onclick=()=>address.select();box.append(address);
 let requested=false;box.addEventListener('toggle',()=>{if(!box.open||requested)return;requested=true;subscription(event).then(feed=>{
   const url=new URL('https://calendar.google.com/calendar/render');url.searchParams.set('cid',feed.replace(/^https:/,'webcal:'));link.href=url.href;link.hidden=false;
   instructions.textContent=t('Nëse lidhja nuk funksionon, në Google Calendar në kompjuter zgjidhni Kalendare të tjera → Nga URL dhe ngjitni këtë adresë.');address.value=feed;address.hidden=false;
 }).catch(()=>{requested=false;instructions.textContent=t('Abonimi nuk është ende i disponueshëm. Provoni përsëri më vonë.');});});
 const copyNote=document.createElement('p');copyNote.textContent=t('Skedari .ics është kopje lokale dhe nuk përditësohet automatikisht.');box.append(copyNote);
 const download=document.createElement('button');download.type='button';download.textContent=t('Shkarko .ics (Outlook / Apple Calendar)');download.onclick=()=>{const blobUrl=URL.createObjectURL(new Blob([calendarFile(event)],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=blobUrl;a.download=t('rezervimi.ics');a.click();setTimeout(()=>URL.revokeObjectURL(blobUrl),1000);};box.append(download);return box;
}
