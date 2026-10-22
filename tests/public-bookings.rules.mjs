import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require = createRequire(process.env.TEST_MODULES_DIR ? `${process.env.TEST_MODULES_DIR}/package.json` : import.meta.url);
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, collection, getDoc, getDocs, setDoc, writeBatch, serverTimestamp, runTransaction} = require('firebase/firestore');

test('public publication is private-data-free, authorized, and atomic for 1–16 periods', async () => {
  const env = await initializeTestEnvironment({projectId:'demo-fet-public', firestore:{rules:readFileSync('firestore.rules','utf8')}});
  const date = '2026-10-23', roomId = 'r_123456abcdef';
  const periodIds = Array.from({length:17},(_,i)=>`p${String(i+1).padStart(2,'0')}`);
  const payload = {title:'Meeting',date,roomId,periodIds};
  try {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await Promise.all([
        setDoc(doc(db,'users','teacher'),{active:true,role:'teacher'}),
        setDoc(doc(db,'users','other'),{active:true,role:'teacher'}),
        setDoc(doc(db,'settings','control'),{bookingOpen:true,slotStorage:'daily-v1',periodOrder:Object.fromEntries(periodIds.map((p,i)=>[p,i])),startDate:'2026-09-01',endDate:'2026-12-31'}),
        setDoc(doc(db,'calendarDays',date),{weekday:'5',fetActive:true,bookingAllowed:true}),
        setDoc(doc(db,'rooms',roomId),{name:'Room 1'}),
        setDoc(doc(db,'weeklyRooms',`5__${roomId}`),{busyPeriods:[]}),
        ...periodIds.map(id => setDoc(doc(db,'periods',id),{start:'08:00',end:'08:15'}))
      ]);
    });
    const db = env.authenticatedContext('teacher',{name:'Test Teacher'}).firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    const other = env.authenticatedContext('other').firestore();
    const occupancyRef = context => doc(context,'roomDays',`${date}__${roomId}`);
    const create = (id, periods, publish = true, extra = {}, changeLocks = true, context = db, lockValues = {}) => runTransaction(context, async tx => {
      const occupancy = await tx.get(occupancyRef(context));
      const bookings = occupancy.exists() ? {...occupancy.data().bookings} : {};
      const data = {...payload, periodIds:periods};
      tx.set(doc(context,'reservations',id),{...data,ownerUid:'teacher',createdAt:serverTimestamp()});
      if (publish) tx.set(doc(context,'publicBookings',id),{...data,...extra});
      periods.forEach(p => {bookings[p]=lockValues[p] ?? id;});
      if (changeLocks) tx.set(occupancyRef(context),{bookings,changedReservationId:id});
    });
    const cancel = (id, periods, publish = true, context = db, changeLocks = true) => runTransaction(context, async tx => {
      const occupancy = await tx.get(occupancyRef(context));
      const bookings = occupancy.exists() ? {...occupancy.data().bookings} : {};
      periods.forEach(p => delete bookings[p]);
      tx.delete(doc(context,'reservations',id));
      if (publish) tx.delete(doc(context,'publicBookings',id));
      if (changeLocks) tx.set(occupancyRef(context),{bookings,changedReservationId:id});
    });
    const valid = periodIds.slice(0,16);
    await assertFails(create('too-long',periodIds));
    await assertFails(create('nonconsecutive',['p01','p03']));
    await assertFails(create('unknown',['p99']));
    await assertFails(create('reverse',['p02','p01']));
    await assertFails(create('no-locks',valid,true,{},false));
    await assertFails(create('wrong-lock-owner',['p01','p02'],true,{},true,db,{p02:'someone-else'}));
    await assertFails(create('missing-public',valid,false));
    await assertFails(create('private-field',valid,true,{ownerUid:'teacher'}));
    await assertFails(create('forged-name',valid,true,{creatorName:'Someone else',createdAt:serverTimestamp()}));
    await assertFails(create('forged-time',valid,true,{creatorName:'Test Teacher',createdAt:new Date(0)}));
    await assertFails(create('wrong-title',valid,true,{title:'Forged'}));
    await assertFails(setDoc(doc(anonymous,'publicBookings','fake'),payload));
    await assertFails(setDoc(doc(db,'publicBookings','fake'),payload));
    for (let n=1;n<=16;n++) {
      const id = `booking-${n}`, selected = periodIds.slice(0,n);
      await assertSucceeds(create(id,selected,true,{creatorName:'Test Teacher',createdAt:serverTimestamp()}));
      await assertSucceeds(getDocs(collection(anonymous,'publicBookings')));
      await assertFails(getDoc(doc(anonymous,'reservations',id)));
      await assertFails(getDoc(doc(anonymous,'users','teacher')));
      await assertFails(cancel(id,selected,false));
      await assertFails(cancel(id,selected,true,db,false));
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
      await setDoc(occupancyRef(ctx.firestore()),{bookings:{p01:'legacy'},changedReservationId:'legacy'});
    });
    await assertSucceeds(cancel('legacy',['p01']));
    const competing = await Promise.allSettled([create('race-a',valid),create('race-b',valid)]);
    if (competing.filter(r=>r.status==='fulfilled').length !== 1) throw Error('Concurrent overlap was not rejected');
    await assertSucceeds(cancel(competing[0].status==='fulfilled'?'race-a':'race-b',valid));
    await assertSucceeds(create('existing',['p01']));
    await assertSucceeds(create('adjacent',['p02']));
    await assertFails(create('overlap',valid));
    await assertSucceeds(cancel('existing',['p01']));
    await assertSucceeds(getDoc(occupancyRef(db)).then(s=>{if(s.data().bookings.p02 !== 'adjacent') throw Error('Other booking removed');}));
    await assertSucceeds(cancel('adjacent',['p02']));
    await assertFails(setDoc(occupancyRef(db),{bookings:{p01:'fake'},changedReservationId:'fake'}));
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(),'weeklyRooms',`5__${roomId}`),{busyPeriods:['p01']}));
    await assertFails(create('fet-conflict',valid));
    await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'settings','control'),{bookingOpen:false},{merge:true}));
    await assertFails(create('paused',['p02']));
  } finally { await env.cleanup(); }
});
