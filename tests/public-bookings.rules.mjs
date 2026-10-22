import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require = createRequire(process.env.TEST_MODULES_DIR ? `${process.env.TEST_MODULES_DIR}/package.json` : import.meta.url);
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, collection, getDoc, getDocs, setDoc, writeBatch, serverTimestamp} = require('firebase/firestore');

test('public publication is private-data-free, authorized, and atomic for 1–4 periods', async () => {
  const env = await initializeTestEnvironment({projectId:'demo-fet-public', firestore:{rules:readFileSync('firestore.rules','utf8')}});
  const date = '2026-10-23', roomId = 'r_123456abcdef';
  const periodIds = ['p01','p02','p03','p04'];
  const payload = {title:'Meeting',date,roomId,periodIds};
  try {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await Promise.all([
        setDoc(doc(db,'users','teacher'),{active:true,role:'teacher'}),
        setDoc(doc(db,'users','other'),{active:true,role:'teacher'}),
        setDoc(doc(db,'settings','control'),{bookingOpen:true,startDate:'2026-09-01',endDate:'2026-12-31'}),
        setDoc(doc(db,'calendarDays',date),{weekday:'5',fetActive:true,bookingAllowed:true}),
        setDoc(doc(db,'rooms',roomId),{name:'Room 1'}),
        setDoc(doc(db,'weeklyRooms',`5__${roomId}`),{busyPeriods:[]}),
        ...periodIds.map(id => setDoc(doc(db,'periods',id),{start:'08:00',end:'08:15'}))
      ]);
    });
    const db = env.authenticatedContext('teacher').firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    const other = env.authenticatedContext('other').firestore();
    const create = (id, periods, publish = true, extra = {}) => {
      const batch = writeBatch(db);
      const data = {...payload, periodIds:periods};
      batch.set(doc(db,'reservations',id),{...data,ownerUid:'teacher',createdAt:serverTimestamp()});
      if (publish) batch.set(doc(db,'publicBookings',id),{...data,...extra});
      periods.forEach(periodId => batch.set(doc(db,'roomSlots',`${date}__${roomId}__${periodId}`),{
        source:'booking',reservationId:id,ownerUid:'teacher',date,roomId,periodId
      }));
      return batch.commit();
    };
    const cancel = (id, periods, publish = true, context = db) => {
      const batch = writeBatch(context);
      batch.delete(doc(context,'reservations',id));
      if (publish) batch.delete(doc(context,'publicBookings',id));
      periods.forEach(p => batch.delete(doc(context,'roomSlots',`${date}__${roomId}__${p}`)));
      return batch.commit();
    };
    await assertFails(create('missing-public',periodIds,false));
    await assertFails(create('private-field',periodIds,true,{ownerUid:'teacher'}));
    await assertFails(create('wrong-title',periodIds,true,{title:'Forged'}));
    await assertFails(setDoc(doc(anonymous,'publicBookings','fake'),payload));
    await assertFails(setDoc(doc(db,'publicBookings','fake'),payload));
    for (let n=1;n<=4;n++) {
      const id = `booking-${n}`, selected = periodIds.slice(0,n);
      await assertSucceeds(create(id,selected));
      await assertSucceeds(getDocs(collection(anonymous,'publicBookings')));
      await assertFails(getDoc(doc(anonymous,'reservations',id)));
      await assertFails(getDoc(doc(anonymous,'users','teacher')));
      await assertFails(cancel(id,selected,false));
      await assertFails(cancel(id,selected,true,other));
      await assertFails(setDoc(doc(db,'publicBookings',id),{...payload,title:'Changed'}));
      await assertSucceeds(cancel(id,selected));
    }
    await assertSucceeds(getDocs(collection(anonymous,'rooms')));
    await assertSucceeds(getDocs(collection(anonymous,'periods')));
    await assertSucceeds(getDoc(doc(anonymous,'calendarDays',date)));
    // Existing imported bookings may have no public copy yet; cancellation still works.
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(),'reservations','legacy'),{...payload,periodIds:['p01'],ownerUid:'teacher'});
      await setDoc(doc(ctx.firestore(),'roomSlots',`${date}__${roomId}__p01`),{source:'booking',reservationId:'legacy',ownerUid:'teacher'});
    });
    await assertSucceeds(cancel('legacy',['p01']));
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(),'weeklyRooms',`5__${roomId}`),{busyPeriods:['p01']}));
    await assertFails(create('fet-conflict',periodIds));
  } finally { await env.cleanup(); }
});
