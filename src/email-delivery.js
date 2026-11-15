import {weekForDate} from './public-event-week.js';
import {collection,doc,getDocs,getDoc,query,where,runTransaction,serverTimestamp} from 'firebase/firestore';
export const EMAIL_QUEUES={studentChangeNotifications:'Ndryshim / anulim për studentët',studentNotifications:'Njoftim për studentët',cancellationNotifications:'Anulim',modificationNotifications:'Ndryshim',requestDecisions:'Vendim për kërkesën',requestNotifications:'Kërkesë për miratim'};
export function deliveryLabel(status){return {pending:'Në pritje',retrying:'Në pritje — riprovim automatik',sending:'Në proces dërgimi',sent:'Dërguar',failed:'Dështuar',skipped:'Nuk u dërgua','awaiting-approval':'Në pritje të miratimit',cancelled:'Nuk u dërgua — kërkesë e refuzuar',recorded:'Pa email — ndryshim nga vetë krijuesi'}[status]||'Status i panjohur';}
export async function retryEmail(db,path,user){
 if(![...Object.keys(EMAIL_QUEUES),'publicEventDeliveries'].includes(path.split('/')[0]))throw Error('invalid-queue');
 return runTransaction(db,async tx=>{const ref=doc(db,path),snap=await tx.get(ref);if(!snap.exists()||snap.data().status!=='failed')return false;
 tx.update(ref,{status:'pending',attempts:0,retryRequestedAt:serverTimestamp(),retryRequestedBy:user.uid});return true;});
}
export async function loadEmailDeliveries(db,user,elevated){
 const notices=(await Promise.all(Object.keys(EMAIL_QUEUES).map(async name=>{
 const ref=collection(db,name),snapshot=await getDocs(elevated?ref:query(ref,where('booking.ownerUid','==',user.uid)));
 return snapshot.docs.map(d=>({...d.data(),path:`${name}/${d.id}`,kind:EMAIL_QUEUES[name]}));}))).flat();
 if(!elevated)return {notices,publicEvents:[]};
 const [deliveries,events,settings,subscriptions,weeks]=await Promise.all([getDocs(collection(db,'publicEventDeliveries')),getDocs(query(collection(db,'publicBookings'),where('isPublic','==',true))),getDoc(doc(db,'mailSettings','publicEvents')),getDocs(collection(db,'publicEventRecipients')),getDocs(collection(db,'publicEventWeeks'))]);
 const records=deliveries.docs.map(d=>({path:`publicEventDeliveries/${d.id}`,...d.data()}));
 const optedOut=new Set(subscriptions.docs.filter(d=>d.data().unsubscribed).map(d=>d.data().recipient));
 const expected=new Set((settings.data()?.recipients||[]).filter(r=>!optedOut.has(r)));
 const grouped=new Map(weeks.docs.map(d=>[d.id,{week:weekForDate(d.id),bookingIds:d.data().bookingIds}]));
 for(const event of events.docs){const week=weekForDate(event.data().date);if(!grouped.has(week.start))grouped.set(week.start,{week,bookingIds:[]});}
 const publicEvents=[...grouped.values()].map(({week,bookingIds})=>({id:week.start,week,booking:{date:week.start,title:week.start+' – '+week.end},bookingIds,
  deliveries:records.filter(r=>r.weekStart===week.start&&expected.has(r.recipient)),expected:expected.size,enabled:settings.data()?.enabled===true}));
 return {notices,publicEvents};
}
