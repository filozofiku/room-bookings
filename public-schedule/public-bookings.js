import {bookingRows,weekDates} from './booking-model.js';

// Keep public updates live, but subscribe to reference data only once per page.
// Selecting another day within the same week reuses all existing subscriptions.
export function createBookingConnection(api,db,onDate,report){
 const {collection,doc,query,where,onSnapshot}=api;
 const references={},values={};let selectedDate='',dates=[],week='',generation=0,disposed=false;
 const stops=[],weekStops=[];
 const emit=()=>{
  if(disposed||!dates.length||!['catalog','rooms','periods'].every(key=>key in references)||!('bookings' in values)||!dates.every(date=>date in values))return;
  if([...Object.values(references),...Object.values(values)].some(value=>value.cached)){
   report({status:'error',message:'Lidhja me rezervimet nuk është konfirmuar. Disponueshmëria nuk mund të verifikohet.'});return;
  }
  try{report({status:'ready',date:selectedDate,day:values[selectedDate].data,days:Object.fromEntries(dates.map(date=>[date,values[date].data])),rooms:references.rooms.data,
   rows:bookingRows(values.bookings.data,references.rooms.data,references.periods.data,references.catalog.data||{})});}
  catch(error){report({status:'error',message:error.message});}
 };
 const listen=(target,key,ref,document=false,isCurrent=()=>true)=>onSnapshot(ref,{includeMetadataChanges:true},snap=>{
  if(disposed||!isCurrent())return;
  target[key]={cached:snap.metadata.fromCache,data:document?(snap.exists()?snap.data():null):snap.docs.map(d=>({...d.data(),id:d.id}))};emit();
 },error=>{
  if(disposed||!isCurrent())return;target[key]={cached:true};
  report({status:'error',message:'Rezervimet nuk u ngarkuan. Provo rifreskimin e faqes.'});console.error('Public bookings:',error);
 });
 stops.push(listen(references,'catalog',doc(db,'resourceCatalog','current'),true));
 stops.push(listen(references,'rooms',collection(db,'rooms')));
 stops.push(listen(references,'periods',collection(db,'periods')));
 const selectDate=date=>{
  if(disposed)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  selectedDate=date;const nextDates=weekDates(date);
  if(week===nextDates[0]){emit();return;}
  week=nextDates[0];dates=nextDates;const current=++generation;
  weekStops.splice(0).forEach(stop=>stop());Object.keys(values).forEach(key=>delete values[key]);report({status:'loading'});
  dates.forEach(date=>weekStops.push(listen(values,date,doc(db,'calendarDays',date),true,()=>current===generation)));
  weekStops.push(listen(values,'bookings',query(collection(db,'publicBookings'),where('date','>=',dates[0]),where('date','<=',dates[6])),false,()=>current===generation));
 };
 onDate(selectDate);
 return ()=>{disposed=true;[...stops,...weekStops].forEach(stop=>stop());};
}
// Dynamic imports keep the official HTML timetable usable when Firebase is down.
export async function connectBookings(config,onDate,report){
 const [{initializeApp,getApps,getApp},firestore]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js')
 ]);
 return createBookingConnection(firestore,firestore.getFirestore(getApps().length?getApp():initializeApp(config)),onDate,report);
}
