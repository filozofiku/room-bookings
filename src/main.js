import {bt,getLanguage,locale,initLanguage,displayRoom,displayGroup} from './booking-i18n.js';
const requestedSection=new URLSearchParams(location.search).get('section');
const managementView=['my-reservations','requests'].includes(requestedSection);
const reportsView=requestedSection==='reports';
const classesView=requestedSection==='class-cancellations';
import {isReplacement,requiresPrivateVisibility,timetableCourses,coursesForGroups,validReplacementDate} from './replacement-courses.js';
import {recordActivity} from './activity-events.js';
import {parseStudentEmails} from './student-emails.js';
import {loadEmailDeliveries,deliveryLabel,retryEmail} from './email-delivery.js';
import {calendarActions,calendarInstant} from './calendar-export.js';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp } from 'firebase/firestore';
import { BookingError, selectPeriods, reservationTime, errorText, MAX_PERIODS } from './booking-ui.js';
import { EVENT_TYPES, slotKeys, conflictMessage, wordCount, publicDescriptionError } from './booking-resources.js';
import {updateReservation} from './update-reservation.js';
import {isSpecialRoom,submitReservationRequest,decideReservationRequest,submitReservationEditRequest,decideReservationEditRequest,needsReapproval} from './reservation-requests.js';
import { auth, db } from './firebase.js';
import {formatDate,formatDateTime} from '../public-schedule/dates.js';
import {inlineCalendar} from '../public-schedule/date-picker.js';
import {bookingText} from '../public-schedule/booking-model.js';
import {hasStaffAccess,setStaffNavigation} from '../public-schedule/staff-navigation.js';

