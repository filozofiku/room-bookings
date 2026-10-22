import { bookingRows } from './booking-model.js';

// Dynamic imports keep the official HTML timetable usable if Firebase cannot load.
export async function connectBookings(config, onDate, report) {
  const [{initializeApp}, {getFirestore, collection, doc, query, where, onSnapshot}] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js')
  ]);
  const db = getFirestore(initializeApp(config));
  let generation = 0;
  let unsubscribe = [];
  const selectDate = date => {
    const current = ++generation;
    unsubscribe.forEach(stop => stop());
    unsubscribe = [];
    report({status:'loading'});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const values = {};
    const emit = () => {
      if (current !== generation || Object.keys(values).length !== 4) return;
      if (Object.values(values).some(v => v.cached)) {
        report({status:'error', message:'Lidhja me rezervimet nuk është konfirmuar. Disponueshmëria nuk mund të verifikohet.'});
        return;
      }
      try {
        report({status:'ready', date, day:values.day.data, rooms:values.rooms.data,
          rows:bookingRows(values.bookings.data, values.rooms.data, values.periods.data)});
      } catch(error) { report({status:'error', message:error.message}); }
    };
    const listen = (key, ref, document = false) => unsubscribe.push(onSnapshot(ref, {includeMetadataChanges:true}, snap => {
      if (current !== generation) return;
      values[key] = {cached:snap.metadata.fromCache, data:document ? (snap.exists() ? snap.data() : null) : snap.docs.map(d => ({...d.data(), id:d.id}))};
      emit();
    }, error => {
      if (current !== generation) return;
      // Keep other listeners from restoring a misleading ready state.
      values[key] = {cached:true};
      report({status:'error', message:'Rezervimet nuk u ngarkuan. Provo rifreskimin e faqes.'});
      console.error('Public bookings:', error);
    }));
    listen('rooms', collection(db,'rooms'));
    listen('periods', collection(db,'periods'));
    listen('day', doc(db,'calendarDays',date), true);
    listen('bookings', query(collection(db,'publicBookings'),where('date','==',date)));
  };
  onDate(selectDate);
}
