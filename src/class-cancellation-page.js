import {collection,doc,getDocs,query,where,onSnapshot} from 'firebase/firestore';
import {setClassCancelled} from './class-cancellations.js';
import {formatDate,localDate} from '../public-schedule/dates.js';
import {weekDates} from '../public-schedule/booking-model.js';
import {inlineCalendar} from '../public-schedule/date-picker.js';
import {errorText} from './booking-ui.js';

export function createClassCancellationPage(db,user,profile,settings,bt,getLanguage){
 const $=id=>document.getElementById(id);
 let lessons=[],days=new Map(),stops=[],disposed=false,generation=0,busy=false,confirmation=null,weekError='';
 const input=$('class-week'),list=$('class-list'),feedback=$('class-feedback');
 input.min=settings.startDate;input.max=settings.endDate;
 input.value=[settings.startDate,localDate(),settings.endDate].sort()[1];
 const calendar=inlineCalendar(input,{language:getLanguage});
 const writeMessage=(text,error=false)=>{feedback.textContent=bt(text);feedback.className=error?'error':'ok';};
 function render(){
  if(disposed)return;
  calendar.render();list.replaceChildren();
  const dates=weekDates(input.value);
  $('class-week-range').textContent=`${formatDate(dates[0],getLanguage())} – ${formatDate(dates[6],getLanguage())}`;
  $('class-previous').disabled=dates[0]<=settings.startDate;
  $('class-next').disabled=dates[6]>=settings.endDate;
  if(!profile.teacherIds?.length){list.textContent=bt('Llogaria juaj nuk ka mësim të rregullt të lidhur. Nëse kjo nuk është e saktë, kontaktoni administratorin.');return;}
  if(weekError){list.textContent=bt(weekError);return;}
  if(dates.some(date=>date>=settings.startDate&&date<=settings.endDate&&!days.has(date))){list.textContent=bt('Duke ngarkuar…');return;}
  let count=0;
  for(const date of dates){
   const day=days.get(date);if(!day?.fetActive)continue;
   const selected=lessons.filter(lesson=>lesson.weekday===String(day.weekday)).sort((a,b)=>a.publicInfo.start.localeCompare(b.publicInfo.start));
   if(!selected.length)continue;
   const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=formatDate(date,getLanguage());section.append(heading);
   for(const lesson of selected){
    count++;const cancelled=Boolean(day.cancelledClasses?.[lesson.id]),info=lesson.publicInfo;
    const card=document.createElement('article');card.className='regular-class-card'+(cancelled?' cancelled-class':'');card.dataset.classId=lesson.id;card.dataset.date=date;
    const title=document.createElement('h4');title.textContent=info.subject;
    const details=document.createElement('p');details.textContent=`${info.start}–${info.end} · ${info.room||bt('Pa sallë')}`;
    const groups=document.createElement('p');groups.textContent=info.groups.map(name=>name.replace(/\s+Automatic (?:Group )?Automatic Subgroup$/i,'').replace(/\s+Automatic Subgroup$/i,'')).join(', ');
    const status=document.createElement('strong');status.className='class-status';status.textContent=bt(cancelled?'Anuluar':'Mësim i planifikuar');
    const button=document.createElement('button');button.type='button';button.className=cancelled?'secondary':'danger';button.textContent=bt(cancelled?'Riktheni mësimin':'Anuloni mësimin');button.disabled=busy||!settings.bookingOpen;
    button.onclick=()=>{
     confirmation={lesson,date,cancelled:!cancelled};renderConfirmation();$('class-change-dialog').showModal();
    };
    card.append(title,details,groups,status,button);section.append(card);
   }list.append(section);
  }
  if(!count)list.textContent=bt('Këtë javë nuk keni mësim të planifikuar.');
 }
 function renderConfirmation(){
  if(!confirmation)return;
  const {lesson,date,cancelled}=confirmation;
  $('class-change-heading').textContent=bt(cancelled?'Konfirmoni anulimin e mësimit':'Konfirmoni rikthimin e mësimit');
  $('class-change-summary').textContent=`${lesson.publicInfo.subject}\n${formatDate(date,getLanguage())} · ${lesson.publicInfo.start}–${lesson.publicInfo.end}\n${lesson.publicInfo.room||bt('Pa sallë')}`;
  $('class-change-note').textContent=bt(cancelled?'Anulohet vetëm kjo datë. Ora mbetet e dukshme në orar dhe burimet lirohen.':'Mësimi rikthehet vetëm nëse salla, grupet dhe mësimdhënësi janë ende të lirë.');
  $('class-confirm-change').textContent=bt(cancelled?'Anuloni mësimin':'Riktheni mësimin');
 }
 async function selectWeek(){
  const current=++generation;stops.forEach(stop=>stop());stops=[];days.clear();weekError='';render();
  for(const date of weekDates(input.value).filter(date=>date>=settings.startDate&&date<=settings.endDate)){
   stops.push(onSnapshot(doc(db,'calendarDays',date),{includeMetadataChanges:true},snap=>{
    if(disposed||current!==generation)return;
    if(snap.metadata.fromCache){days.delete(date);render();return;}
    days.set(date,snap.exists()?snap.data():null);render();
   },()=>{if(disposed||current!==generation)return;weekError='Të dhënat nuk u ngarkuan. Provoni rifreskimin.';render();}));
  }
 }
 const move=offset=>{const next=new Date(weekDates(input.value)[0]+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+offset*7);input.value=[settings.startDate,next.toISOString().slice(0,10),settings.endDate].sort()[1];selectWeek();};
 input.onchange=selectWeek;$('class-previous').onclick=()=>move(-1);$('class-next').onclick=()=>move(1);$('class-refresh').onclick=()=>load();
 $('class-change-form').onsubmit=async event=>{
  event.preventDefault();if(event.submitter?.value!=='confirm'){confirmation=null;$('class-change-dialog').close();return;}
  const action=confirmation;confirmation=null;$('class-change-dialog').close();if(!action||busy)return;
  busy=true;writeMessage('Duke ruajtur…');render();
  try{await setClassCancelled(db,action.lesson.id,action.date,action.cancelled,user);if(!disposed)writeMessage(action.cancelled?'Mësimi u anulua për datën e zgjedhur.':'Mësimi u rikthye për datën e zgjedhur.');}
  catch(error){if(!disposed)writeMessage(errorText(error),true);}
  finally{busy=false;render();}
 };
 async function load(){
  if(disposed)return;writeMessage('');list.textContent=bt('Duke ngarkuar…');
  try{
   const ids=[...new Set(profile.teacherIds||[])];
   const snapshots=await Promise.all(ids.map(id=>getDocs(query(collection(db,'regularClasses'),where('teacherIds','array-contains',id)))));
   if(disposed)return;
   lessons=[...new Map(snapshots.flatMap(s=>s.docs).map(doc=>[doc.id,{id:doc.id,...doc.data()}])).values()];
   if(!settings.bookingOpen)writeMessage('Rezervimet janë pezulluar.',true);
   await selectWeek();
  }catch(error){if(!disposed)writeMessage(errorText(error),true);}
 }
 return {load,render(){render();renderConfirmation();feedback.textContent=bt(feedback.textContent);},dispose(){disposed=true;generation++;stops.forEach(stop=>stop());calendar.destroy();confirmation=null;if($('class-change-dialog').open)$('class-change-dialog').close();list.replaceChildren();}};
}
