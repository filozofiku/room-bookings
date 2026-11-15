export const REPORT_ZONE='Europe/Tirane';
export function milliseconds(value) {
  if(typeof value?.toMillis==='function')return value.toMillis();
  if(typeof value?.seconds==='number')return value.seconds*1000+(value.nanoseconds||0)/1e6;
  if(typeof value?._seconds==='number')return value._seconds*1000+(value._nanoseconds||0)/1e6;
  if(value instanceof Date)return value.getTime();
  if(typeof value==='string')return Date.parse(value);
  return NaN;
}
export function reportDate(value) {
  const time=milliseconds(value);
  if(!Number.isFinite(time))return '';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:REPORT_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validReportDate(value) {
  const date=new Date(value+'T12:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function median(values) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),n=sorted.length;
  return n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null;
}
const eventId=(kind,id,revision=0)=>`${id}__${kind==='edited'?`edit__${revision}`:kind}`;

// Surviving legacy documents give a lower bound, never an invented complete history.
export function activityHistory(data) {
  const events=new Map((data.activityEvents||[]).map(e=>[e.id,e]));
  const decisions=new Map((data.requestDecisions||[]).map(d=>[d.id,d]));
  function add(kind,id,booking,occurredAt,extra={}) {
    if(!booking||!Number.isFinite(milliseconds(occurredAt)))return;
    const event={id:eventId(kind,id,extra.revision),kind,entityId:id,ownerUid:booking.ownerUid,
      actorUid:'',activityDate:booking.date,title:booking.title,occurredAt,method:'',revision:0,source:'historical',...extra};
    if(!events.has(event.id))events.set(event.id,event);
  }
  const created=(id,booking)=>add('created',id,booking,decisions.get(id)?.outcome==='approved'?decisions.get(id).createdAt:booking?.createdAt,
    {method:decisions.get(id)?.outcome==='approved'?'approved':'direct'});
  for(const booking of data.reservations||[])created(booking.id,booking);
  for(const notice of data.modificationNotifications||[]) {
    created(notice.reservationId,notice.before);
    add('edited',notice.reservationId,notice.booking,notice.createdAt,{revision:notice.booking?.revision,actorUid:notice.modifiedBy});
  }
  for(const notice of data.cancellationNotifications||[]) {
    created(notice.id,notice.booking);
    add('cancelled',notice.id,notice.booking,notice.createdAt,{actorUid:notice.cancelledBy});
  }
  for(const notice of data.studentChangeNotifications||[]) {
    created(notice.reservationId,notice.before||notice.booking);
    if(notice.eventAction==='cancelled')add('cancelled',notice.reservationId,notice.booking,notice.createdAt);
    if(notice.eventAction==='modified')add('edited',notice.reservationId,notice.booking,notice.createdAt,{revision:notice.booking?.revision});
  }
  for(const request of data.reservationRequests||[])add('requested',request.id,request,request.createdAt);
  for(const notice of data.requestNotifications||[])add('requested',notice.id,notice.booking,notice.booking?.createdAt||notice.createdAt);
  for(const decision of data.requestDecisions||[]) {
    add('requested',decision.id,decision.booking,decision.booking?.createdAt);
    add(decision.outcome==='approved'?'approved':'declined',decision.id,decision.booking,decision.createdAt,{actorUid:decision.decidedBy,requestedAt:decision.booking?.createdAt});
    if(decision.outcome==='approved')created(decision.id,decision.booking);
  }
  // Trusted imports are separate from staff edits and have their own stable IDs.
  for(const run of data.timetableImports||[])for(const change of run.conflicts||[]) {
    const id=`${run.id}__${change.id}__import`;
    if(!events.has(id))events.set(id,{id,kind:'adjusted',entityId:change.id,title:change.title,activityDate:change.date,occurredAt:run.appliedAt,source:'import'});
  }
  return [...events.values()].sort((a,b)=>milliseconds(b.occurredAt)-milliseconds(a.occurredAt)||a.id.localeCompare(b.id));
}

export function summarizeReport(data,{start,end}) {
  if(!validReportDate(start)||!validReportDate(end)||start>end)throw Error('invalid-report-range');
  const inRange=time=>{const day=reportDate(time);return day&&day>=start&&day<=end;};
  const history=activityHistory(data),events=history.filter(e=>inRange(e.occurredAt));
  const count=kind=>events.filter(e=>e.kind===kind).length;
  const staff=new Set(events.filter(e=>['created','requested'].includes(e.kind)&&e.ownerUid).map(e=>e.ownerUid));
  const responses=events.filter(e=>['approved','declined'].includes(e.kind)).map(e=>milliseconds(e.occurredAt)-milliseconds(e.requestedAt)).filter(n=>Number.isFinite(n)&&n>=0);
  const decisions=new Map(history.filter(e=>['approved','declined'].includes(e.kind)).map(e=>[e.entityId,e]));
  // Pending is the state at the selected end date, including older open requests.
  const pendingRequests=history.filter(e=>e.kind==='requested'&&reportDate(e.occurredAt)<=end&&
    (!decisions.has(e.entityId)||reportDate(decisions.get(e.entityId).occurredAt)>end)).length;
  const notices=[...(data.studentNotifications||[]).map(n=>({...n,notificationKind:'initial',queue:'studentNotifications'})),
    ...(data.studentChangeNotifications||[]).map(n=>({...n,notificationKind:n.eventAction==='cancelled'?'cancellation':'change',queue:'studentChangeNotifications'}))];
  const notificationCounts={initial:0,change:0,cancellation:0};
  const recipients=new Set(),receipts=[],legacyUndated=new Set();
  let approximateMessages=0;
  for(const notice of notices) {
    if(inRange(notice.createdAt))notificationCounts[notice.notificationKind]++;
    const sent=[...new Set((notice.sentRecipients||[]).map(s=>s.trim().toLowerCase()))];
    for(const recipient of sent) {
      const exact=notice.recipientSentAt?.[recipient],fallback=exact||notice.sentAt;
      if(!fallback){legacyUndated.add(`${notice.queue}/${notice.id}/${recipient}`);continue;}
      if(inRange(fallback)) {
        recipients.add(recipient);
        receipts.push({id:`${notice.queue}/${notice.id}/${recipient}`,occurredAt:fallback,kind:notice.notificationKind});
        if(!exact)approximateMessages++;
      }
    }
  }
  const otherQueues=['requestNotifications','requestDecisions','modificationNotifications','cancellationNotifications','publicEventDeliveries'];
  const jobs=[...notices,...otherQueues.flatMap(queue=>(data[queue]||[]).map(n=>({...n,queue})))];
  const problems={pending:0,failed:0,partial:0,awaitingApproval:0};
  // Delivery states are current states of jobs created in the selected period.
  for(const job of jobs.filter(n=>inRange(n.createdAt||n.sentAt||n.lastAttemptAt))) {
    if(['pending','retrying','sending'].includes(job.status))problems.pending++;
    if(job.status==='failed')problems.failed++;
    if(job.status==='awaiting-approval')problems.awaitingApproval++;
    const total=new Set((job.recipients||[]).map(s=>s.trim().toLowerCase())).size;
    const sent=new Set((job.sentRecipients||[]).map(s=>s.trim().toLowerCase())).size;
    if(sent>0&&sent<total)problems.partial++;
  }
  const days=new Map();
  const day=(date)=>{if(!days.has(date))days.set(date,{date,reservations:0,requests:0,messages:0});return days.get(date);};
  for(const event of events){if(event.kind==='created')day(reportDate(event.occurredAt)).reservations++;if(event.kind==='requested')day(reportDate(event.occurredAt)).requests++;}
  for(const receipt of receipts)day(reportDate(receipt.occurredAt)).messages++;
  const trafficDays=(data.trafficDaily||[]).filter(d=>d.id>=start&&d.id<=end&&typeof d.complete==='boolean');
  const topPaths=new Map();
  for(const d of trafficDays)for(const p of d.paths||[])topPaths.set(p.path,(topPaths.get(p.path)||0)+p.pageViews);
  const traffic=trafficDays.length?{
    visits:trafficDays.reduce((n,d)=>n+d.visits,0),pageViews:trafficDays.reduce((n,d)=>n+d.pageViews,0),
    visitors:null,days:trafficDays.length,partialDays:trafficDays.filter(d=>!d.complete).length,sampled:trafficDays.some(d=>d.sampled===true),firstDate:trafficDays.map(d=>d.id).sort()[0],lastDate:trafficDays.map(d=>d.id).sort().at(-1),
    paths:[...topPaths].map(([path,pageViews])=>({path,pageViews})).sort((a,b)=>b.pageViews-a.pageViews)
  }:null;
  return {start,end,staff:staff.size,
    reservations:{direct:events.filter(e=>e.kind==='created'&&e.method!=='approved').length,approved:events.filter(e=>e.kind==='created'&&e.method==='approved').length,edited:count('edited'),cancelled:count('cancelled'),adjusted:count('adjusted')},
    requests:{submitted:count('requested'),approved:count('approved'),declined:count('declined'),pending:pendingRequests},
    responseMedianMs:median(responses),responseCount:responses.length,
    notifications:{...notificationCounts,messages:receipts.length,recipients:recipients.size,approximateMessages,undatedMessages:legacyUndated.size},
    problems,traffic,trend:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),events,
    auditCompleteFrom:data.control?.auditCompleteFrom||null,historicalEvents:events.filter(e=>e.source==='historical').length,
    generatedAt:new Date().toISOString(),trafficStatus:data.trafficSettings||null
  };
}

export function reportCsv(report,labels={}) {
  const rows=[['Area','Measure','Value','From','To'],
    ['Staff','Distinct accounts',report.staff],
    ...Object.entries(report.reservations).map(([k,v])=>['Reservations',k,v]),
    ...Object.entries(report.requests).map(([k,v])=>['Requests',k,v]),
    ['Response time','Median minutes',report.responseMedianMs===null?'':report.responseMedianMs/60000],
    ...Object.entries(report.notifications).map(([k,v])=>['Student notifications',k,v]),
    ...Object.entries(report.problems).map(([k,v])=>['Sending problems',k,v]),
    ['Website','Visits',report.traffic?.visits??'Unavailable'],['Website','Page views',report.traffic?.pageViews??'Unavailable'],
    ['Website','Estimated visitors','Unsupported'],['Website','Days covered',report.traffic?.days??0],
    ['History','Complete logging from',reportDate(report.auditCompleteFrom)||'Not enabled'],
    ['History','Reconstructed events',report.historicalEvents],['Report','Generated at',report.generatedAt],
    ...(report.traffic?.paths||[]).map(p=>['Website path',p.path,p.pageViews])];
  const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return '\uFEFF'+rows.map((row,i)=>(i?[...row,report.start,report.end]:row).map(cell).join(',')).join('\r\n');
}