const $ = (id) => document.getElementById(id);
const dateCalendar=inlineCalendar($('date'),{language:getLanguage});
const displayDate=value=>formatDate(value,getLanguage());
const provider = new GoogleAuthProvider();
auth.languageCode = getLanguage();
provider.setCustomParameters({hl:getLanguage(),prompt:'select_account'});
let currentUser = null;
let canCancelAll = false;
let requiresApproval = false;
let reportsController=null;
let classesController=null;
let authenticationGeneration=0;
let staffAccessState='checking';
let rooms = [];
let periods = [];
let settings = null;
let catalog = null;
let courses = [];
let occupied = new Map();
let editing = null;
let confirmationData=null,decisionPreviewData=null,cancellationPreviewData=null,lastReceipt=null;
const errText = error=>bt(errorText(error));
const localizedText=data=>bookingText(data,getLanguage());
function message(text, isError = false) {
  $('message').textContent = bt(text);
  $('message').className = isError ? 'error' : 'ok';
}
function setStaffAccess(state) {
  staffAccessState=state;
  const authorized=state==='authorized';
  setStaffNavigation(authorized,currentUser?.email||'');
  $('staff-access').hidden=authorized;
  $('booking-help-panel').hidden=!authorized||managementView||reportsView||classesView;
  $('login').hidden=Boolean(currentUser);
  $('login').disabled=state==='checking';
  $('switch-account').hidden=!currentUser||authorized;
  $('retry-access').hidden=state!=='unavailable';
  $('staff-access-identity').hidden=!currentUser||authorized;
  $('staff-access-identity').textContent=currentUser?.email||'';
  const status={
    checking:'Duke kontrolluar qasjen…',
    signedout:'Hyni me llogarinë tuaj institucionale për të vazhduar.',
    denied:'Rezervimet janë të disponueshme vetëm për stafin akademik të autorizuar. Kjo llogari nuk ka qasje. Përdorni llogarinë tuaj @uni-pr.edu; nëse jeni pjesë e stafit dhe qasja mungon, kontaktoni administratorin për miratimin e saj.',
    unavailable:'Qasja nuk mund të verifikohej. Kontrolloni lidhjen dhe provoni përsëri.'
  };
  $('staff-access-status').textContent=bt(status[state]||'');
  const entry=document.querySelector('a[data-staff-entry]');
  if(authorized)entry.removeAttribute('aria-current');
  else entry.setAttribute('aria-current','page');
}
function selectedPeriodIds() {
  return selectPeriods(periods, $('from').value, $('through').value);
}
function prepareReservation(period) {
  $('booking-section').open=true;
  const minutes = time => {
    const [hours, mins] = time.split(':').map(Number);
    return hours * 60 + mins;
  };
  const from = periods.findIndex(p => p.id === period.id);
  const target = minutes(period.start) + 90;
  const candidates = periods.slice(from, from + MAX_PERIODS);
  const through = candidates.filter(p => minutes(p.end) <= target).at(-1) || period;
  $('from').value = period.id;
  $('through').value = through.id;
  $('selection-hint').textContent = minutes(through.end) === target ? '' :
    bt("Ora e përfundimit u vendos në {v0}, sipas periudhave të orarit. Mund ta ndryshoni para rezervimit.",{v0:through.end});
  $('booking-form').scrollIntoView({behavior:'smooth', block:'start'});
  $(isReplacement($('event-type').value)?'replacement-course':'title').focus({preventScroll:true});
}
function renderConfirmation(data) {
  const dialog = $('reservation-dialog');
  const requestOnly=requiresApproval||!canCancelAll&&(editing?needsReapproval(editing.data,data):isSpecialRoom(data.roomId));
  $('reservation-heading').textContent=editing?bt('Konfirmoni ndryshimet'):requestOnly?bt('Konfirmoni kërkesën për rezervim'):bt('Konfirmoni rezervimin');
  dialog.querySelector('[value=confirm]').textContent=editing?bt('Konfirmo ndryshimet'):requestOnly?bt('Dërgo kërkesën'):bt('Konfirmo rezervimin');
  const summary = $('reservation-summary');
  summary.replaceChildren();
  const fields = [
    [bt('Titulli'),localizedText(data).title], [bt('Lloji i aktivitetit'),bt(data.eventType)],
    [bt('Data'),displayDate(data.date)], [bt('Ora'),reservationTime(data.periodIds,periods)],
    [bt('Salla'),displayRoom(rooms.find(room=>room.id===data.roomId)?.name || bt('Pa sallë'))],
    [bt('Grupet e studentëve'),data.groupIds.map(id=>displayGroup(catalog.groups[id] || id)).join(', ') || bt('Pa grup të studentëve')],
    [bt('Mësimdhënësit'),data.teacherIds.map(id=>catalog.teachers[id] || id).join(', ') || bt('Pa mësimdhënës')],
    [bt('Njoftimi për aktivitetin'),data.isPublic ? bt('Publik — përmbledhje javore çdo të hënë në 08:00') : bt('Jo publik')],
    [bt('Mënyra e zhvillimit'),data.mode==='online' ? bt('Online') : bt('Fizik')],
    [bt('Rezervuar nga'),data.creatorName]
  ];
  if(data.replacementDate)fields.push([bt('Data e mësimit që zëvendësohet'),displayDate(data.replacementDate)]);
  if(requestOnly)fields.push([bt('Miratimi'),bt(editing?'Kërkesa për ndryshim u dërgua për miratim. Rezervimi ekzistues mbetet në fuqi.':requiresApproval?'Kërkesa shfaqet në orar vetëm pas miratimit nga një përdorues me autorizim.':'Kërkesa nuk rezervon sallën. Rezervimi dhe njoftimet publike bëhen vetëm pas miratimit.')]);
  if(data.location)fields.push([bt('Lokacioni'),data.location]);
  if(data.onlineUrl)fields.push([bt('Linku i ngjarjes online'),data.onlineUrl]);
  if(data.studentEmails?.length)fields.push([bt('Studentë për njoftim'),data.studentEmails.join('; ')]);
  if(localizedText(data).description)fields.push([bt('Përshkrimi'),localizedText(data).description]);
  for(const [label,value] of fields){
    const term=document.createElement('dt'),detail=document.createElement('dd');
    term.textContent=bt(label);term.style.fontWeight='600';
    detail.textContent=value;detail.style.margin='0 0 .75rem';
    summary.append(term,detail);
  }
}
function confirmReservation(data){
  confirmationData=data;renderConfirmation(data);
  const dialog=$('reservation-dialog');
  dialog.returnValue='back';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});
    dialog.showModal();
  });
}
function confirmCancellation(data) {
  cancellationPreviewData=data;
  const dialog = $('cancel-dialog');
  $('cancel-question').textContent = bt("Ta anuloni rezervimin \"{v0}\" më {v1}?",{v0:localizedText(data).title,v1:displayDate(data.date)});
  const otherOwner = data.ownerUid !== currentUser.uid;
  $('cancel-reason-field').hidden = !otherOwner;
  $('cancel-reason').required = otherOwner;
  $('cancel-reason').value = '';
  $('cancel-error').textContent = '';
  dialog.returnValue = 'keep';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve({confirmed:dialog.returnValue === 'cancel',reason:otherOwner ? $('cancel-reason').value.trim() : ''}), {once:true});
    dialog.showModal();
  });
}
function safeText(value) { return document.createTextNode(String(value)); }
function fillOptions(element, values, getValue, getLabel) {
  element.replaceChildren();
  for (const v of values) {
    const option = document.createElement('option');
    option.value = getValue(v);
    option.dataset.sourceLabel=getLabel(v);
    option.textContent = displayRoom(bt(getLabel(v)));
    element.appendChild(option);
  }
}
async function readAvailability() {
  dateCalendar.render();
  if (!currentUser || !rooms.length) return;
  updateRequestHint();
  updateLocationField();
  const date = $('date').value;
  const roomId = $('room').value;
  if (!date) return;
  if (!roomId) { $('slots').textContent = bt('Pa sallë të përzgjedhur.'); return; }
  const daySnap = await getDoc(doc(db,'calendarDays',date));
  if (!daySnap.exists()) throw new BookingError(bt('Data nuk është konfiguruar. Kontaktoni administratorin për importimin e semestrit.'));
  const day = daySnap.data();
  const booked = await getDoc(doc(db,'eventDays',date));
  const locks = booked.exists() ? booked.data().bookings : {};
  const weeklySnap = day.fetActive ? await getDoc(doc(db,'weeklyResources',String(day.weekday))) : null;
  const weeklyData = weeklySnap?.exists() ? weeklySnap.data() : null;
  occupied = new Map(periods.map((p,i) => [p.id,
    !day.bookingAllowed ? {source:'closed'} :
    locks[`${roomId}__${p.id}`] ? {source:'booking'} :
    day.fetActive && weeklyData?.busyKeys?.includes(`${roomId}__${p.id}`) && !(day.releasedKeys||[]).includes(`${roomId}__${p.id}`) ?
      {source:'fet', ...(weeklyData.activities?.[p.id] || {})} : null
  ]));
  $('slots').replaceChildren();
  periods.forEach(p => {
    const item = document.createElement('div');
    item.className = 'slot';
    const time = document.createElement('time');
    time.textContent = p.label;
    const busy = occupied.get(p.id);
    const state = document.createElement('span');
    state.className = busy ? 'busy' : 'free';
    state.textContent = busy ? (busy.source === 'closed' ? bt('Data është e mbyllur') : busy.source === 'fet' ? bt('Mësim sipas orarit') : bt('E rezervuar')) : bt('Salla e lirë');
    item.append(time, state);
    if (!busy) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reserve-from';
      button.textContent = bt('Rezervo nga kjo orë');
      button.setAttribute('aria-label', bt("Rezervo nga kjo orë: {v0}",{v0:p.start}));
      button.onclick = () => prepareReservation(p);
      item.appendChild(button);
    }
    $('slots').appendChild(item);
  });
}
function stopEditing() {
  $('reservation-entry').hidden=managementView;
  editing=null;
  $('student-emails-field').hidden=false;
  $('student-emails').value='';
  $('edit-banner').hidden=true;
  $('booking-heading').textContent=bt('Rezervoni një aktivitet');
  $('booking-form').querySelector('button').textContent=bt('Bëni rezervimin');
  $('title').value='';
  $('replacement-course').value='';$('replacement-date').value='';
  $('title-en').value='';$('description-en').value='';$('english-fields').open=false;$('description-en').oninput();
  $('booking-message').textContent='';
  updateRequestHint();
}
async function startEditing(id,data) {
  const user=currentUser;
  let studentEmails=data.studentEmails;
  try{
   if(!studentEmails)studentEmails=(await getDoc(doc(db,'studentNotifications',id))).data()?.recipients||[];
  }catch(e){message(errText(e),true);return;}
  if(currentUser?.uid!==user?.uid)return;
  data={...data,studentEmails};
  $('reservation-entry').hidden=false;
  $('booking-section').open=true;
  $('booking-receipt').hidden=true;
  editing={id,data,revision:data.revision||0};
  $('student-emails-field').hidden=false;
  $('student-emails').value=studentEmails.join('\n');
  $('date').value=data.date;$('room').value=data.roomId;
  $('title-en').value=data.titleEn||'';$('description-en').value=data.descriptionEn||'';
  $('english-fields').open=Boolean(data.titleEn||data.descriptionEn);$('description-en').oninput();
  $('title').value=data.title;$('event-type').value=data.eventType||EVENT_TYPES[0];
  $('replacement-date').value=data.replacementDate||'';
  $('from').value=data.periodIds[0];$('through').value=data.periodIds.at(-1);
  $('visibility').value=data.isPublic?'public':'private';$('visibility').onchange();
  $('mode').value=data.mode||'physical';$('mode').onchange();
  $('location').value=data.location||'';
  $('online-url').value=data.onlineUrl||'';$('description').value=data.description||'';$('description').oninput();
  for(const [kind,ids] of [['groups',data.groupIds||[]],['teachers',data.teacherIds||[]]]){
    $(`${kind}-search`).value='';
    for(const input of $(kind).querySelectorAll('input'))input.checked=ids.includes(input.value);
    filterChoices(kind);
  }
  updateParticipantRequirements();
  $('replacement-course').value=coursesForGroups(courses,selectedGroups()).some(course=>course.title===data.title)?data.title:'';
  $('booking-heading').textContent=bt('Redaktoni rezervimin');
  $('booking-form').querySelector('button').textContent=bt('Ruani ndryshimet');
  $('edit-banner').hidden=false;
  $('edit-notice').textContent=data.ownerUid===currentUser.uid?bt('Po redaktoni rezervimin tuaj.'):bt('Po redaktoni rezervimin e një përdoruesi tjetër. Krijuesi do të njoftohet me email për ndryshimet.');
  $('booking-message').textContent='';$('selection-hint').textContent='';
  readAvailability().catch(e=>message(errText(e),true));
  $('booking-heading').scrollIntoView({behavior:'smooth'});
}
function updateRequestHint() {
  const special=requiresApproval||!canCancelAll&&(isSpecialRoom($('room').value)||isSpecialRoom(editing?.data.roomId));
  $('request-hint').hidden=!special;
  $('request-hint').textContent=requiresApproval
    ? bt('Çdo rezervim dhe ndryshim nga kjo llogari kërkon miratim. Kërkesat, me ose pa sallë, shfaqen në orar vetëm pas miratimit. Deri atëherë, rezervimi ekzistues mbetet në fuqi.')
    : editing
    ? bt('Vetëm ndryshimi i sallës, datës ose orës kërkon miratim. Të dhënat e tjera mund të ruhen menjëherë. Deri në miratim, rezervimi ekzistues mbetet në fuqi.')
    : bt('Kjo sallë kërkon miratim. Kërkesa nuk e zë sallën dhe nuk shfaqet në orarin publik deri në miratim.');
  $('booking-form').querySelector('button').textContent=editing?bt('Ruani ndryshimet'):special?bt('Dërgoni kërkesën për rezervim'):bt('Bëni rezervimin');
}
function statusBadge(kind){
 const badge=document.createElement('strong');badge.className='reservation-status status-'+kind;
 badge.textContent={confirmed:bt('E konfirmuar'),pending:bt('Në pritje të miratimit'),rejected:bt('E refuzuar')}[kind];return badge;
}
function bookingCalendar(id,data){
 const slots=periods.filter(p=>data.periodIds.includes(p.id)).sort((a,b)=>a.start.localeCompare(b.start));
 return calendarActions({id,...localizedText(data),date:data.date,start:slots[0].start,end:slots.at(-1).end,room:data.roomId?displayRoom(rooms.find(r=>r.id===data.roomId)?.name||data.roomId):data.location||bt('Pa sallë'),onlineUrl:data.onlineUrl},bt);
}
function requestDetails(data) {
  const lines=[`${displayDate(data.date)} · ${displayRoom(rooms.find(r=>r.id===data.roomId)?.name||data.roomId)} · ${reservationTime(data.periodIds,periods)}`,localizedText(data).title,
    bt("Kërkuesi: {v0}",{v0:data.creatorName}),bt("Lloji: {v0}",{v0:bt(data.eventType)}),
    bt("Grupet: {v0}",{v0:data.groupIds.map(id=>displayGroup(catalog.groups[id]||id)).join(', ')||bt('Pa grup')}),
    bt("Mësimdhënësit: {v0}",{v0:data.teacherIds.map(id=>catalog.teachers[id]||id).join(', ')||bt('Pa mësimdhënës')}),
    bt("Njoftimi: {v0} · {v1}",{v0:data.isPublic?bt('Publik'):bt('Jo publik'),v1:data.mode==='online'?bt('Online'):bt('Fizik')})];
  if(data.replacementDate)lines.push(bt('Data e mësimit që zëvendësohet')+': '+displayDate(data.replacementDate));
  if(data.studentEmails?.length)lines.push(bt('Studentë për njoftim')+': '+data.studentEmails.join('; '));
  if(data.location)lines.push(bt("Lokacioni: {v0}",{v0:data.location}));
  if(data.onlineUrl)lines.push(data.onlineUrl);
  if(localizedText(data).description)lines.push(localizedText(data).description);
  return lines.join('\n');
}
function confirmRequestDecision(data,outcome) {
  decisionPreviewData=data;
  $('request-decision-heading').textContent=outcome==='approved'?bt('Miratoni kërkesën'):bt('Refuzoni kërkesën');
  $('request-decision-summary').textContent=requestDetails(data);
  $('request-decision-reason').value='';$('request-decision-error').textContent='';
  const dialog=$('request-decision-dialog');dialog.returnValue='back';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'?$('request-decision-reason').value.trim():null),{once:true});
    dialog.showModal();
  });
}
function decisionTimestamp(value) {
  return formatDateTime(value,getLanguage(),bt('Nuk është regjistruar'));
}

