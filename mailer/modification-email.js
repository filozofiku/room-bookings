import {emailDate} from './email-format.js';
import {reservationTime} from '../src/booking-ui.js';
export function modificationEmail(work,periods,rooms,catalog){
 const fields=b=>[
  ['Titulli',b.title],['Data',emailDate(b.date)],['Ora',reservationTime(b.periodIds,periods)],
  ['Lokacioni',b.location||''],
  ['Salla',b.roomId?(rooms.find(r=>r.id===b.roomId)?.name||b.roomId):''],
  ['Grupet e studentëve',(b.groupIds||[]).map(id=>catalog.groups?.[id]||id).join(', ')],
  ['Mësimdhënësit',(b.teacherIds||[]).map(id=>catalog.teachers?.[id]||id).join(', ')],
  ['Lloji i aktivitetit',b.eventType||'Rezervim'],['Njoftimi',b.isPublic?'Publik':'Jo publik'],
  ['Mënyra e zhvillimit',b.mode==='online'?'Online':'Fizik'],['Linku i ngjarjes online',b.onlineUrl||'—']
 ];
 const before=fields(work.before),after=fields(work.booking);
 const changes=after.flatMap(([label,value],i)=>value===before[i][1]?[]:!value?[`${label}: përzgjedhja e mëparshme u hoq.`,'']:[`${label}:`,...(before[i][1]?[`Më parë: ${before[i][1]}`]:[]),`Tani: ${value}`,'']);
 const descriptionSections=[...(work.before.description!==work.booking.description && work.before.description?[{label:'Përshkrimi i mëparshëm:',text:work.before.description}]:[]),...(work.booking.description?[{label:'Përshkrimi:',text:work.booking.description}]:[])];
 return {descriptionSections,subject:'Njoftim për ndryshimin e rezervimit',text:[
  'Përshëndetje,','',`Rezervimi juaj është ndryshuar nga ${work.modifierName||'administratori'}.`,'',
  'Ndryshimet:',...changes,'Të dhënat pas ndryshimit:',...after.filter(([,value])=>value).map(([label,value])=>`${label}: ${value}`),'',
  ...(work.before.description!==work.booking.description?['Përshkrimi i aktivitetit u ndryshua.','']:[]),
  ...descriptionSections.flatMap(s=>[s.label,s.text,'']),
  'Orari: https://filozofiku.github.io/#orari/reservations/te-gjitha','',
  'Fakulteti Filozofik','Universiteti i Prishtinës','',
  'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
 ].join('\n')};
}
