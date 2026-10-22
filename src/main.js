import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase.js';

const $ = (id) => document.getElementById(id);
const provider = new GoogleAuthProvider();
let currentUser = null;
let rooms = [];
let periods = [];
let settings = null;
let occupied = new Map();
const errText = e => e?.message || String(e);
function message(text, isError = false) {
  $('message').textContent = text;
  $('message').className = isError ? 'error' : 'ok';
}
function slotId(date, roomId, periodId) {
  return `${date}__${roomId}__${periodId}`;
}
function selectedPeriodIds() {
  const from = periods.findIndex(p => p.id === $('from').value);
  const through = periods.findIndex(p => p.id === $('through').value);
  if (from < 0 || through < from || through - from > 3) {
    throw new Error('Choose 1–4 consecutive periods.');
  }
  return periods.slice(from, through + 1).map(p => p.id);
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
  if (!date || !roomId) return;
  const daySnap = await getDoc(doc(db,'calendarDays',date));
  if (!daySnap.exists()) throw new Error('Date not configured; ask administrator to import the semester.');
  const day = daySnap.data();
  const booked = await Promise.all(periods.map(p => getDoc(doc(db,'roomSlots',slotId(date,roomId,p.id)))));
  const weeklySnap = day.fetActive ? await getDoc(doc(db,'weeklyRooms',`${day.weekday}__${roomId}`)) : null;
  const weeklyData = weeklySnap?.exists() ? weeklySnap.data() : null;
  occupied = new Map(periods.map((p,i) => [p.id,
    !day.bookingAllowed ? {source:'closed'} :
    booked[i].exists() ? booked[i].data() :
    day.fetActive && weeklyData?.busyPeriods?.includes(p.id) ?
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
    state.textContent = busy ? (busy.source === 'closed' ? 'Closed date' : `Occupied (${busy.source === 'fet' ? 'FET class' : 'reservation'})`) : 'Available';
    item.append(time, state);
    $('slots').appendChild(item);
  });
}
async function readMyBookings() {
  if (!currentUser) return;
  const snap = await getDocs(query(collection(db, 'reservations'), where('ownerUid','==',currentUser.uid)));
  const sorted = snap.docs.sort((a,b) => a.data().date.localeCompare(b.data().date));
  const wrapper = $('my-reservations');
  wrapper.replaceChildren();
  if (!sorted.length) { wrapper.textContent = 'No reservations yet.'; return; }
  for (const item of sorted) {
    const data = item.data();
    const roomName = rooms.find(r => r.id === data.roomId)?.name || data.roomId;
    const div = document.createElement('div');
    div.className = 'slot';
    const description = document.createElement('span');
    description.append(safeText(`${data.date} · ${roomName} · ${data.title} · ${data.periodIds.join(', ')}`));
    const button = document.createElement('button');
    button.className = 'danger';
    button.textContent = 'Cancel';
    button.onclick = async () => {
      if (!confirm(`Cancel "${data.title}" on ${data.date}?`)) return;
      button.disabled = true;
      try {
        await cancelReservation(item.id);
        await Promise.all([readMyBookings(), readAvailability()]);
        message('Reservation cancelled.');
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
  const periodIds = selectedPeriodIds();
  if (!title) return message('Enter an event title.', true);
  if (date < settings.startDate || date > settings.endDate) return message('Date is outside the configured semester.',true);
  if (!settings.bookingOpen) return message('Booking is paused for a timetable import.',true);
  const reservationRef = doc(collection(db,'reservations'));
  const publicRef = doc(db,'publicBookings',reservationRef.id);
  const slotRefs = periodIds.map(p => doc(db,'roomSlots',slotId(date,roomId,p)));
  try {
    $('booking-form').querySelector('button').disabled = true;
    await runTransaction(db, async tx => {
      // Read all relevant documents first; writes must follow all transaction reads.
      // Reading settings also makes a concurrent administrative import fail/retry safely.
      const settingsRef = doc(db,'settings','control');
      const dayRef = doc(db,'calendarDays',date);
      const settingsSnap = await tx.get(settingsRef);
      const daySnap = await tx.get(dayRef);
      if (!settingsSnap.exists() || !settingsSnap.data().bookingOpen) throw new Error('Bookings are paused.');
      if (!daySnap.exists() || !daySnap.data().bookingAllowed) throw new Error('Bookings are closed for this date.');
      const day = daySnap.data();
      const weeklyRef = doc(db,'weeklyRooms',`${day.weekday}__${roomId}`);
      const slots = await Promise.all(slotRefs.map(ref=>tx.get(ref)));
      const weeklySnap = day.fetActive ? await tx.get(weeklyRef) : null;
      if (slots.some(s=>s.exists()) ||
          (weeklySnap?.exists() && weeklySnap.data().busyPeriods.some(p=>periodIds.includes(p)))) {
        throw new Error('One or more periods are occupied by a class or reservation.');
      }
      tx.set(reservationRef, { title, date, roomId, periodIds, ownerUid: currentUser.uid, createdAt: serverTimestamp() });
      tx.set(publicRef, {title, date, roomId, periodIds, creatorName:currentUser.displayName || 'Mësimdhënës', createdAt:serverTimestamp()});
      for (let i=0; i<periodIds.length; i++) {
        tx.set(slotRefs[i], { source:'booking', reservationId:reservationRef.id,
          ownerUid:currentUser.uid, date, roomId, periodId:periodIds[i] });
      }
    });
    $('title').value = '';
    message('Reservation created successfully.');
    await Promise.all([readAvailability(),readMyBookings()]);
  } catch (e) { message(errText(e),true); }
  finally { $('booking-form').querySelector('button').disabled = false; }
}
async function cancelReservation(id) {
  const reservationRef = doc(db,'reservations',id);
  await runTransaction(db, async tx => {
    const existing = await tx.get(reservationRef);
    if (!existing.exists()) throw new Error('Reservation no longer exists.');
    const booking = existing.data();
    if (booking.ownerUid !== currentUser.uid) throw new Error('Not your reservation.');
    const refs = booking.periodIds.map(p => doc(db,'roomSlots',slotId(booking.date,booking.roomId,p)));
    const slots = await Promise.all(refs.map(ref => tx.get(ref)));
    if (slots.some(s => !s.exists() || s.data().reservationId !== id)) throw new Error('Reservation data is inconsistent. Ask the administrator.');
    tx.delete(reservationRef);
    tx.delete(doc(db,'publicBookings',id));
    refs.forEach(ref => tx.delete(ref));
  });
}
async function loadApp() {
  const userSnap = await getDoc(doc(db,'users',currentUser.uid));
  if (!userSnap.exists() || !userSnap.data().active) {
    $('app').hidden = true;
    message(`Your Google account is signed in but not approved. Give the administrator this Firebase UID: ${currentUser.uid}`,true);
    return;
  }
  const [settingsSnap,roomSnap,periodSnap] = await Promise.all([
    getDoc(doc(db,'settings','control')),
    getDocs(collection(db,'rooms')),
    getDocs(collection(db,'periods'))
  ]);
  if (!settingsSnap.exists()) throw new Error('Administrator must import the timetable first.');
  settings = settingsSnap.data();
  rooms = roomSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name));
  periods = periodSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id));
  fillOptions($('room'),rooms,r=>r.id,r=>r.name);
  fillOptions($('from'),periods,p=>p.id,p=>p.label);
  fillOptions($('through'),periods,p=>p.id,p=>p.label);
  const dayParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Belgrade',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const localToday = `${dayParts.year}-${dayParts.month}-${dayParts.day}`;
  $('date').value = localToday >= settings.startDate && localToday <= settings.endDate ? localToday : settings.startDate;
  $('date').min = settings.startDate;
  $('date').max = settings.endDate;
  $('app').hidden = false;
  message(settings.bookingOpen ? 'Signed in and ready.' : 'Booking temporarily paused for a timetable import.');
  await Promise.all([readAvailability(), readMyBookings()]);
}
$('login').onclick = async () => { try { await signInWithPopup(auth, provider); } catch(e) {message(errText(e),true);} };
$('logout').onclick = async () => { await signOut(auth); };
$('date').onchange = () => readAvailability().catch(e => message(errText(e),true));
$('room').onchange = () => readAvailability().catch(e => message(errText(e),true));
$('booking-form').onsubmit = createReservation;
onAuthStateChanged(auth,async user => {
  currentUser = user;
  $('login').hidden = Boolean(user);
  $('logout').hidden = !user;
  $('identity').textContent = user?.email || '';
  $('app').hidden = true;
  if (user) try { await loadApp(); } catch(e){message(errText(e),true);}
  else message('Sign in with your Google account to view availability and reserve rooms.');
});
