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
function fold(line){let out='',bytes=0;for(const char of line){const n=new TextEncoder().encode(char).length;if(bytes+n>75){out+='\r\n ';bytes=1;}out+=char;bytes+=n;}return out;}
export function calendarFile(event){
  const start=calendarInstant(event.date,event.start),end=calendarInstant(event.date,event.end);
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fakulteti Filozofik//Rezervimet//SQ','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${escapeText(event.id)}@filozofiku.github.io`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART:${start}`,`DTEND:${end}`,`SUMMARY:${escapeText(event.title)}`,`LOCATION:${escapeText(event.room||'Pa sallë')}`,`DESCRIPTION:${escapeText([event.description,event.onlineUrl].filter(Boolean).join('\n\n'))}`,'END:VEVENT','END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
export function calendarActions(event){
 const box=document.createElement('details');box.className='calendar-actions';const summary=document.createElement('summary');summary.textContent='Shto në kalendar';box.append(summary);
 const note=document.createElement('p');note.textContent='Kopje personale: ndryshimet dhe anulimet e mëvonshme nuk përditësohen automatikisht. Orët janë sipas zonës Europe/Tirane.';box.append(note);
 const url=new URL('https://calendar.google.com/calendar/render');url.search=new URLSearchParams({action:'TEMPLATE',text:event.title,dates:`${calendarInstant(event.date,event.start)}/${calendarInstant(event.date,event.end)}`,details:[event.description,event.onlineUrl].filter(Boolean).join('\n\n'),location:event.room||'Pa sallë',ctz:'Europe/Tirane'});
 const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Google Calendar';box.append(link,document.createTextNode(' · '));
 const download=document.createElement('button');download.type='button';download.textContent='Shkarko .ics (Outlook / Apple Calendar)';download.onclick=()=>{const blobUrl=URL.createObjectURL(new Blob([calendarFile(event)],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=blobUrl;a.download='rezervimi.ics';a.click();setTimeout(()=>URL.revokeObjectURL(blobUrl),1000);};box.append(download);return box;
}
