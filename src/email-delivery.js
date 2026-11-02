import {collection,doc,getDocs,getDoc,query,where,runTransaction,serverTimestamp} from 'firebase/firestore';
export const EMAIL_QUEUES={cancellationNotifications:'Anulim',modificationNotifications:'Ndryshim',requestDecisions:'Vendim për kërkesën',requestNotifications:'Kërkesë për miratim'};
export function deliveryLabel(status){return {pending:'Në pritje',retrying:'Në pritje — riprovim automatik',sending:'Në proces dërgimi',sent:'Dërguar',failed:'Dështuar',skipped:'Nuk u dërgua',recorded:'Pa email — ndryshim nga vetë krijuesi'}[status]||'Status i panjohur';}
export async function retryEmail(db,path,user){
 if(![...Object.keys(EMAIL_QUEUES),'publicEventDeliveries'].includes(path.split('/')[0]))throw Error('invalid-queue');
 return runTransaction(db,async tx=>{const ref=doc(db,path),snap=await tx.get(ref);if(!snap.exists()||snap.data().status!=='failed')return false;
 tx.update(ref,{status:'pending',attempts:0,retryRequestedAt:serverTimestamp(),retryRequestedBy:user.uid});return true;});
}
export async function loadEmailDeliveries(db,user,elevated){
 const notices=(await Promise.all(Object.keys(EMAIL_QUEUES).map(async name=>{
 const ref=collection(db,name),snapshot=await getDocs(elevated?ref:query(ref,where('booking.ownerUid','==',user.uid)));
 return snapshot.docs.map(d=>({path:`${name}/${d.id}`,kind:EMAIL_QUEUES[name],...d.data()}));}))).flat();
 if(!elevated)return {notices,publicEvents:[]};
 const [deliveries,events,settings]=await Promise.all([getDocs(collection(db,'publicEventDeliveries')),getDocs(query(collection(db,'publicBookings'),where('isPublic','==',true))),getDoc(doc(db,'mailSettings','publicEvents'))]);
 const records=deliveries.docs.map(d=>({path:`publicEventDeliveries/${d.id}`,...d.data()}));
 const expected=new Set(settings.data()?.recipients||[]);
 const publicEvents=events.docs.map(d=>({id:d.id,booking:d.data(),deliveries:records.filter(r=>r.bookingId===d.id&&expected.has(r.recipient)),expected:expected.size,enabled:settings.data()?.enabled===true}));
 return {notices,publicEvents};
}
