import {reservationTime} from '../src/booking-ui.js';
export function modificationEmail(work,periods,rooms,catalog){
 const fields=b=>[
  ['Titulli',b.title],['Data',b.date],['Ora',reservationTime(b.periodIds,periods)],
  ['Salla',rooms.find(r=>r.id===b.roomId)?.name||b.roomId||'Pa sallë'],
  ['Grupet e studentëve',(b.groupIds||[]).map(id=>catalog.groups?.[id]||id).join(', ')||'Pa grup të studentëve'],
  ['Mësimdhënësit',(b.teacherIds||[]).map(id=>catalog.teachers?.[id]||id).join(', ')||'Pa mësimdhënës'],
  ['Lloji i aktivitetit',b.eventType||'Rezervim'],['Njoftimi',b.isPublic?'Publik':'Jo publik'],
  ['Mënyra e zhvillimit',b.mode==='online'?'Online':'Fizik'],['Linku online',b.onlineUrl||'—'],['Përshkrimi',b.description||'—']
 ];
 const before=fields(work.before),after=fields(work.booking);
 const changes=after.flatMap(([label,value],i)=>value===before[i][1]?[]:[`${label}:`, `Më parë: ${before[i][1]}`,`Tani: ${value}`,'']);
 return {subject:'Njoftim për ndryshimin e rezervimit',text:[
  'Përshëndetje,','',`Rezervimi juaj është ndryshuar nga ${work.modifierName||'administratori'}.`,'',
  'Ndryshimet:',...changes,'Të dhënat pas ndryshimit:',...after.map(([label,value])=>`${label}: ${value}`),'',
  'Orari: https://filozofiku.github.io/#orari/reservations/te-gjitha','',
  'Fakulteti Filozofik','Universiteti i Prishtinës','',
  'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
 ].join('\n')};
}
