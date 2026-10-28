import {requestDecisionEmail} from './request-decision-email.js';
import {modificationEmail} from './modification-email.js';
import {createHash} from 'node:crypto';
export function cancellationEmail(booking, reason, periods, roomName) {
  const selected = booking.periodIds.map(id=>periods.find(p=>p.id===id));
  if (!selected.length || selected.some(p=>!p)) throw Error('missing-periods');
  selected.sort((a,b)=>a.start.localeCompare(b.start));
  return {
    subject:'Njoftim për anulimin e rezervimit',
    text:[
      'Përshëndetje,', '',
      'Ju njoftojmë se rezervimi juaj është anuluar nga administratori.', '',
      `Aktiviteti: ${booking.title}`,
      `Data: ${booking.date}`,
      `Ora: ${selected[0].start}–${selected.at(-1).end}`,
      `Salla: ${roomName || 'Pa sallë'}`, '',
      'Arsyeja e anulimit:', reason, '',
      'Fakulteti Filozofik',
      'Universiteti i Prishtinës', '',
      'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
    ].join('\n')
  };
}

// Claim work transactionally; duplicate trigger deliveries cannot send concurrently.
// SMTP cannot guarantee exactly-once delivery after a process crash following acceptance.
export async function deliverCancellation(ref, {db, auth, send, now, timestamp, token}) {
  const work = await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists) return null;
    const data=snap.data();
    if(['sent','failed'].includes(data.status)) return null;
    if(data.status==='sending' && data.leaseUntil.toMillis()>now()) throw Error('delivery-in-progress');
    const attempts=(data.attempts||0)+1;
    tx.update(ref,{status:'sending',attempts,leaseToken:token,leaseUntil:timestamp(now()+300000)});
    return {...data,attempts};
  });
  if(!work) return;
  const finish=patch=>db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.data()?.leaseToken!==token) throw Error('delivery-lease-lost');
    tx.update(ref,patch);
  });
  try {
    const owner=await auth.getUser(work.booking.ownerUid);
    if(!owner.email) throw Object.assign(Error('missing-recipient'),{code:'missing-recipient'});
    const [periods,room]=await Promise.all([
      db.collection('periods').get(),
      work.booking.roomId ? db.doc(`rooms/${work.booking.roomId}`).get() : null
    ]);
    let content;
    if(work.outcome){
      content=requestDecisionEmail(work,periods.docs.map(p=>({id:p.id,...p.data()})),room?.data()?.name);
    }else if(work.before){
      const [rooms,catalog]=await Promise.all([db.collection('rooms').get(),db.doc('resourceCatalog/current').get()]);
      content=modificationEmail(work,periods.docs.map(p=>({id:p.id,...p.data()})),rooms.docs.map(r=>({id:r.id,...r.data()})),catalog.data()||{});
    }else content=cancellationEmail(work.booking,work.reason,periods.docs.map(p=>({id:p.id,...p.data()})),room?.data()?.name);
    await send({to:owner.email,...content,messageId:`<${work.outcome?'request-decision':work.before?'modification':'cancellation'}-${createHash('sha256').update(ref.id).digest('hex')}@filozofiku.github.io>`});
    await finish({status:'sent',sentAt:timestamp(now())});
  } catch(error) {
    const terminal=['auth/user-not-found','missing-recipient'].includes(error.code) || work.attempts>=5;
    await finish({status:terminal?'failed':'retrying',lastErrorCode:String(error.code || 'delivery-error').slice(0,80),lastAttemptAt:timestamp(now())});
    if(!terminal) throw Error('cancellation-email-retry');
  }
}
