import {doc,serverTimestamp} from 'firebase/firestore';

export function activityEventId(kind,id,revision=0) {
  const suffix={created:'created',edited:`edit__${revision}`,cancelled:'cancelled',requested:'requested',approved:'approved',declined:'declined'}[kind];
  if(!suffix)throw Error('Unknown activity kind');
  return `${id}__${suffix}`;
}

// Commit with the business operation, never after it: retries use the same ID.
export function recordActivity(tx,db,kind,id,booking,user,{method='',requestedAt=null}={}) {
  const revision=booking.revision||0;
  tx.set(doc(db,'activityEvents',activityEventId(kind,id,revision)),{
    kind,entityId:id,ownerUid:booking.ownerUid||user.uid,actorUid:user.uid,
    occurredAt:serverTimestamp(),activityDate:booking.date,title:booking.title,
    revision,method,requestedAt,source:'app'
  });
}
