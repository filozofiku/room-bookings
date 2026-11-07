// Build from the same official HTML exports shown on the public timetable.
// IDs survive room/time changes; pass --csv FILE to retain original FET IDs too.
import {parseHTML} from 'linkedom';
import {parse} from 'csv-parse/sync';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const classKey=e=>JSON.stringify([e.d,e.start,e.end,e.title,e.tag,e.groups,e.teacher,e.room]);
const identity=e=>JSON.stringify([e.title,e.tag,e.groups,e.teacher]);
const clean=s=>s.normalize('NFC').replace(/\s+/g,' ').trim();
export function parseClasses(html){
 const {document}=parseHTML(html),events=[];
 for(const table of document.querySelectorAll('table[id^="table_"]')){
  const teacher=clean(table.querySelector('caption span.name').textContent);
  const times=[...table.querySelectorAll('thead th.xAxis')].map(e=>e.textContent.trim());
  const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
  const end=minutes(times.at(-1))+minutes(times[1])-minutes(times[0]);times.push(`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`);
  const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelector('th.yAxis'));
  rows.forEach((row,d)=>{let pos=0;for(const cell of [...row.children].filter(c=>c.tagName==='TD')){
   const span=Number(cell.getAttribute('colspan')||1),value=c=>[...cell.querySelectorAll('.'+c)].map(e=>clean(e.textContent)).filter(Boolean).join(' · ');
   if(cell.querySelector('.subject'))events.push({d,start:times[pos],end:times[pos+span],title:value('subject'),tag:value('activitytag'),groups:value('studentsset'),teacher,room:value('room')});pos+=span;
  }if(pos!==times.length-1)throw Error('Incomplete timetable');});
 }
 if(!events.length)throw Error('No classes in official timetable');
 return events.sort((a,b)=>classKey(a).localeCompare(classKey(b)));
}
export function reconcileClasses(events,previous=[],seeds=new Map()){
 const result=[],used=new Set(),assigned=new Map();
 // Match exact events first, then metadata independent of the current room/time.
 for(const signature of [classKey,identity,e=>JSON.stringify([e.title,e.tag,e.groups]),e=>JSON.stringify([e.d,e.start,e.end,e.room])]){
  for(const event of events){if(assigned.has(event))continue;
   const key=signature(event),old=previous.filter(p=>!used.has(p.id)&&signature(p)===key),current=events.filter(e=>!assigned.has(e)&&signature(e)===key);
   if(old.length===1&&current.length===1){assigned.set(event,old[0].id);used.add(old[0].id);}
  }
 }
 for(const event of events){const seed=seeds.get(classKey(event));let id=seed?`class-${seed}`:assigned.get(event);if(!id)id='class-'+createHash('sha256').update(classKey(event)).digest('hex').slice(0,24);
  if(result.some(e=>e.id===id))throw Error('Duplicate class ID');result.push({...event,id,key:classKey(event)});
 }
 return result;
}
export function build(directory,csv){
 const filename=join(directory,'calendar-classes.json'),previous=existsSync(filename)?JSON.parse(readFileSync(filename,'utf8')):{classes:[]};
 const events=parseClasses(readFileSync(join(directory,'WinterF_teachers_days_vertical.html'),'utf8')),seeds=new Map();
 if(csv){const groups=new Map();for(const row of parse(readFileSync(csv,'utf8'),{columns:true,bom:true,skip_empty_lines:true})){const id=row['Activity Id'];if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
  const weekdays=['E hënë','E martë','E mërkurë','E enjte','E premte','E shtunë','E diel'];
  const norm=s=>clean(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  for(const [id,rows] of groups){rows.sort((a,b)=>a.Hour.localeCompare(b.Hour));const first=rows[0];const match=events.filter(e=>norm(e.title)===norm(first.Subject)&&norm(e.teacher)===norm(first.Teachers)&&norm(e.room)===norm(first.Room)&&e.start===first.Hour&&norm(weekdays[e.d])===norm(first.Day));if(match.length===1)seeds.set(classKey(match[0]),id);}
 }
 const classes=reconcileClasses(events,previous.classes,seeds).map(e=>{const old=previous.classes.find(p=>p.id===e.id);return {...e,updatedAt:old?.key===e.key&&old.updatedAt?old.updatedAt:new Date().toISOString()};}),content={semesterStart:'2026-09-15',semesterEnd:'2026-12-31',holidays:['2026-12-25'],classes};
 const body=JSON.stringify(content,null,2)+'\n';writeFileSync(filename,body);console.log(`Calendar catalog: ${classes.length} weekly classes; ${seeds.size} FET identifiers.`);return content;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))build(process.argv[2]||'public-schedule',process.argv[3]);
