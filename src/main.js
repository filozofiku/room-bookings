import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp } from 'firebase/firestore';
import { BookingError, selectPeriods, reservationTime, errorText, MAX_PERIODS } from './booking-ui.js';
import { EVENT_TYPES, slotKeys, conflictMessage } from './booking-resources.js';
import { auth, db } from './firebase.js';

const $ = (id) => document.getElementById(id);
const provider = new GoogleAuthProvider();
auth.languageCode = 'sq';
provider.setCustomParameters({hl:'sq'});
let currentUser = null;
let rooms = [];
let periods = [];
let settings = null;
let catalog = null;
let occupied = new Map();
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
function confirmCancellation(data) {
  const dialog = $('cancel-dialog');
  $('cancel-question').textContent = `Ta anuloni rezervimin "${data.title}" më ${data.date}?`;
  dialog.returnValue = 'keep';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'cancel'), {once:true});
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
async function readMyBookings() {
  if (!currentUser) return;
  const snap = await getDocs(query(collection(db, 'reservations'), where('ownerUid','==',currentUser.uid)));
  const sorted = snap.docs.sort((a,b) => a.data().date.localeCompare(b.data().date));
  const wrapper = $('my-reservations');
  wrapper.replaceChildren();
  if (!sorted.length) { wrapper.textContent = 'Ende nuk keni rezervime.'; return; }
  for (const item of sorted) {
    const data = item.data();
    const roomName = rooms.find(r => r.id === data.roomId)?.name || data.roomId || 'Pa sallë';
    const div = document.createElement('div');
    div.className = 'slot';
    const description = document.createElement('span');
    description.append(safeText(`${data.date} · ${roomName} · ${data.title} · ${reservationTime(data.periodIds, periods)}`));
    const button = document.createElement('button');
    button.className = 'danger';
    button.textContent = 'Anuloni';
    button.onclick = async () => {
      if (!await confirmCancellation(data)) return;
      button.disabled = true;
      try {
        await cancelReservation(item.id);
        await Promise.all([readMyBookings(), readAvailability()]);
        message('Rezervimi u anulua.');
      } catch(e) { message(errText(e), true); button.disabled = false; }
    };
    div.append(description,button);
    wrapper.appendChild(div);
  }
}
async function createReservation(event) {
  event.preventDefault();
  if (!currentUser) return;
  const date = $('date').value;
  const roomId = $('room').value;
  const title = $('title').value.trim();
  let periodIds;
  try { periodIds = selectedPeriodIds(); } catch(e) { return message(errText(e),true); }
  if (!title) return message('Shkruani titullin e aktivitetit.', true);
  if (date < settings.startDate || date > settings.endDate) return message('Data është jashtë semestrit të konfiguruar.',true);
  if (!settings.bookingOpen) return message('Rezervimet janë pezulluar gjatë përditësimit të orarit.',true);
  const onlineUrl = $('mode').value === 'online' ? $('online-url').value.trim() : '';
  if ($('mode').value === 'online') {
    try { if (!/^https?:$/.test(new URL(onlineUrl).protocol) || onlineUrl.length > 2000) throw Error(); }
    catch { return message('Vendosni një link të vlefshëm që fillon me https:// ose http://.', true); }
  }
  const checked = id => [...$(id).querySelectorAll('input:checked')].map(input => input.value);
  const data = {title, date, roomId, periodIds, groupIds:checked('groups'), teacherIds:checked('teachers'),
    eventType:$('event-type').value, isPublic:$('visibility').value === 'public', mode:$('mode').value, onlineUrl,
    creatorName:currentUser.displayName || 'Mësimdhënës'};
  const reservationRef = doc(collection(db,'reservations'));
  const publicRef = doc(db,'publicBookings',reservationRef.id);
  const occupancyRef = doc(db,'eventDays',date);
  try {
    $('booking-form').querySelector('button').disabled = true;
    await runTransaction(db, async tx => {
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
      tx.set(reservationRef, {...data, ownerUid:currentUser.uid, createdAt:serverTimestamp()});
      tx.set(publicRef, {...data, createdAt:serverTimestamp()});
      const keys = slotKeys(data);
      for (const key of keys) locks[key] = reservationRef.id;
      if (keys.length) tx.set(occupancyRef, {bookings:locks, changedReservationId:reservationRef.id});
    });
    $('title').value = '';
    message('Rezervimi u krijua me sukses.');
    await Promise.all([readAvailability(),readMyBookings()]);
  } catch (e) { message(errText(e),true); }
  finally { $('booking-form').querySelector('button').disabled = false; }
}
async function cancelReservation(id) {
  const reservationRef = doc(db,'reservations',id);
  await runTransaction(db, async tx => {
    const existing = await tx.get(reservationRef);
    if (!existing.exists()) throw new BookingError('Rezervimi nuk ekziston më.');
    const booking = existing.data();
    if (booking.ownerUid !== currentUser.uid) throw new BookingError('Ky rezervim nuk ju përket juve.');
    const occupancyRef = doc(db,'eventDays',booking.date);
    const occupancy = await tx.get(occupancyRef);
    const locks = occupancy.exists() ? {...occupancy.data().bookings} : {};
    if (slotKeys(booking).some(p => locks[p] !== id)) throw new BookingError('Të dhënat e rezervimit nuk përputhen. Kontaktoni administratorin.');
    slotKeys(booking).forEach(p => delete locks[p]);
    if (slotKeys(booking).length) tx.set(occupancyRef, {bookings:locks, changedReservationId:id});
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
  await Promise.all([readAvailability(), readMyBookings()]);
}
$('login').onclick = async () => { try { await signInWithPopup(auth, provider); } catch(e) {message(errText(e),true);} };
$('logout').onclick = async () => { try { await signOut(auth); } catch(e) {message(errText(e),true);} };
$('date').onchange = () => readAvailability().catch(e => message(errText(e),true));
$('room').onchange = () => readAvailability().catch(e => message(errText(e),true));
$('booking-form').onsubmit = createReservation;
$('visibility').onchange = () => { $('email-notice').hidden = $('visibility').value !== 'public'; };
$('mode').onchange = () => { $('online-field').hidden = $('mode').value !== 'online'; };
for (const id of ['from','through']) $(id).addEventListener('change', () => { $('selection-hint').textContent = ''; });
onAuthStateChanged(auth,async user => {
  currentUser = user;
  $('login').hidden = Boolean(user);
  $('logout').hidden = !user;
  $('identity').textContent = user?.email || '';
  $('app').hidden = true;
  if (user) try { await loadApp(); } catch(e){message(errText(e),true);}
  else message('Hyni me llogarinë tuaj Google për të parë disponueshmërinë dhe për të rezervuar salla.');
});