function decisionCard(decision) {
  const data=decision.booking,card=document.createElement('article');card.className='decision-card';
  const heading=document.createElement('h3');
  heading.textContent=`${decision.reservationId?bt('Ndryshim rezervimi')+' · ':''}${decision.outcome==='approved'?bt('Miratuar'):bt('Refuzuar')} · ${localizedText(data).title}`;
  const details=document.createElement('dl');details.className='decision-details';
  const fields=[
    [bt('Kërkuesi'),data.creatorName||bt('Emri nuk është i disponueshëm')],
    [bt('Salla'),displayRoom(rooms.find(room=>room.id===data.roomId)?.name||catalog.rooms?.[data.roomId]||data.roomId||bt('Pa sallë'))],
    [bt('Data e aktivitetit'),displayDate(data.date)],[bt('Ora'),reservationTime(data.periodIds,periods)],
    [bt('Lloji i aktivitetit'),bt(data.eventType)||bt('Nuk është regjistruar')],
    ...(data.replacementDate?[[bt('Data e mësimit që zëvendësohet'),displayDate(data.replacementDate)]]:[]),
    [bt('Mësimdhënësit'),(data.teacherIds||[]).map(id=>catalog.teachers[id]||id).join(', ')||bt('Pa mësimdhënës')],
    [bt('Grupet e studentëve'),(data.groupIds||[]).map(id=>displayGroup(catalog.groups[id]||id)).join(', ')||bt('Pa grup të studentëve')],
    [bt('Njoftimi për aktivitetin'),data.isPublic?bt('Publik'):bt('Jo publik')],
    [bt('Mënyra e zhvillimit'),data.mode==='online'?bt('Online'):bt('Fizik')],
    ...(data.location?[[bt('Lokacioni'),data.location]]:[]),
    ...(data.onlineUrl?[[bt('Linku i ngjarjes online'),data.onlineUrl]]:[]),
    ...(localizedText(data).description?[[bt('Përshkrimi i aktivitetit'),localizedText(data).description]]:[]),
    ...(data.studentEmails?.length?[[bt('Studentë për njoftim'),data.studentEmails.join('; ')]]:[]),
    [bt('Kërkesa u dërgua më'),decisionTimestamp(data.createdAt)],
    [bt('Vendimi nga'),decision.deciderName||bt('Emri nuk është i disponueshëm')],
    [bt('Vendimi u mor më'),decisionTimestamp(decision.createdAt)],
    [bt('Arsyeja e vendimit'),decision.reason]
  ];
  for(const [label,value] of fields){
    const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=bt(label);detail.textContent=value;
    if(label===bt('Linku i ngjarjes online')&&/^https?:\/\//i.test(value)){
      const link=document.createElement('a');link.textContent=value;link.href=value;link.target='_blank';link.rel='noopener noreferrer';detail.replaceChildren(link);
    }
    details.append(term,detail);
  }
  card.append(statusBadge(decision.outcome==='approved'?'confirmed':'rejected'),heading,details);return card;
}
async function readRequests() {
  if(!currentUser)return;
  const own=path=>canCancelAll?collection(db,path):query(collection(db,path),where(path==='requestDecisions'?'booking.ownerUid':'ownerUid','==',currentUser.uid));
  const [pending,editPending,decisions]=await Promise.all([getDocs(own('reservationRequests')),getDocs(own('reservationEditRequests')),getDocs(own('requestDecisions'))]);
  const requests=[...pending.docs,...editPending.docs.map(d=>({id:d.id,edit:true,data:()=>({...d.data().booking,createdAt:d.data().createdAt})}))];
  $('requests-heading').textContent=managementView||canCancelAll?bt('Kërkesat për miratim'):bt('Kërkesat e mia');
  const wrapper=$('reservation-requests');wrapper.replaceChildren();
  if(!requests.length)wrapper.textContent=bt('Nuk ka kërkesa në pritje.');
  for(const item of requests.sort((a,b)=>a.data().date.localeCompare(b.data().date))){
    const data=item.data(),card=document.createElement('div');card.className='request-card';card.append(statusBadge('pending'));
    const details=document.createElement('p');details.style.whiteSpace='pre-wrap';details.textContent=(item.edit?bt('Kërkesë për ndryshimin e rezervimit. Rezervimi ekzistues mbetet në fuqi.')+'\n':'')+requestDetails(data)+bt('\nNë pritje të miratimit');card.append(details);
    const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.style.whiteSpace='pre-wrap';
    if(canCancelAll)for(const [outcome,label] of [['approved',bt('Miratoni')],['rejected',bt('Refuzoni')]]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.className=outcome==='rejected'?'danger':'';
      button.onclick=async()=>{
        const reason=await confirmRequestDecision(data,outcome);if(reason===null)return;
        card.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{
          await (item.edit?decideReservationEditRequest:decideReservationRequest)(db,item.id,outcome,reason,currentUser);
          await Promise.all([readRequests(),readMyBookings(),readAvailability()]);
          message(outcome==='approved'?bt('Kërkesa u miratua dhe rezervimi u publikua. Njoftimi me email është në pritje të dërgimit.'):bt('Kërkesa u refuzua dhe u fshi. Njoftimi me email është në pritje të dërgimit.'));
        }catch(e){feedback.textContent=errText(e);feedback.className='error';card.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };card.append(button,document.createTextNode(' '));
    }
    card.append(feedback);wrapper.append(card);
  }
  const history=$('request-decisions');history.replaceChildren();
  if(!decisions.docs.length)history.textContent=bt('Ende nuk ka vendime për kërkesat.');
  for(const item of decisions.docs.sort((a,b)=>(b.data().createdAt?.seconds||0)-(a.data().createdAt?.seconds||0))){
    history.append(decisionCard(item.data()));
  }
}
function todayDate() {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Tirane',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
async function readMyBookings() {
  if (!currentUser) return;
  const reservations = collection(db, 'reservations');
  const snap = await getDocs(canCancelAll ? reservations : query(reservations, where('ownerUid','==',currentUser.uid)));
  $('reservations-heading').textContent = managementView||canCancelAll ? bt('Të gjitha rezervimet') : bt('Rezervimet e mia');
  const today=todayDate();
  const byDate=(a,b)=>a.data().date.localeCompare(b.data().date)||a.data().periodIds[0].localeCompare(b.data().periodIds[0]);
  const upcoming=snap.docs.filter(item=>item.data().date>=today).sort(byDate);
  const past=snap.docs.filter(item=>item.data().date<today).sort((a,b)=>byDate(b,a));
  const sorted=[...upcoming,...past];
  const wrapper = $('my-reservations'),archive=$('past-reservations');
  wrapper.replaceChildren();archive.replaceChildren();
  $('past-reservations-summary').textContent=bt("Rezervimet e kaluara ({v0})",{v0:past.length});

  for (const item of sorted) {
    const data = item.data();
    const roomName = data.roomId?displayRoom(rooms.find(r=>r.id===data.roomId)?.name||data.roomId):data.location||bt('Pa sallë');
    const div = document.createElement('div');
    div.className = 'slot';
    div.dataset.search=normalizeSearch([data.title,data.titleEn,data.descriptionEn,data.date,formatDate(data.date,'sq'),formatDate(data.date,'en'),roomName,rooms.find(r=>r.id===data.roomId)?.name,data.creatorName,data.eventType,bt(data.eventType),data.description,...(data.groupIds||[]).map(id=>catalog.groups[id]||id),reservationTime(data.periodIds,periods),...(data.groupIds||[]).map(id=>displayGroup(catalog.groups[id]||id)),...(data.teacherIds||[]).map(id=>catalog.teachers[id]||id)].filter(Boolean).join(' '));
    const description = document.createElement('span');
    description.append(safeText(`${displayDate(data.date)} · ${roomName} · ${localizedText(data).title} · ${reservationTime(data.periodIds, periods)}`));
    if (canCancelAll) description.append(safeText(bt(" · Rezervuar nga: {v0}",{v0:data.creatorName || (data.ownerUid === currentUser.uid ? currentUser.displayName : '') || bt('Emri nuk është i disponueshëm')})));
    const button = document.createElement('button');
    button.className = 'danger';
    button.textContent = bt('Anuloni');
    button.onclick = async () => {
      const confirmation = await confirmCancellation(data);
      if (!confirmation.confirmed) return;
      button.disabled = true;
      try {
        await cancelReservation(item.id, confirmation.reason);
        $('booking-receipt').hidden=true;
        await Promise.all([readMyBookings(), readAvailability()]);
        message(data.ownerUid === currentUser.uid ? bt('Rezervimi u anulua.') : bt('Rezervimi u anulua. Njoftimi me email është në pritje të dërgimit.'));
      } catch(e) { message(errText(e), true); button.disabled = false; }
    };
    const edit=document.createElement('button');
    edit.type='button';edit.className='secondary';edit.textContent=bt('Redaktoni');
    edit.onclick=()=>startEditing(item.id,data);
    const actions=document.createElement('div');actions.className='reservation-actions';actions.append(edit,button);
    div.append(statusBadge('confirmed'),description,actions,bookingCalendar(item.id,data));
    (data.date<today?archive:wrapper).appendChild(div);
  }
  filterReservations();
}
let emailViewGeneration=0;
async function readEmailDelivery(){
 const user=currentUser, elevated=canCancelAll, generation=++emailViewGeneration;
 if(!user)return;
 const feedback=$('email-delivery-feedback'),list=$('email-delivery-list');feedback.textContent=bt('Duke ngarkuar…');list.replaceChildren();
 try{
  const {notices,publicEvents}=await loadEmailDeliveries(db,user,elevated);
  if(currentUser?.uid!==user.uid||generation!==emailViewGeneration)return;
  const retryButton=(card,paths)=>{
   const button=document.createElement('button');button.type='button';button.textContent=bt('Riprovoni dërgimin');
   button.onclick=async()=>{button.disabled=true;let count=0;
    try{for(const path of paths)if(await retryEmail(db,path,user))count++;
     await readEmailDelivery();feedback.textContent=bt("{v0} njoftime u vendosën në pritje. Dërgimi bëhet në ekzekutimin e radhës; mund të ketë vonesa.",{v0:count});
    }catch(e){feedback.textContent=bt("{v0} njoftime u vendosën në pritje. ",{v0:count})+errText(e);button.disabled=false;}
   };card.append(button);
  };
  for(const notice of notices.filter(n=>n.status!=='recorded').sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))){
   const card=document.createElement('article');card.className='decision-card';
   const heading=document.createElement('h3');heading.textContent=`${bt(notice.kind)} · ${localizedText(notice.booking||{}).title||bt('Rezervim')}`;
   const text=document.createElement('p');text.style.whiteSpace='pre-wrap';text.textContent=[bt("Statusi: {v0}",{v0:bt(deliveryLabel(notice.status))}),bt("Data e aktivitetit: {v0}",{v0:displayDate(notice.booking?.date)}),bt("Kërkuesi: {v0}",{v0:notice.booking?.creatorName||'—'}),bt("Krijuar: {v0}",{v0:decisionTimestamp(notice.createdAt)}),notice.sentAt?bt("Dërguar: {v0}",{v0:decisionTimestamp(notice.sentAt)}):'',notice.lastAttemptAt?bt("Përpjekja e fundit: {v0}",{v0:decisionTimestamp(notice.lastAttemptAt)}):'',notice.status==='failed'?bt('Dërgimi kërkon ndërhyrjen e administratorit.'):''].filter(Boolean).join('\n');card.append(heading,text);
   if(elevated&&notice.status==='failed')retryButton(card,[notice.path]);list.append(card);
  }
  for(const event of publicEvents.sort((a,b)=>b.booking.date.localeCompare(a.booking.date))){
   const card=document.createElement('article');card.className='decision-card';const heading=document.createElement('h3');heading.textContent=bt("Përmbledhje javore · {v0}",{v0:displayDate(event.week.start)});
   const counts={sent:0,failed:0,waiting:0,skipped:0};for(const d of event.deliveries){if(d.status==='sent')counts.sent++;else if(d.status==='failed')counts.failed++;else if(d.status==='skipped')counts.skipped++;else counts.waiting++;}
   counts.waiting+=Math.max(0,event.expected-event.deliveries.length);
   const ended=event.week.end<=todayDate();
   const text=document.createElement('p');text.textContent=bt("{v0} · Dërguar: {v1} · Dështuar: {v2} · {v3}: {v4} · Të anashkaluara: {v5}. ",{v0:displayDate(event.booking.date),v1:counts.sent,v2:counts.failed,v3:ended?bt('Pa dërguar'):bt('Në pritje'),v4:counts.waiting,v5:counts.skipped})+(!event.enabled?bt('Njoftimet publike janë të çaktivizuara. '):event.expected===0?bt('Lista e marrësve nuk është konfiguruar. '):'')+bt('Përmbledhje javore: çdo të hënë në 08:00, për javën e hënë–e diel. Statusi i dërgimit i përket emailit javor.');card.append(heading,text);
   if(!ended&&counts.failed)retryButton(card,event.deliveries.filter(d=>d.status==='failed').map(d=>d.path));list.append(card);
  }
  feedback.textContent=list.children.length?bt('Statusi u rifreskua.'):bt('Nuk ka njoftime për të shfaqur.');
 }catch(e){if(currentUser?.uid===user.uid&&generation===emailViewGeneration)feedback.textContent=errText(e);}
}
function normalizeSearch(value){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
let archiveBeforeSearch=null;
function filterReservations(){
 const words=normalizeSearch($('reservation-search').value.trim()).split(/\s+/).filter(Boolean);
 const counts=[];
 for(const [index,id] of ['my-reservations','past-reservations'].entries()){
  const wrapper=$(id);wrapper.querySelector('.reservation-empty')?.remove();
  const rows=[...wrapper.querySelectorAll('.slot')];
  for(const row of rows)row.hidden=!words.every(word=>row.dataset.search.includes(word));
  const count=rows.filter(row=>!row.hidden).length;counts.push(count);
  if(!count){const empty=document.createElement('p');empty.className='reservation-empty';empty.textContent=words.length?bt('Nuk ka rezervime që përputhen me kërkimin.'):index?bt('Nuk ka rezervime të kaluara.'):bt('Nuk ka rezervime për sot ose për ditët në vijim.');wrapper.append(empty);}
 }
 $('past-reservations-summary').textContent=bt("Rezervimet e kaluara ({v0})",{v0:counts[1]});
 $('reservation-search-results').textContent=words.length?bt("{v0} rezervime të ardhshme · {v1} rezervime të kaluara",{v0:counts[0],v1:counts[1]}) : '';
 const archive=$('past-reservations-section');
 if(words.length){if(archiveBeforeSearch===null)archiveBeforeSearch=archive.open;archive.open=true;}
 else if(archiveBeforeSearch!==null){archive.open=archiveBeforeSearch;archiveBeforeSearch=null;}
}
function bookingMessage(text, isError = false) {
  message(text, isError);
  const feedback = $('booking-message');
  feedback.textContent = bt(text);
  feedback.className = isError ? 'error' : 'ok';
  feedback.scrollIntoView({block:'nearest'});
}
function renderReceipt(){
 if(!lastReceipt)return;
 const {id,data,requestOnly}=lastReceipt,receipt=$('booking-receipt');receipt.replaceChildren(statusBadge(requestOnly?'pending':'confirmed'));
 const summary=document.createElement('p');summary.style.whiteSpace='pre-wrap';summary.textContent=requestDetails(data);receipt.append(summary);
 const next=document.createElement('p');next.textContent=bt(requestOnly&&lastReceipt.editRequest?'Kërkesa për ndryshim u dërgua për miratim. Rezervimi ekzistues mbetet në fuqi.':requestOnly&&requiresApproval?'Kërkesa shfaqet në orar vetëm pas miratimit nga një përdorues me autorizim.':requestOnly?'Kërkesa do të shqyrtohet nga një përdorues me autorizim. Salla ende nuk është rezervuar. Për vendimin do të njoftoheni me email; dërgimi mund të vonohet.':'Rezervimi shfaqet në orarin zyrtar. Mund ta redaktoni ose anuloni te “Rezervimet e mia”.');receipt.append(next);
 if(!requestOnly)receipt.append(bookingCalendar(id,data));receipt.hidden=false;
}
async function createReservation(event) {
  $('booking-receipt').hidden=true;
  event.preventDefault();
  $('booking-message').textContent = '';
  if (!currentUser || $('reservation-dialog').open || $('booking-form').querySelector('button').disabled) return;
  const edit=editing;
  let studentEmails;
  try { studentEmails=parseStudentEmails($('student-emails').value); } catch(e) { return bookingMessage(e.message,true); }
  const date = $('date').value;
  const roomId = $('room').value;
  const replacement=isReplacement($('event-type').value);
  const course=replacement?coursesForGroups(courses,selectedGroups()).find(course=>course.title===$('replacement-course').value):null;
  const title = replacement ? course?.title||'' : $('title').value.trim();
  const titleEn = replacement ? '' : $('title-en').value.trim();
  if(titleEn.length>120)return bookingMessage(bt('Titulli në anglisht mund të ketë deri në 120 karaktere.'),true);
  let periodIds;
  try { periodIds = selectedPeriodIds(); } catch(e) { return bookingMessage(errText(e),true); }
  if (!replacement && !title) return bookingMessage(bt('Shkruani titullin e aktivitetit.'), true);
  if(requiresPrivateVisibility($('event-type').value) && $('visibility').value==='public')return bookingMessage(bt('Zëvendësimi i mësimit dhe kolokiumi nuk përfshihen në njoftimet publike.'),true);
  if (date < settings.startDate || date > settings.endDate) return bookingMessage(bt('Data është jashtë semestrit të konfiguruar.'),true);
  if (!settings.bookingOpen) return bookingMessage(bt('Rezervimet janë pezulluar gjatë përditësimit të orarit.'),true);
  const onlineUrl = $('mode').value === 'online' ? $('online-url').value.trim() : '';
  if ($('mode').value === 'online') {
    try { if (!/^https?:$/.test(new URL(onlineUrl).protocol) || onlineUrl.length > 2000) throw Error(); }
    catch { return bookingMessage(bt('Vendosni një link të vlefshëm që fillon me https:// ose http://.'), true); }
  }
  const location=roomId==='' && $('mode').value==='physical' ? $('location').value.trim() : '';
  if(location.length>300)return bookingMessage(bt('Lokacioni mund të ketë deri në 300 karaktere.'),true);
  const description = $('visibility').value === 'public' ? $('description').value.trim() : '';
  const descriptionError = $('visibility').value === 'public' ? publicDescriptionError(title, description) : '';
  if (descriptionError) return bookingMessage(bt(descriptionError), true);
  const descriptionEn = $('visibility').value === 'public' ? $('description-en').value.trim() : '';
  const englishError = descriptionEn ? publicDescriptionError(titleEn||title,descriptionEn) : '';
  if(englishError){$('english-fields').open=true;$('description-en').focus();return bookingMessage(bt('Përshkrimi në anglisht')+': '+bt(englishError),true);}
  const checked = id => [...$(id).querySelectorAll('input:checked')].map(input => input.value);
  const data = {title, titleEn, date, roomId, periodIds, description, descriptionEn, location, studentEmails, groupIds:checked('groups'), teacherIds:checked('teachers'),
    eventType:$('event-type').value, isPublic:$('visibility').value === 'public', mode:$('mode').value, onlineUrl,
    creatorName:edit?.data.creatorName || currentUser.displayName || 'Mësimdhënës'};
  if(data.eventType==='Zëvendësim i mësimit') {
    const missing=[];
    if(!data.groupIds.length)missing.push(bt('Për zëvendësim të mësimit, zgjidhni të paktën një grup të studentëve.'));
    if(!data.teacherIds.length)missing.push(bt('Për zëvendësim të mësimit, zgjidhni të paktën një mësimdhënës.'));
    if(!course)missing.push(bt('Zgjidhni lëndën nga lista.'));
    const originalDate=$('replacement-date').value;
    if(!validReplacementDate(originalDate)||originalDate<settings.startDate||originalDate>settings.endDate)missing.push(bt('Zgjidhni datën e mësimit që zëvendësohet brenda semestrit.'));
    if(missing.length)return bookingMessage(missing.join('\n'),true);
  }
  if(replacement){data.courseSource=course.source;data.replacementDate=$('replacement-date').value;}
  if(edit && Object.entries(data).every(([key,value])=>JSON.stringify(value)===JSON.stringify(edit.data[key] ?? (Array.isArray(value)?[]:typeof value==='boolean'?false:'')))) {
    return bookingMessage(bt('Nuk keni bërë ndryshime.'));
  }
  const requestOnly=requiresApproval||!canCancelAll&&(edit?needsReapproval(edit.data,data):isSpecialRoom(roomId));
  const ownerUid=currentUser.uid;
  const reservationRef = doc(collection(db,'reservations'));
  const publicRef = doc(db,'publicBookings',reservationRef.id);
  const occupancyRef = doc(db,'eventDays',date);
  try {
    $('booking-form').querySelector('button').disabled = true;
    if(!await confirmReservation({...data,studentEmails}))return;
    if(currentUser?.uid!==ownerUid)throw new BookingError(bt('Llogaria ndryshoi. Provoni përsëri.'));
    if(edit&&requestOnly){
      await submitReservationEditRequest(db,edit.id,edit.revision,data,currentUser);
    }else if(edit) {
      await updateReservation(db,edit.id,edit.revision,data,currentUser);
    } else if(requestOnly) {
      await submitReservationRequest(db,data,currentUser,studentEmails);
    } else await runTransaction(db, async tx => {
      // Read all relevant documents first; writes must follow all transaction reads.
      // Reading settings also makes a concurrent administrative import fail/retry safely.
      const settingsRef = doc(db,'settings','control');
      const dayRef = doc(db,'calendarDays',date);
      const settingsSnap = await tx.get(settingsRef);
      const daySnap = await tx.get(dayRef);
      if (!settingsSnap.exists() || !settingsSnap.data().bookingOpen || settingsSnap.data().slotStorage !== 'resources-v2') throw new BookingError(bt('Rezervimet janë pezulluar.'));
      if (!daySnap.exists() || !daySnap.data().bookingAllowed) throw new BookingError(bt('Rezervimet janë të mbyllura për këtë datë.'));
      const day = daySnap.data();
      const weeklyRef = doc(db,'weeklyResources',String(day.weekday));
      const occupancy = await tx.get(occupancyRef);
      const locks = occupancy.exists() ? {...occupancy.data().bookings} : {};
      const weeklySnap = day.fetActive ? await tx.get(weeklyRef) : null;
      const conflict = conflictMessage(data, locks, weeklySnap?.exists() ? weeklySnap.data().busyKeys : [],day.releasedKeys||[]);
      if (conflict) throw new BookingError(conflict);
      tx.set(reservationRef, {...data, ownerUid, createdAt:serverTimestamp()});
      recordActivity(tx,db,'created',reservationRef.id,{...data,ownerUid},currentUser,{method:'direct'});
      const {studentEmails:privateEmails,...publicData}=data;
      tx.set(publicRef, {...publicData, createdAt:serverTimestamp()});
      if(studentEmails.length)tx.set(doc(db,'studentNotifications',reservationRef.id),{booking:{...data,ownerUid,createdAt:serverTimestamp()},recipients:studentEmails,kind:'students',status:'pending',createdAt:serverTimestamp()});
      const keys = slotKeys(data);
      for (const key of keys) locks[key] = reservationRef.id;
      if (keys.length) tx.set(occupancyRef, {bookings:locks, changedReservationId:reservationRef.id});
    });
    $('student-emails').value = '';
    $('title').value = '';
    $('replacement-course').value='';$('replacement-date').value='';
    $('title-en').value='';$('description-en').value='';$('english-fields').open=false;$('description-en').oninput();
    $('location').value = '';
    $('description').value = '';
    $('description').oninput();
    if(edit)stopEditing();
    bookingMessage(edit&&requestOnly?bt('Kërkesa për ndryshim u dërgua për miratim. Rezervimi ekzistues mbetet në fuqi.'):edit ? (edit.data.ownerUid===ownerUid?bt('Rezervimi u ndryshua me sukses.'):bt('Rezervimi u ndryshua. Njoftimi me email është në pritje të dërgimit.')) : requestOnly?bt('Kërkesa u dërgua për miratim. Salla ende nuk është rezervuar.'):bt('Rezervimi u krijua me sukses.'));
    lastReceipt={id:edit?.id||reservationRef.id,data:{...data,creatorName:currentUser.displayName||''},requestOnly,editRequest:Boolean(edit&&requestOnly)};
    renderReceipt();$('booking-receipt').focus();
    await Promise.all([readAvailability(),readMyBookings(),readRequests()]);
  } catch (e) { bookingMessage(errText(e),true); }
  finally { $('booking-form').querySelector('button').disabled = false; }
}
async function cancelReservation(id, reason = '') {
  const reservationRef = doc(db,'reservations',id);
  await runTransaction(db, async tx => {
    const existing = await tx.get(reservationRef);
    if (!existing.exists()) throw new BookingError(bt('Rezervimi nuk ekziston më.'));
    const booking = existing.data();
    const students=await tx.get(doc(db,'studentNotifications',id));
    if (!canCancelAll && booking.ownerUid !== currentUser.uid) throw new BookingError(bt('Ky rezervim nuk ju përket juve.'));
    const otherOwner = booking.ownerUid !== currentUser.uid;
    if (otherOwner && (!reason.trim() || reason.length > 2000)) throw new BookingError(bt('Shkruani arsyen e anulimit (deri në 2000 karaktere).'));
    const occupancyRef = doc(db,'eventDays',booking.date);
    const occupancy = await tx.get(occupancyRef);
    const locks = occupancy.exists() ? {...occupancy.data().bookings} : {};
    if (slotKeys(booking).some(p => locks[p] !== id)) throw new BookingError(bt('Të dhënat e rezervimit nuk përputhen. Kontaktoni administratorin.'));
    slotKeys(booking).forEach(p => delete locks[p]);
    if (slotKeys(booking).length) tx.set(occupancyRef, {bookings:locks, changedReservationId:id});
    if (otherOwner) tx.set(doc(db,'cancellationNotifications',id), {booking,reason:reason.trim(),cancelledBy:currentUser.uid,createdAt:serverTimestamp(),status:'pending'});
    const recipients=booking.studentEmails??students.data()?.recipients??[];
    if(recipients.length)tx.set(doc(db,'studentChangeNotifications',`${id}__cancel`),{reservationId:id,booking,recipients,kind:'students',eventAction:'cancelled',reason:reason.trim(),status:'pending',createdAt:serverTimestamp()});
    tx.delete(reservationRef);
    tx.delete(doc(db,'publicBookings',id));
    recordActivity(tx,db,'cancelled',id,booking,currentUser);
  });
}
function openLinkedSection(){
 if(managementView){
  if(requestedSection==='requests'){
   for(const details of document.querySelectorAll('details'))details.open=false;
   $('requests-section').open=true;
   $('requests-section').scrollIntoView({block:'start'});
   return;
  }
  for(const id of ['requests-section','email-delivery-section','reservations-section'])$(id).open=false;
  return;
 }

 const params=new URLSearchParams(location.search);
 const target=params.get('section')==='requests'?'requests-section':params.get('section')==='booking'||['date','room','start','end'].some(key=>params.has(key))?'booking-section':null;
 if(!target)return;
 for(const details of document.querySelectorAll('details'))details.open=false;
 $(target).open=true;
 $(target).scrollIntoView({block:'start'});
}
function applyBookingLink() {
  const params=new URLSearchParams(location.search);
  if(!['date','room','start','end'].some(key=>params.has(key)))return;
  const date=params.get('date'),room=rooms.find(r=>r.name===params.get('room'));
  const from=periods.findIndex(p=>p.start===params.get('start'));
  const through=periods.findIndex(p=>p.end===params.get('end'));
  const parsedDate=new Date(`${date}T12:00:00Z`);
  if(!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==date || date<settings.startDate || date>settings.endDate || !room || from<0 || through<from){
    bookingMessage(bt('Përzgjedhja nga lidhja nuk është e vlefshme për orarin aktual. Përzgjidhni datën, sallën dhe orët para rezervimit.'),true);
    return;
  }
  $('date').value=date;$('room').value=room.id;
  $('from').value=periods[from].id;$('through').value=periods[through].id;
  $('selection-hint').textContent=bt('Data, salla dhe orët u përzgjodhën nga kërkimi i sallave të lira. Mund t’i ndryshoni para rezervimit.');
  try{selectedPeriodIds();}catch(e){bookingMessage(errText(e),true);}
}
async function loadApp() {
  const user=currentUser,generation=authenticationGeneration;
  const userSnap = await getDoc(doc(db,'users',user.uid));
  if(generation!==authenticationGeneration)return;
  if (!userSnap.exists() || !hasStaffAccess(userSnap.data())) {
    $('app').hidden = true;
    emailViewGeneration++;$('email-delivery-list').replaceChildren();$('email-delivery-feedback').textContent='';$('email-delivery-section').open=false;
    setStaffAccess('denied');
    return;
  }
  setStaffAccess('authorized');
  canCancelAll = userSnap.data().canCancelAll === true;
  requiresApproval = userSnap.data().requiresApproval === true;
  if(userSnap.data().bookingName)currentUser={uid:user.uid,email:user.email,displayName:userSnap.data().bookingName};
  $('reports-link').hidden=!canCancelAll;
  if(reportsView){
    $('booking-help').closest('section').hidden=true;
    if(!canCancelAll){message(bt('Raportet janë të disponueshme vetëm për përdoruesit me autorizim të lartë.'),true);return;}
    message('');
    const {createReportsDashboard}=await import('./reports-dashboard.js');
    if(generation!==authenticationGeneration)return;
    $('reports').hidden=false;
    reportsController=createReportsDashboard(db,user);
    await reportsController.load();
    return;
  }
  const settingsSnap=await getDoc(doc(db,'settings','control'));
  if (!settingsSnap.exists()) throw new BookingError(bt('Administratori duhet të importojë fillimisht orarin.'));
  settings = settingsSnap.data();
  if(generation!==authenticationGeneration)return;
  if(classesView){
    $('class-cancellations').hidden=false;
    const {createClassCancellationPage}=await import('./class-cancellation-page.js');
    if(generation!==authenticationGeneration)return;
    classesController=createClassCancellationPage(db,user,userSnap.data(),settings,bt,getLanguage);
    await classesController.load();return;
  }
  if(!settings.bookingOpen){
    $('app').hidden=true;
    message(bt('Rezervimet janë pezulluar përkohësisht gjatë kontrollit të shërbimit. Orari publik dhe rezervimet ekzistuese mbeten të dukshme në orar.'));
    return;
  }
  const [roomSnap,periodSnap,catalogSnap,courseSnap]=await Promise.all([
    getDocs(collection(db,'rooms')),getDocs(collection(db,'periods')),getDoc(doc(db,'resourceCatalog','current')),getDocs(collection(db,'weeklyRooms'))
  ]);
  if(generation!==authenticationGeneration)return;
  if (settings.slotStorage !== 'resources-v2') throw new BookingError(bt('Rezervimet po përditësohen. Provoni përsëri së shpejti.'));
  rooms = roomSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name));
  periods = periodSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id));
  if (!catalogSnap.exists()) throw new BookingError(bt('Orari i grupeve dhe i mësimdhënësve nuk është konfiguruar.'));
  catalog = catalogSnap.data();
  courses=timetableCourses(courseSnap.docs.map(d=>({id:d.id,...d.data()})),catalog);
  fillOptions($('room'),[{id:'',name:bt('Pa sallë')},...rooms],r=>r.id,r=>r.name);
  if (rooms.length) $('room').value = rooms[0].id;
  fillOptions($('event-type'),EVENT_TYPES,t=>t,t=>t);
  for (const kind of ['groups','teachers']) {
    $(kind).replaceChildren();
    for (const [id,name] of Object.entries(catalog[kind]).sort((a,b)=>a[1].localeCompare(b[1],'sq'))) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = id;
      label.dataset.sourceName=name;label.dataset.kind=kind;
      label.append(input, safeText(kind==='groups'?displayGroup(name):name)); $(kind).appendChild(label);
    }
    filterChoices(kind);
  }
  updateParticipantRequirements();
  $('replacement-date').min=settings.startDate;$('replacement-date').max=settings.endDate;
  fillOptions($('from'),periods,p=>p.id,p=>p.start);
  fillOptions($('through'),periods,p=>p.id,p=>p.end);
  const localToday = todayDate();
  $('date').value = localToday >= settings.startDate && localToday <= settings.endDate ? localToday : settings.startDate;
  $('date').min = settings.startDate;
  $('date').max = settings.endDate;
  $('app').hidden = false;
  if(managementView){
   $('management-scope').hidden=false;
   $('management-scope').textContent=canCancelAll?bt('Shfaqen kërkesat dhe rezervimet e të gjithë përdoruesve.'):bt('Shfaqen vetëm kërkesat, njoftimet dhe rezervimet tuaja.');
  }

  message(managementView?bt('Keni hyrë me sukses. Këtu mund të menaxhoni rezervimet dhe njoftimet tuaja.'):requiresApproval?bt('Çdo rezervim dhe ndryshim nga kjo llogari kërkon miratim.'):settings.bookingOpen ? bt('Keni hyrë me sukses. Mund të rezervoni një sallë.') : bt('Rezervimet janë pezulluar përkohësisht gjatë përditësimit të orarit.'));
  openLinkedSection();
  applyBookingLink();
  await Promise.all([readAvailability(), readMyBookings(), readRequests()]);
}
const selectedGroups=()=>[...$('groups').querySelectorAll('input:checked')].map(input=>input.value);
function updateCourseOptions(){
  const selected=$('replacement-course').value;
  const available=coursesForGroups(courses,selectedGroups());
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=bt('Zgjidhni lëndën');
  $('replacement-course').replaceChildren(placeholder);
  for(const course of available){const option=document.createElement('option');option.value=course.title;option.textContent=course.title;$('replacement-course').append(option);}
  $('replacement-course').value=available.some(course=>course.title===selected)?selected:'';
  $('replacement-course-hint').textContent=bt(!courses.length?'Nuk ka lëndë në orarin e importuar. Kontaktoni administratorin.':!available.length?'Nuk ka lëndë për grupet e përzgjedhura.':selectedGroups().length?'Lëndët janë filtruar sipas grupeve të përzgjedhura.':'Zgjidhni grupin e studentëve për të filtruar lëndët.');
}
function updateParticipantRequirements() {
  const required=isReplacement($('event-type').value);
  const privateOnly=requiresPrivateVisibility($('event-type').value);
  $('visibility').querySelector('[value="public"]').disabled=privateOnly;
  if(privateOnly)$('visibility').value='private';
  $('visibility-restriction').hidden=!privateOnly;
  $('visibility').onchange();
  $('replacement-fields').hidden=!required;
  $('replacement-course').required=$('replacement-date').required=required;
  $('replacement-course').disabled=$('replacement-date').disabled=!required;
  $('title-field').hidden=$('english-fields').hidden=required;
  $('title').required=!required;$('title').disabled=$('title-en').disabled=required;
  updateCourseOptions();
  $('groups-hint').textContent=bt(required?'Për zëvendësim të mësimit, zgjidhni të paktën një grup të studentëve.':'Mund të zgjidhni një ose më shumë grupe. Pa përzgjedhje: pa grup të studentëve.');
  $('teachers-hint').textContent=bt(required?'Për zëvendësim të mësimit, zgjidhni të paktën një mësimdhënës.':'Mund të zgjidhni një ose më shumë mësimdhënës. Pa përzgjedhje: pa mësimdhënës.');
}
function filterChoices(kind) {
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sq').trim();
  const search = normalize($(`${kind}-search`).value);
  const labels = [...$(kind).querySelectorAll('label')];
  for (const label of labels) label.hidden = !normalize(label.textContent).includes(search)&&!normalize(label.dataset.sourceName||'').includes(search);
  const matches = labels.filter(label=>!label.hidden).length;
  const selected = $(kind).querySelectorAll('input:checked').length;
  $(`${kind}-results`).textContent = bt("{v0} · {v1} të përzgjedhur",{v0:matches ? bt("{v0} rezultate",{v0:matches}) : bt('Nuk u gjet asnjë rezultat.'),v1:selected});
}
for (const kind of ['groups','teachers']) {
  $(`${kind}-search`).addEventListener('input',()=>filterChoices(kind));
  $(kind).addEventListener('change',()=>{filterChoices(kind);if(kind==='groups')updateCourseOptions();});
}
$('login').onclick = async () => { $('login').disabled=true;try { await signInWithPopup(auth, provider); } catch(e) {message(errText(e),true);} finally {$('login').disabled=staffAccessState==='checking';} };
$('logout').onclick = async () => { try { await signOut(auth); } catch(e) {message(errText(e),true);} };
$('switch-account').onclick=$('logout').onclick;
$('retry-access').onclick=async()=>{
  const generation=authenticationGeneration;
  setStaffAccess('checking');message('');
  try { await loadApp(); }
  catch(e){if(generation===authenticationGeneration){if(staffAccessState!=='authorized')setStaffAccess(e.code==='permission-denied'?'denied':'unavailable');message(errText(e),true);}}
};
$('date').onchange = () => readAvailability().catch(e => message(errText(e),true));
$('room').onchange = () => { updateLocationField();readAvailability().catch(e => message(errText(e),true)); };
$('booking-form').onsubmit = createReservation;
$('event-type').onchange = updateParticipantRequirements;
$('stop-editing').onclick = stopEditing;
$('email-delivery-section').addEventListener('toggle',()=>{if($('email-delivery-section').open)readEmailDelivery();});
$('refresh-email-delivery').onclick=readEmailDelivery;
$('reservation-search').addEventListener('input',filterReservations);
$('refresh-requests').onclick=()=>readRequests().catch(e=>message(errText(e),true));
$('request-decision-form').onsubmit=event=>{
  event.preventDefault();
  if(event.submitter?.value!=='confirm')return $('request-decision-dialog').close('back');
  const reason=$('request-decision-reason').value.trim();
  if(!reason||reason.length>2000){$('request-decision-error').textContent=bt('Shkruani arsyen e vendimit (deri në 2000 karaktere).');return;}
  $('request-decision-dialog').close('confirm');
};
$('cancel-form').onsubmit = event => {
  event.preventDefault();
  if (event.submitter?.value !== 'cancel') { $('cancel-dialog').close('keep'); return; }
  const reason = $('cancel-reason').value.trim();
  if ($('cancel-reason').required && (!reason || reason.length > 2000)) {
    $('cancel-error').textContent = bt('Shkruani arsyen e anulimit (deri në 2000 karaktere).');
    $('cancel-reason').focus();
    return;
  }
  $('cancel-dialog').close('cancel');
};
$('visibility').onchange = () => {
  if(requiresPrivateVisibility($('event-type').value))$('visibility').value='private';
  $('description-en-field').hidden = $('email-notice').hidden = $('description-field').hidden = $('visibility').value !== 'public';
  $('description').required = $('visibility').value === 'public';
};
$('description').oninput = () => {
  const count = wordCount($('description').value);

  $('description-count').textContent = bt('{v0} / 100–500 fjalë',{v0:count});
  $('description-count').className = count < 100 || count > 500 ? 'error' : '';
};
$('description-en').oninput = () => {
 const count=wordCount($('description-en').value);
 $('description-en-count').textContent=count?bt('{v0} / 100–500 fjalë',{v0:count}):bt('Opsionale');
 $('description-en-count').className=count&&(count<100||count>500)?'error':'';
};
function updateLocationField(){ $('location-field').hidden=$('mode').value!=='physical'||$('room').value!==''; }
$('mode').onchange = () => { $('online-field').hidden = $('mode').value !== 'online';updateLocationField(); };
updateLocationField();
for (const id of ['from','through']) $(id).addEventListener('change', () => { $('selection-hint').textContent = ''; });
for(const id of ['requests-section','email-delivery-section','reservations-section'])$(id).hidden=!managementView;
if(managementView){
 $('reservation-entry').hidden=true;
 $('management-heading').hidden=false;
 $('booking-help').closest('section').hidden=true;
 document.querySelector('header h1').textContent='Rezervimet e mia';
 document.title='Rezervimet e mia | Universiteti i Prishtinës';
 for(const link of document.querySelectorAll('.rail-links a'))link.removeAttribute('aria-current');
 document.querySelector('[data-my-reservations]').setAttribute('aria-current','page');
}
if(classesView){
 $('booking-help-panel').hidden=true;
 document.querySelector('header h1').textContent='Anulimi i mësimit';
 document.title='Anulimi i mësimit | Universiteti i Prishtinës';
 for(const link of document.querySelectorAll('.rail-links a'))link.removeAttribute('aria-current');
 document.querySelector('[data-class-cancellations]').setAttribute('aria-current','page');
}
if(reportsView){
 $('booking-help').closest('section').hidden=true;
 document.querySelector('header h1').textContent='Statistika dhe raporte';
 document.title='Statistika dhe raporte | Universiteti i Prishtinës';
 for(const link of document.querySelectorAll('.rail-links a'))link.removeAttribute('aria-current');
 $('reports-link').setAttribute('aria-current','page');
}
function refreshLanguage(){
 auth.languageCode=getLanguage();provider.setCustomParameters({hl:getLanguage(),prompt:'select_account'});
 if(classesView){setStaffAccess(staffAccessState);$('reports-link').hidden=!canCancelAll;classesController?.render();return;}
 dateCalendar.render();
 setStaffAccess(staffAccessState);
 updateParticipantRequirements();
 for(const id of ['room','event-type'])for(const option of $(id).options)option.textContent=displayRoom(bt(option.dataset.sourceLabel||option.textContent));
 for(const kind of ['groups','teachers']){
  for(const label of $(kind).querySelectorAll('label'))if(label.dataset.sourceName)label.lastChild.textContent=kind==='groups'?displayGroup(label.dataset.sourceName):label.dataset.sourceName;
  filterChoices(kind);
 }
 for(const id of ['message','booking-message','selection-hint','cancel-question','cancel-error','request-decision-heading','request-decision-error','email-delivery-feedback','edit-notice'])$(id).textContent=bt($(id).textContent);
 if(reportsView){reportsController?.render();return;}
 if(currentUser&&settings?.bookingOpen){
  $('booking-heading').textContent=bt(editing?'Redaktoni rezervimin':'Rezervoni një aktivitet');
  $('management-scope').textContent=bt(canCancelAll?'Shfaqen kërkesat dhe rezervimet e të gjithë përdoruesve.':'Shfaqen vetëm kërkesat, njoftimet dhe rezervimet tuaja.');
  updateRequestHint();
  Promise.all([readAvailability(),readMyBookings(),readRequests(),$('email-delivery-section').open?readEmailDelivery():Promise.resolve()]).catch(e=>message(errText(e),true));
 }
 $('description').oninput();$('description-en').oninput();
 if(!$('booking-receipt').hidden&&lastReceipt)renderReceipt();
 if($('cancel-dialog').open&&cancellationPreviewData)$('cancel-question').textContent=bt('Ta anuloni rezervimin "{v0}" më {v1}?',{v0:localizedText(cancellationPreviewData).title,v1:displayDate(cancellationPreviewData.date)});
 if($('reservation-dialog').open&&confirmationData)renderConfirmation(confirmationData);
 if($('request-decision-dialog').open&&decisionPreviewData)$('request-decision-summary').textContent=requestDetails(decisionPreviewData);
}
initLanguage(refreshLanguage);
onAuthStateChanged(auth,async user => {
  authenticationGeneration++;
  reportsController?.dispose();reportsController=null;
  classesController?.dispose();classesController=null;$('class-cancellations').hidden=true;
  $('reports').hidden=true;$('reports-content').replaceChildren();$('reports-link').hidden=true;
  $('reports-feedback').textContent='';
  stopEditing();
  if($('reservation-dialog').open)$('reservation-dialog').close('back');
  if($('request-decision-dialog').open)$('request-decision-dialog').close('back');
  if(currentUser?.uid!==user?.uid){lastReceipt=null;confirmationData=null;decisionPreviewData=null;$('booking-receipt').hidden=true;}
  currentUser = user;
  canCancelAll = false;
  requiresApproval = false;
  $('login').hidden = Boolean(user);
  $('logout').hidden = !user;
  $('identity').textContent = user?.email || '';
  $('app').hidden = true;
  message('');
  setStaffAccess(user?'checking':'signedout');
  emailViewGeneration++;$('email-delivery-list').replaceChildren();$('email-delivery-feedback').textContent='';$('email-delivery-section').open=false;
  const generation=authenticationGeneration;
  if (user) try { await loadApp(); } catch(e){if(generation===authenticationGeneration){if(staffAccessState!=='authorized')setStaffAccess(e.code==='permission-denied'?'denied':'unavailable');message(errText(e),true);}}
});
