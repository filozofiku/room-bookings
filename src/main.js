import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp } from 'firebase/firestore';
import { BookingError, selectPeriods, reservationTime, errorText, MAX_PERIODS } from './booking-ui.js';
import { EVENT_TYPES, slotKeys, conflictMessage, wordCount } from './booking-resources.js';
import {updateReservation} from './update-reservation.js';
import {isSpecialRoom,submitReservationRequest,decideReservationRequest} from './reservation-requests.js';
import { auth, db } from './firebase.js';

const $ = (id) => document.getElementById(id);
const provider = new GoogleAuthProvider();
auth.languageCode = 'sq';
provider.setCustomParameters({hl:'sq'});
let currentUser = null;
let canCancelAll = false;
let rooms = [];
let periods = [];
let settings = null;
let catalog = null;
let occupied = new Map();
let editing = null;
const errText = errorText;
function message(text, isError = false) {
  $('message').textContent = text;
  $('message').className = isError ? 'error' : 'ok';
}
function selectedPeriodIds() {
  return selectPeriods(periods, $('from').value, $('through').value);
}
function prepareReservation(period) {
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
    `Ora e përfundimit u vendos në ${through.end}, sipas periudhave të orarit. Mund ta ndryshoni para rezervimit.`;
  $('booking-form').scrollIntoView({behavior:'smooth', block:'start'});
  $('title').focus({preventScroll:true});
}
function confirmReservation(data) {
  const dialog = $('reservation-dialog');
  const requestOnly=!editing&&!canCancelAll&&isSpecialRoom(data.roomId);
  $('reservation-heading').textContent=editing?'Konfirmoni ndryshimet':requestOnly?'Konfirmoni kërkesën për rezervim':'Konfirmoni rezervimin';
  dialog.querySelector('[value=confirm]').textContent=editing?'Konfirmo ndryshimet':requestOnly?'Dërgo kërkesën':'Konfirmo rezervimin';
  const summary = $('reservation-summary');
  summary.replaceChildren();
  const fields = [
    ['Titulli',data.title], ['Lloji i aktivitetit',data.eventType],
    ['Data',data.date], ['Ora',reservationTime(data.periodIds,periods)],
    ['Salla',rooms.find(room=>room.id===data.roomId)?.name || 'Pa sallë'],
    ['Grupet e studentëve',data.groupIds.map(id=>catalog.groups[id] || id).join(', ') || 'Pa grup të studentëve'],
    ['Mësimdhënësit',data.teacherIds.map(id=>catalog.teachers[id] || id).join(', ') || 'Pa mësimdhënës'],
    ['Njoftimi për aktivitetin',data.isPublic ? 'Publik — email 24 orë para fillimit, ose në ekzekutimin e parë nëse mbeten më pak se 24 orë' : 'Jo publik'],
    ['Mënyra e zhvillimit',data.mode==='online' ? 'Online' : 'Fizik'],
    ['Rezervuar nga',data.creatorName]
  ];
  if(requestOnly)fields.push(['Miratimi','Kërkesa nuk rezervon sallën. Rezervimi dhe njoftimet publike bëhen vetëm pas miratimit.']);
  if(data.onlineUrl)fields.push(['Linku i ngjarjes online',data.onlineUrl]);
  if(data.description)fields.push(['Përshkrimi',data.description]);
  for(const [label,value] of fields){
    const term=document.createElement('dt'),detail=document.createElement('dd');
    term.textContent=label;term.style.fontWeight='600';
    detail.textContent=value;detail.style.margin='0 0 .75rem';
    summary.append(term,detail);
  }
  dialog.returnValue='back';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});
    dialog.showModal();
  });
}
function confirmCancellation(data) {
  const dialog = $('cancel-dialog');
  $('cancel-question').textContent = `Ta anuloni rezervimin "${data.title}" më ${data.date}?`;
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
    option.textContent = getLabel(v);
    element.appendChild(option);
  }
}
async function readAvailability() {
  if (!currentUser || !rooms.length) return;
  updateRequestHint();
  const date = $('date').value;
  const roomId = $('room').value;
  if (!date) return;
  if (!roomId) { $('slots').textContent = 'Pa sallë të përzgjedhur.'; return; }
  const daySnap = await getDoc(doc(db,'calendarDays',date));
  if (!daySnap.exists()) throw new BookingError('Data nuk është konfiguruar. Kontaktoni administratorin për importimin e semestrit.');
  const day = daySnap.data();
  const booked = await getDoc(doc(db,'eventDays',date));
  const locks = booked.exists() ? booked.data().bookings : {};
  const weeklySnap = day.fetActive ? await getDoc(doc(db,'weeklyResources',String(day.weekday))) : null;
  const weeklyData = weeklySnap?.exists() ? weeklySnap.data() : null;
  occupied = new Map(periods.map((p,i) => [p.id,
    !day.bookingAllowed ? {source:'closed'} :
    locks[`${roomId}__${p.id}`] ? {source:'booking'} :
    day.fetActive && weeklyData?.busyKeys?.includes(`${roomId}__${p.id}`) ?
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
    state.textContent = busy ? (busy.source === 'closed' ? 'Data është e mbyllur' : busy.source === 'fet' ? 'Mësim sipas orarit' : 'E rezervuar') : 'Salla e lirë';
    item.append(time, state);
    if (!busy) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reserve-from';
      button.textContent = 'Rezervo nga kjo orë';
      button.setAttribute('aria-label', `Rezervo nga kjo orë: ${p.start}`);
      button.onclick = () => prepareReservation(p);
      item.appendChild(button);
    }
    $('slots').appendChild(item);
  });
}
function stopEditing() {
  editing=null;
  $('edit-banner').hidden=true;
  $('booking-heading').textContent='Rezervoni një aktivitet';
  $('booking-form').querySelector('button').textContent='Bëni rezervimin';
  $('title').value='';
  $('booking-message').textContent='';
  updateRequestHint();
}
function startEditing(id,data) {
  editing={id,data,revision:data.revision||0};
  $('date').value=data.date;$('room').value=data.roomId;
  $('title').value=data.title;$('event-type').value=data.eventType||EVENT_TYPES[0];
  $('from').value=data.periodIds[0];$('through').value=data.periodIds.at(-1);
  $('visibility').value=data.isPublic?'public':'private';$('visibility').onchange();
  $('mode').value=data.mode||'physical';$('mode').onchange();
  $('online-url').value=data.onlineUrl||'';$('description').value=data.description||'';$('description').oninput();
  for(const [kind,ids] of [['groups',data.groupIds||[]],['teachers',data.teacherIds||[]]]){
    $(`${kind}-search`).value='';
    for(const input of $(kind).querySelectorAll('input'))input.checked=ids.includes(input.value);
    filterChoices(kind);
  }
  $('booking-heading').textContent='Redaktoni rezervimin';
  $('booking-form').querySelector('button').textContent='Ruani ndryshimet';
  $('edit-banner').hidden=false;
  $('edit-notice').textContent=data.ownerUid===currentUser.uid?'Po redaktoni rezervimin tuaj.':'Po redaktoni rezervimin e një përdoruesi tjetër. Krijuesi do të njoftohet me email për ndryshimet.';
  $('booking-message').textContent='';$('selection-hint').textContent='';
  readAvailability().catch(e=>message(errText(e),true));
  $('booking-heading').scrollIntoView({behavior:'smooth'});
}
function updateRequestHint() {
  const special=!canCancelAll&&isSpecialRoom($('room').value);
  $('request-hint').hidden=!special;
  $('request-hint').textContent=editing
    ? 'Për ndryshimin e sallës, datës, orës ose pjesëmarrësve të një rezervimi në sallë të posaçme nevojitet një kërkesë e re. Rezervimi ekzistues mbetet në fuqi.'
    : 'Kjo sallë kërkon miratim. Kërkesa nuk e zë sallën dhe nuk shfaqet në orarin publik deri në miratim.';
  $('booking-form').querySelector('button').textContent=editing?'Ruani ndryshimet':special?'Dërgoni kërkesën për rezervim':'Bëni rezervimin';
}
function requestDetails(data) {
  const lines=[`${data.date} · ${rooms.find(r=>r.id===data.roomId)?.name||data.roomId} · ${reservationTime(data.periodIds,periods)}`,data.title,
    `Kërkuesi: ${data.creatorName}`,`Lloji: ${data.eventType}`,
    `Grupet: ${data.groupIds.map(id=>catalog.groups[id]||id).join(', ')||'Pa grup'}`,
    `Mësimdhënësit: ${data.teacherIds.map(id=>catalog.teachers[id]||id).join(', ')||'Pa mësimdhënës'}`,
    `Njoftimi: ${data.isPublic?'Publik':'Jo publik'} · ${data.mode==='online'?'Online':'Fizik'}`];
  if(data.onlineUrl)lines.push(data.onlineUrl);
  if(data.description)lines.push(data.description);
  return lines.join('\n');
}
function confirmRequestDecision(data,outcome) {
  $('request-decision-heading').textContent=outcome==='approved'?'Miratoni kërkesën':'Refuzoni kërkesën';
  $('request-decision-summary').textContent=requestDetails(data);
  $('request-decision-reason').value='';$('request-decision-error').textContent='';
  const dialog=$('request-decision-dialog');dialog.returnValue='back';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'?$('request-decision-reason').value.trim():null),{once:true});
    dialog.showModal();
  });
}
async function readRequests() {
  if(!currentUser)return;
  const own=path=>canCancelAll?collection(db,path):query(collection(db,path),where(path==='requestDecisions'?'booking.ownerUid':'ownerUid','==',currentUser.uid));
  const [pending,decisions]=await Promise.all([getDocs(own('reservationRequests')),getDocs(own('requestDecisions'))]);
  $('requests-heading').textContent=canCancelAll?'Kërkesat për miratim':'Kërkesat e mia';
  const wrapper=$('reservation-requests');wrapper.replaceChildren();
  if(!pending.docs.length)wrapper.textContent='Nuk ka kërkesa në pritje.';
  for(const item of pending.docs.sort((a,b)=>a.data().date.localeCompare(b.data().date))){
    const data=item.data(),card=document.createElement('div');card.className='request-card';
    const details=document.createElement('p');details.style.whiteSpace='pre-wrap';details.textContent=requestDetails(data)+'\nNë pritje të miratimit';card.append(details);
    const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.style.whiteSpace='pre-wrap';
    if(canCancelAll)for(const [outcome,label] of [['approved','Miratoni'],['rejected','Refuzoni']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.className=outcome==='rejected'?'danger':'';
      button.onclick=async()=>{
        const reason=await confirmRequestDecision(data,outcome);if(reason===null)return;
        card.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{
          await decideReservationRequest(db,item.id,outcome,reason,currentUser);
          await Promise.all([readRequests(),readMyBookings(),readAvailability()]);
          message(outcome==='approved'?'Kërkesa u miratua dhe rezervimi u publikua.':'Kërkesa u refuzua dhe u fshi.');
        }catch(e){feedback.textContent=errText(e);feedback.className='error';card.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };card.append(button,document.createTextNode(' '));
    }
    card.append(feedback);wrapper.append(card);
  }
  const history=$('request-decisions');history.replaceChildren();
  for(const item of decisions.docs.sort((a,b)=>(b.data().createdAt?.seconds||0)-(a.data().createdAt?.seconds||0))){
    const d=item.data(),p=document.createElement('p');p.style.whiteSpace='pre-wrap';
    p.textContent=`${d.booking.date} · ${d.booking.title} · ${d.outcome==='approved'?'Miratuar':'Refuzuar'}\n${d.deciderName}: ${d.reason}`;history.append(p);
  }
}
async function readMyBookings() {
  if (!currentUser) return;
  const reservations = collection(db, 'reservations');
  const snap = await getDocs(canCancelAll ? reservations : query(reservations, where('ownerUid','==',currentUser.uid)));
  $('reservations-heading').textContent = canCancelAll ? 'Të gjitha rezervimet' : 'Rezervimet e mia';
  const sorted = snap.docs.sort((a,b) => a.data().date.localeCompare(b.data().date));
  const wrapper = $('my-reservations');
  wrapper.replaceChildren();
  if (!sorted.length) { wrapper.textContent = canCancelAll ? 'Ende nuk ka rezervime.' : 'Ende nuk keni rezervime.'; return; }
  for (const item of sorted) {
    const data = item.data();
    const roomName = rooms.find(r => r.id === data.roomId)?.name || data.roomId || 'Pa sallë';
    const div = document.createElement('div');
    div.className = 'slot';
    const description = document.createElement('span');
    description.append(safeText(`${data.date} · ${roomName} · ${data.title} · ${reservationTime(data.periodIds, periods)}`));
    if (canCancelAll) description.append(safeText(` · Rezervuar nga: ${data.creatorName || (data.ownerUid === currentUser.uid ? currentUser.displayName : '') || 'Emri nuk është i disponueshëm'}`));
    const button = document.createElement('button');
    button.className = 'danger';
    button.textContent = 'Anuloni';
    button.onclick = async () => {
      const confirmation = await confirmCancellation(data);
      if (!confirmation.confirmed) return;
      button.disabled = true;
      try {
        await cancelReservation(item.id, confirmation.reason);
        await Promise.all([readMyBookings(), readAvailability()]);
        message(data.ownerUid === currentUser.uid ? 'Rezervimi u anulua.' : 'Rezervimi u anulua. Njoftimi me email është në pritje të dërgimit.');
      } catch(e) { message(errText(e), true); button.disabled = false; }
    };
    const edit=document.createElement('button');
    edit.type='button';edit.className='secondary';edit.textContent='Redaktoni';
    edit.onclick=()=>startEditing(item.id,data);
    div.append(description,edit,button);
    wrapper.appendChild(div);
  }
}
function bookingMessage(text, isError = false) {
  message(text, isError);
  const feedback = $('booking-message');
  feedback.textContent = text;
  feedback.className = isError ? 'error' : 'ok';
  feedback.scrollIntoView({block:'nearest'});
}
async function createReservation(event) {
  event.preventDefault();
  $('booking-message').textContent = '';
  if (!currentUser || $('reservation-dialog').open || $('booking-form').querySelector('button').disabled) return;
  const edit=editing;
  const date = $('date').value;
  const roomId = $('room').value;
  const title = $('title').value.trim();
  let periodIds;
  try { periodIds = selectedPeriodIds(); } catch(e) { return bookingMessage(errText(e),true); }
  if (!title) return bookingMessage('Shkruani titullin e aktivitetit.', true);
  if (date < settings.startDate || date > settings.endDate) return bookingMessage('Data është jashtë semestrit të konfiguruar.',true);
  if (!settings.bookingOpen) return bookingMessage('Rezervimet janë pezulluar gjatë përditësimit të orarit.',true);
  const onlineUrl = $('mode').value === 'online' ? $('online-url').value.trim() : '';
  if ($('mode').value === 'online') {
    try { if (!/^https?:$/.test(new URL(onlineUrl).protocol) || onlineUrl.length > 2000) throw Error(); }
    catch { return bookingMessage('Vendosni një link të vlefshëm që fillon me https:// ose http://.', true); }
  }
  const description = $('visibility').value === 'public' ? $('description').value.trim().replace(/\s+/gu, ' ') : '';
  if (wordCount(description) > 500) return bookingMessage('Përshkrimi i aktivitetit nuk mund të ketë më shumë se 500 fjalë.', true);
  const checked = id => [...$(id).querySelectorAll('input:checked')].map(input => input.value);
  const data = {title, date, roomId, periodIds, description, groupIds:checked('groups'), teacherIds:checked('teachers'),
    eventType:$('event-type').value, isPublic:$('visibility').value === 'public', mode:$('mode').value, onlineUrl,
    creatorName:edit?.data.creatorName || currentUser.displayName || 'Mësimdhënës'};
  if(edit && Object.entries(data).every(([key,value])=>JSON.stringify(value)===JSON.stringify(edit.data[key] ?? (Array.isArray(value)?[]:typeof value==='boolean'?false:'')))) {
    return bookingMessage('Nuk keni bërë ndryshime.');
  }
  const requestOnly=!edit&&!canCancelAll&&isSpecialRoom(roomId);
  if(edit&&!canCancelAll&&isSpecialRoom(roomId)&&['date','roomId','periodIds','groupIds','teacherIds'].some(key=>JSON.stringify(data[key])!==JSON.stringify(edit.data[key]||[])))return bookingMessage('Ky ndryshim kërkon miratim. Hiqni dorë nga redaktimi dhe dërgoni një kërkesë të re; rezervimi ekzistues mbetet në fuqi.',true);
  const ownerUid=currentUser.uid;
  const reservationRef = doc(collection(db,'reservations'));
  const publicRef = doc(db,'publicBookings',reservationRef.id);
  const occupancyRef = doc(db,'eventDays',date);
  try {
    $('booking-form').querySelector('button').disabled = true;
    if(!await confirmReservation(data))return;
    if(currentUser?.uid!==ownerUid)throw new BookingError('Llogaria ndryshoi. Provoni përsëri.');
    if(edit) {
      await updateReservation(db,edit.id,edit.revision,data,currentUser);
    } else if(requestOnly) {
      await submitReservationRequest(db,data,currentUser);
    } else await runTransaction(db, async tx => {
      // Read all relevant documents first; writes must follow all transaction reads.
      // Reading settings also makes a concurrent administrative import fail/retry safely.
      const settingsRef = doc(db,'settings','control');
      const dayRef = doc(db,'calendarDays',date);
      const settingsSnap = await tx.get(settingsRef);
      const daySnap = await tx.get(dayRef);
      if (!settingsSnap.exists() || !settingsSnap.data().bookingOpen || settingsSnap.data().slotStorage !== 'resources-v2') throw new BookingError('Rezervimet janë pezulluar.');
      if (!daySnap.exists() || !daySnap.data().bookingAllowed) throw new BookingError('Rezervimet janë të mbyllura për këtë datë.');
      const day = daySnap.data();
      const weeklyRef = doc(db,'weeklyResources',String(day.weekday));
      const occupancy = await tx.get(occupancyRef);
      const locks = occupancy.exists() ? {...occupancy.data().bookings} : {};
      const weeklySnap = day.fetActive ? await tx.get(weeklyRef) : null;
      const conflict = conflictMessage(data, locks, weeklySnap?.exists() ? weeklySnap.data().busyKeys : []);
      if (conflict) throw new BookingError(conflict);
      tx.set(reservationRef, {...data, ownerUid, createdAt:serverTimestamp()});
      tx.set(publicRef, {...data, createdAt:serverTimestamp()});
      const keys = slotKeys(data);
      for (const key of keys) locks[key] = reservationRef.id;
      if (keys.length) tx.set(occupancyRef, {bookings:locks, changedReservationId:reservationRef.id});
    });
    $('title').value = '';
    $('description').value = '';
    $('description-count').textContent = '0 / 500 fjalë';
    if(edit)stopEditing();
    bookingMessage(edit ? (edit.data.ownerUid===ownerUid?'Rezervimi u ndryshua me sukses.':'Rezervimi u ndryshua. Njoftimi me email është në pritje të dërgimit.') : requestOnly?'Kërkesa u dërgua për miratim. Salla ende nuk është rezervuar.':'Rezervimi u krijua me sukses.');
    await Promise.all([readAvailability(),readMyBookings(),readRequests()]);
  } catch (e) { bookingMessage(errText(e),true); }
  finally { $('booking-form').querySelector('button').disabled = false; }
}
async function cancelReservation(id, reason = '') {
  const reservationRef = doc(db,'reservations',id);
  await runTransaction(db, async tx => {
    const existing = await tx.get(reservationRef);
    if (!existing.exists()) throw new BookingError('Rezervimi nuk ekziston më.');
    const booking = existing.data();
    if (!canCancelAll && booking.ownerUid !== currentUser.uid) throw new BookingError('Ky rezervim nuk ju përket juve.');
    const otherOwner = booking.ownerUid !== currentUser.uid;
    if (otherOwner && (!reason.trim() || reason.length > 2000)) throw new BookingError('Shkruani arsyen e anulimit (deri në 2000 karaktere).');
    const occupancyRef = doc(db,'eventDays',booking.date);
    const occupancy = await tx.get(occupancyRef);
    const locks = occupancy.exists() ? {...occupancy.data().bookings} : {};
    if (slotKeys(booking).some(p => locks[p] !== id)) throw new BookingError('Të dhënat e rezervimit nuk përputhen. Kontaktoni administratorin.');
    slotKeys(booking).forEach(p => delete locks[p]);
    if (slotKeys(booking).length) tx.set(occupancyRef, {bookings:locks, changedReservationId:id});
    if (otherOwner) tx.set(doc(db,'cancellationNotifications',id), {booking,reason:reason.trim(),cancelledBy:currentUser.uid,createdAt:serverTimestamp(),status:'pending'});
    tx.delete(reservationRef);
    tx.delete(doc(db,'publicBookings',id));
  });
}
async function loadApp() {
  const userSnap = await getDoc(doc(db,'users',currentUser.uid));
  if (!userSnap.exists() || !userSnap.data().active) {
    $('app').hidden = true;
    message(`Keni hyrë me llogarinë Google, por ajo ende nuk është miratuar. Dërgojani administratorit këtë identifikues të llogarisë: ${currentUser.uid}`,true);
    return;
  }
  canCancelAll = userSnap.data().canCancelAll === true;
  const [settingsSnap,roomSnap,periodSnap,catalogSnap] = await Promise.all([
    getDoc(doc(db,'settings','control')),
    getDocs(collection(db,'rooms')),
    getDocs(collection(db,'periods')),
    getDoc(doc(db,'resourceCatalog','current'))
  ]);
  if (!settingsSnap.exists()) throw new BookingError('Administratori duhet të importojë fillimisht orarin.');
  settings = settingsSnap.data();
  if (settings.slotStorage !== 'resources-v2') throw new BookingError('Rezervimet po përditësohen. Provoni përsëri së shpejti.');
  rooms = roomSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name));
  periods = periodSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id));
  if (!catalogSnap.exists()) throw new BookingError('Orari i grupeve dhe i mësimdhënësve nuk është konfiguruar.');
  catalog = catalogSnap.data();
  fillOptions($('room'),[{id:'',name:'Pa sallë'},...rooms],r=>r.id,r=>r.name);
  if (rooms.length) $('room').value = rooms[0].id;
  fillOptions($('event-type'),EVENT_TYPES,t=>t,t=>t);
  for (const kind of ['groups','teachers']) {
    $(kind).replaceChildren();
    for (const [id,name] of Object.entries(catalog[kind]).sort((a,b)=>a[1].localeCompare(b[1],'sq'))) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = id;
      label.append(input, safeText(name)); $(kind).appendChild(label);
    }
    filterChoices(kind);
  }
  fillOptions($('from'),periods,p=>p.id,p=>p.start);
  fillOptions($('through'),periods,p=>p.id,p=>p.end);
  const dayParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Tirane',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const localToday = `${dayParts.year}-${dayParts.month}-${dayParts.day}`;
  $('date').value = localToday >= settings.startDate && localToday <= settings.endDate ? localToday : settings.startDate;
  $('date').min = settings.startDate;
  $('date').max = settings.endDate;
  $('app').hidden = false;
  message(settings.bookingOpen ? 'Keni hyrë me sukses. Mund të rezervoni një sallë.' : 'Rezervimet janë pezulluar përkohësisht gjatë përditësimit të orarit.');
  await Promise.all([readAvailability(), readMyBookings(), readRequests()]);
}
function filterChoices(kind) {
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sq').trim();
  const search = normalize($(`${kind}-search`).value);
  const labels = [...$(kind).querySelectorAll('label')];
  for (const label of labels) label.hidden = !normalize(label.textContent).includes(search);
  const matches = labels.filter(label=>!label.hidden).length;
  const selected = $(kind).querySelectorAll('input:checked').length;
  $(`${kind}-results`).textContent = `${matches ? `${matches} rezultate` : 'Nuk u gjet asnjë rezultat.'} · ${selected} të përzgjedhur`;
}
for (const kind of ['groups','teachers']) {
  $(`${kind}-search`).addEventListener('input',()=>filterChoices(kind));
  $(kind).addEventListener('change',()=>filterChoices(kind));
}
$('login').onclick = async () => { try { await signInWithPopup(auth, provider); } catch(e) {message(errText(e),true);} };
$('logout').onclick = async () => { try { await signOut(auth); } catch(e) {message(errText(e),true);} };
$('date').onchange = () => readAvailability().catch(e => message(errText(e),true));
$('room').onchange = () => readAvailability().catch(e => message(errText(e),true));
$('booking-form').onsubmit = createReservation;
$('stop-editing').onclick = stopEditing;
$('refresh-requests').onclick=()=>readRequests().catch(e=>message(errText(e),true));
$('request-decision-form').onsubmit=event=>{
  event.preventDefault();
  if(event.submitter?.value!=='confirm')return $('request-decision-dialog').close('back');
  const reason=$('request-decision-reason').value.trim();
  if(!reason||reason.length>2000){$('request-decision-error').textContent='Shkruani arsyen e vendimit (deri në 2000 karaktere).';return;}
  $('request-decision-dialog').close('confirm');
};
$('cancel-form').onsubmit = event => {
  event.preventDefault();
  if (event.submitter?.value !== 'cancel') { $('cancel-dialog').close('keep'); return; }
  const reason = $('cancel-reason').value.trim();
  if ($('cancel-reason').required && (!reason || reason.length > 2000)) {
    $('cancel-error').textContent = 'Shkruani arsyen e anulimit (deri në 2000 karaktere).';
    $('cancel-reason').focus();
    return;
  }
  $('cancel-dialog').close('cancel');
};
$('visibility').onchange = () => {
  $('email-notice').hidden = $('description-field').hidden = $('visibility').value !== 'public';
};
$('description').oninput = () => {
  const count = wordCount($('description').value);
  $('description-count').textContent = `${count} / 500 fjalë`;
  $('description-count').className = count > 500 ? 'error' : '';
};
$('mode').onchange = () => { $('online-field').hidden = $('mode').value !== 'online'; };
for (const id of ['from','through']) $(id).addEventListener('change', () => { $('selection-hint').textContent = ''; });
onAuthStateChanged(auth,async user => {
  stopEditing();
  if($('reservation-dialog').open)$('reservation-dialog').close('back');
  if($('request-decision-dialog').open)$('request-decision-dialog').close('back');
  currentUser = user;
  canCancelAll = false;
  $('login').hidden = Boolean(user);
  $('logout').hidden = !user;
  $('identity').textContent = user?.email || '';
  $('app').hidden = true;
  if (user) try { await loadApp(); } catch(e){message(errText(e),true);}
  else message('Hyni me llogarinë tuaj Google për të parë disponueshmërinë dhe për të rezervuar salla.');
});
