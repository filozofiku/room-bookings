import {formatDate,formatDateTime} from '../public-schedule/dates.js';
import {inlineCalendar} from '../public-schedule/date-picker.js';
import {collection,doc,getDoc,getDocs} from 'firebase/firestore';
import {getLanguage,locale} from './booking-i18n.js';
import {summarizeReport,reportCsv,reportDate,milliseconds,activityHistory} from './reporting-model.js';

const $=id=>document.getElementById(id);
const text=(sq,en)=>getLanguage()==='en'?en:sq;
const element=(tag,value,className)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(className)node.className=className;return node;};
const collections=['activityEvents','reservations','reservationRequests','requestNotifications','requestDecisions','modificationNotifications','cancellationNotifications','studentNotifications','studentChangeNotifications','publicEventDeliveries','timetableImports','trafficDaily'];
const labels={
  created:()=>text('Rezervim i krijuar','Reservation created'),edited:()=>text('Rezervim i redaktuar','Reservation edited'),
  cancelled:()=>text('Rezervim i anuluar','Reservation cancelled'),requested:()=>text('Kërkesë e dërguar','Request submitted'),
  approved:()=>text('Kërkesë e miratuar','Request approved'),declined:()=>text('Kërkesë e refuzuar','Request declined'),
  adjusted:()=>text('Përshtatje nga importi i orarit','Timetable import adjustment')
};
function table(headers,rows,caption){
  const wrapper=element('div',undefined,'report-table-wrap'),table=element('table');
  if(caption)table.append(element('caption',caption));
  const head=element('thead'),tr=element('tr');headers.forEach(label=>{const th=element('th',label);th.scope='col';tr.append(th);});head.append(tr);table.append(head);
  const body=element('tbody');
  for(const values of rows){const row=element('tr');values.forEach(value=>row.append(element('td',value)));body.append(row);}
  if(!rows.length){const row=element('tr'),cell=element('td',text('Nuk ka të dhëna për këtë periudhë.','No data for this period.'));cell.colSpan=headers.length;row.append(cell);body.append(row);}
  table.append(body);wrapper.append(table);return wrapper;
}
const displayDate=value=>formatDate(value,getLanguage());
function dateTime(value){const time=milliseconds(value);return Number.isFinite(time)?formatDateTime(time,getLanguage()):'—';}
function duration(ms){if(ms===null)return '—';const minutes=Math.round(ms/60000);return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)} h ${minutes%60} min`;}
function trendChart(rows){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 900 180');svg.setAttribute('role','img');svg.setAttribute('aria-label',text('Rezervimet, kërkesat dhe mesazhet sipas ditës. Tabela më poshtë përmban vlerat.','Reservations, requests and messages by day. Values are in the table below.'));
  const max=Math.max(1,...rows.flatMap(r=>[r.reservations,r.requests,r.messages])),step=850/Math.max(rows.length,1);
  rows.forEach((row,i)=>['reservations','requests','messages'].forEach((key,j)=>{
    const bar=document.createElementNS(ns,'rect'),height=row[key]/max*130;
    for(const [k,v] of Object.entries({x:30+i*step+j*step*.25,y:145-height,width:Math.max(1,step*.22),height,fill:['#99080d','#405c7a','#43806d'][j]}))bar.setAttribute(k,String(v));
    const title=document.createElementNS(ns,'title');title.textContent=`${displayDate(row.date)}: ${row[key]}`;bar.append(title);svg.append(bar);
  }));
  for(const [value,x] of [[rows[0]?.date,30],[rows.at(-1)?.date,780]])if(value){const label=document.createElementNS(ns,'text');label.setAttribute('x',x);label.setAttribute('y','172');label.setAttribute('font-size','12');label.textContent=displayDate(value);svg.append(label);}
  return svg;
}

export function createReportsDashboard(db,user){
  let data=null,report=null,disposed=false,generation=0;
  const root=$('reports-content'),feedback=$('reports-feedback');
  const today=reportDate(new Date());
  $('report-start').value=today.slice(0,7)+'-01';$('report-end').value=today;
  const calendars=['report-start','report-end'].map(id=>inlineCalendar($(id),{language:getLanguage}));
  function disableActions(disabled){$('report-export').disabled=disabled;$('report-print').disabled=disabled;}
  function preset(){
    if(!data)return;
    const kind=$('report-period').value;
    if(kind==='month'){$('report-start').value=today.slice(0,7)+'-01';$('report-end').value=today;}
    if(kind==='semester'){$('report-start').value=data.control.startDate;$('report-end').value=data.control.endDate;}
    if(kind==='all'){
      const dates=activityHistory(data).map(e=>reportDate(e.occurredAt)).filter(Boolean);
      $('report-start').value=[data.control.startDate||today,...dates].sort()[0];$('report-end').value=today;
    }
    render();
  }
  function metric(label,value,note){
    const box=element('article',undefined,'report-metric');box.append(element('h3',label),element('strong',value===null?'—':new Intl.NumberFormat(locale()).format(value)));
    if(note)box.append(element('p',note));return box;
  }
  function panel(title,note){const card=element('article',undefined,'report-panel');card.append(element('h3',title));if(note)card.append(element('p',note,'report-note'));root.append(card);return card;}
  function render(){
    if(disposed)return;
    calendars.forEach(calendar=>calendar.render());
    $('reports-heading').textContent=text('Statistika dhe raporte','Statistics and reports');
    $('reports-description').textContent=text('Përdorimi i portalit dhe aktiviteti i rezervimeve · Vetëm për përdoruesit me autorizim të lartë','Portal use and reservation activity · Elevated users only');
    for(const [id,sq,en] of [['report-period-label','Periudha','Period'],['report-start-label','Nga','From'],['report-end-label','Deri më','Through'],['report-refresh','Rifreskoni të dhënat','Refresh data'],['report-export','Eksporto CSV','Export CSV'],['report-print','Printo / ruaj PDF','Print / save PDF']])$(id).textContent=text(sq,en);
    [...$('report-period').options].forEach((option,i)=>option.textContent=[text('Ky muaj','This month'),text('Semestri','Semester'),text('Që nga fillimi','Since records began'),text('Periudhë e zgjedhur','Custom period')][i]);
    if(!data)return;
    try{report=summarizeReport(data,{start:$('report-start').value,end:$('report-end').value});}
    catch{report=null;root.replaceChildren();feedback.textContent=text('Zgjidhni një interval të vlefshëm datash.','Select a valid date range.');disableActions(true);return;}
    root.replaceChildren();disableActions(false);
    const {reservations:r,requests:q,notifications:n,problems:p,traffic}=report;
    const overview=element('div',undefined,'report-metrics');
    overview.append(metric(text('Llogari aktive të stafit','Participating staff accounts'),report.staff,text('Krijuan rezervim ose dërguan kërkesë gjatë periudhës.','Created a reservation or submitted a request during the period.')),
      metric(text('Rezervime të krijuara','Reservations created'),r.direct+r.approved),metric(text('Kërkesa të dërguara','Requests submitted'),q.submitted),
      metric(text('Studentë të njoftuar','Student addresses reached'),n.recipients,text('Adresa të ndryshme me të paktën një mesazh të dërguar.','Distinct addresses with at least one message sent.')));
    root.append(overview);
    const coverage=panel(text('Periudha dhe mbulimi i raportit','Report period and coverage'));
    coverage.append(element('p',`${displayDate(report.start)} — ${displayDate(report.end)} · Europe/Tirane`));
    coverage.append(element('p',text('Veprimet numërohen sipas kohës së kryerjes, jo sipas datës së aktivitetit.','Actions are counted by when they occurred, not by the scheduled event date.')));
    coverage.append(element('p',report.auditCompleteFrom?
      text('Regjistrim i plotë i veprimeve nga: ','Complete action logging from: ')+dateTime(report.auditCompleteFrom):
      text('Regjistrimi i plotë ende nuk është aktivizuar.','Complete action logging has not been enabled yet.')));
    coverage.append(element('p',text('Të dhënat e vjetra rindërtohen nga dokumentet e ruajtura; disa anulime ose veprime të vjetra mund të mungojnë.','Older history is reconstructed from retained documents; some old cancellations or actions may be missing.'),'report-note'));
    const website=panel(text('Përdorimi i faqes','Website use'));
    if(traffic){
      const stats=element('div',undefined,'report-metrics');stats.append(metric(text('Vizita','Visits'),traffic.visits),metric(text('Shikime të faqeve','Page views'),traffic.pageViews),metric(text('Vizitorë të vlerësuar','Estimated visitors'),null,text('Nuk ofrohet nga burimi Cloudflare Web Analytics.','Not supplied by the Cloudflare Web Analytics source.')));website.append(stats);
      website.append(element('p',text('Ditë të mbuluara: ','Days covered: ')+`${traffic.days} (${displayDate(traffic.firstDate)} — ${displayDate(traffic.lastDate)}). `+text('Ditë me të dhëna të pjesshme: ','Days with partial data: ')+traffic.partialDays+'. '+text('Shifrat për ditën e sotme përfshijnë vetëm periudhën deri në sinkronizimin e fundit.','Today’s figures include only the time through the last synchronization.'),'report-note'));
      website.append(table([text('Faqja / seksioni','Page / section'),text('Shikime','Page views')],traffic.paths.slice(0,20).map(p=>[p.path==='/'?text('Orari publik','Public timetable'):p.path==='/room-bookings/'?text('Portali i rezervimeve','Booking portal'):p.path,p.pageViews])));
      website.append(element('p',text('Renditja bazohet në rrugët që raporton Cloudflare; seksionet me # nuk veçohen kur nuk ofrohen nga burimi.','Ranking uses paths reported by Cloudflare; hash sections are not separated when the source does not provide them.'),'report-note'));
      if(traffic.sampled)website.append(element('p',text('Cloudflare përdor kampionim për disa nga këto të dhëna; shifrat janë vlerësime.','Cloudflare sampled some of these data; the figures are estimates.'),'report-note'));
    }else website.append(element('p',text('Nuk ka ende të dhëna trafiku të sinkronizuara për këtë periudhë. Shifrat nuk trajtohen si zero.','No synchronized traffic data for this period yet. Missing figures are not treated as zero.')));
    if(data.trafficSettings?.lastSuccessAt)website.append(element('p',text('Sinkronizimi i fundit: ','Last successful sync: ')+dateTime(data.trafficSettings.lastSuccessAt),'report-note'));
    if(data.trafficSettings?.status==='error')website.append(element('p',text('Sinkronizimi i trafikut kërkon kontroll nga administratori.','Traffic synchronization needs administrator attention.'),'error'));
    const cloudflare=element('a',text('Hap Cloudflare Web Analytics','Open Cloudflare Web Analytics'));cloudflare.href='https://dash.cloudflare.com/?to=/:account/web-analytics';cloudflare.target='_blank';cloudflare.rel='noopener noreferrer';website.append(cloudflare);
    const activity=panel(text('Rezervimet dhe kërkesat','Reservations and requests'));
    activity.append(table([text('Masa','Measure'),text('Numri','Count')],[
      [text('Rezervime të krijuara drejtpërdrejt','Reservations created directly'),r.direct],[text('Rezervime të krijuara pas miratimit','Reservations created through approval'),r.approved],
      [text('Veprime redaktimi','Edit actions'),r.edited],[text('Rezervime të anuluara','Reservations cancelled'),r.cancelled],[text('Përshtatje nga importi i orarit','Timetable import adjustments'),r.adjusted],
      [text('Kërkesa të dërguara','Requests submitted'),q.submitted],[text('Kërkesa të miratuara','Requests approved'),q.approved],[text('Kërkesa të refuzuara','Requests declined'),q.declined],
      [text('Në pritje në fund të periudhës','Awaiting decision at period end'),q.pending],
      [text('Koha mediane e përgjigjes','Median response time'),duration(report.responseMedianMs)]
    ]));activity.append(element('p',text('Mediana përfshin vendimet e miratimit dhe refuzimit të marra në këtë periudhë. Mostra: ','Median includes approval and decline decisions made during this period. Sample: ')+report.responseCount,'report-note'));
    const notifications=panel(text('Njoftimet për studentët','Student notifications'));
    notifications.append(table([text('Masa','Measure'),text('Numri','Count')],[
      [text('Njoftime fillestare të krijuara','Initial notification batches created'),n.initial],[text('Njoftime ndryshimi të krijuara','Change notification batches created'),n.change],[text('Njoftime anulimi të krijuara','Cancellation notification batches created'),n.cancellation],
      [text('Mesazhe të dërguara gjatë periudhës','Messages sent during period'),n.messages],[text('Adresa të ndryshme studentësh','Distinct student addresses reached'),n.recipients]
    ]));notifications.append(element('p',text('“Dërguar” do të thotë pranuar nga shërbimi i emailit; nuk provon mbërritjen ose leximin. Marrësit e riprovimeve nuk numërohen dy herë.','“Sent” means accepted by the email service; it does not prove inbox delivery or reading. Retried recipients are not counted twice.'),'report-note'));
    if(n.approximateMessages||n.undatedMessages)notifications.append(element('p',text('Mesazhe me datë nga përfundimi i grupit: ','Messages dated by batch completion: ')+n.approximateMessages+'. '+text('Dërgime të vjetra pa datë, të përjashtuara nga totali i periudhës: ','Older undated sends excluded from period totals: ')+n.undatedMessages+'.','report-note'));
    const problems=panel(text('Gjendja e dërgimit','Sending problems'),text('Gjendja aktuale e njoftimeve të krijuara në periudhën e zgjedhur, për studentët dhe stafin. Kategoritë mund të mbivendosen.','Current status of student and staff notification jobs created in the selected period. Categories may overlap.'));
    problems.append(table([text('Gjendja','Status'),text('Numri','Count')],[
      [text('Në pritje / riprovim / dërgim','Pending / retrying / sending'),p.pending],[text('Dështuar','Failed'),p.failed],[text('Dërguar pjesërisht','Partially completed'),p.partial],[text('Presin miratimin e kërkesës','Awaiting request approval'),p.awaitingApproval]
    ]));
    const trend=panel(text('Aktiviteti sipas ditës','Activity by day'),text('E kuqe: rezervime · Blu: kërkesa · E gjelbër: mesazhe për studentët','Red: reservations · Blue: requests · Green: student messages'));
    if(report.trend.length)trend.append(trendChart(report.trend));
    const detail=element('details');detail.append(element('summary',text('Shfaq vlerat ditore','Show daily values')),table([text('Data','Date'),text('Rezervime','Reservations'),text('Kërkesa','Requests'),text('Mesazhe','Messages')],report.trend.map(d=>[displayDate(d.date),d.reservations,d.requests,d.messages])));trend.append(detail);
    const history=panel(text('Historiku i veprimeve','Activity history'),text('Shfaqen deri në 100 veprimet më të fundit të periudhës.','Shows up to the 100 latest actions in the period.'));
    history.append(table([text('Koha','Time'),text('Veprimi','Action'),text('Aktiviteti','Event'),text('Burimi','Source')],report.events.slice(0,100).map(e=>[dateTime(e.occurredAt),labels[e.kind]?.()||e.kind,e.title,e.source==='historical'?text('I rindërtuar','Reconstructed'):e.source==='import'?text('Import','Import'):text('I regjistruar','Recorded')])));
    feedback.textContent=text('Përditësuar më: ','Updated: ')+dateTime(data.loadedAt);
  }
  async function load(){
    const ticket=++generation;disableActions(true);feedback.textContent=text('Duke ngarkuar raportin…','Loading report…');
    try{
      const profile=await getDoc(doc(db,'users',user.uid));
      if(!profile.data()?.active||profile.data()?.canCancelAll!==true)throw Error('report-permission-denied');
      const [control,trafficSettings,...snapshots]=await Promise.all([getDoc(doc(db,'settings/control')),getDoc(doc(db,'reportSettings/traffic')),...collections.map(name=>getDocs(collection(db,name)))]);
      if(disposed||ticket!==generation)return;
      data={control:control.data()||{},trafficSettings:trafficSettings.data()||null,loadedAt:new Date().toISOString(),...Object.fromEntries(snapshots.map((snapshot,i)=>[collections[i],snapshot.docs.map(d=>({...d.data(),id:d.id}))]))};
      render();
    }catch{
      if(disposed||ticket!==generation)return;data=null;report=null;root.replaceChildren();disableActions(true);
      feedback.textContent=text('Raporti nuk u ngarkua. Kontrolloni lidhjen dhe autorizimin tuaj, pastaj riprovoni.','Report could not be loaded. Check your connection and access, then retry.');
    }
  }
  $('report-period').onchange=preset;
  for(const id of ['report-start','report-end'])$(id).onchange=()=>{$('report-period').value='custom';render();};
  $('report-filters').onsubmit=event=>{event.preventDefault();load();};
  $('report-export').onclick=()=>{
    if(!report||disposed)return;
    const url=URL.createObjectURL(new Blob([reportCsv(report)],{type:'text/csv;charset=utf-8'})),a=element('a');
    a.href=url;a.download=`faculty-report-${report.start}-${report.end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('report-print').onclick=()=>{if(report&&!disposed)window.print();};
  render();
  return {load,render,dispose(){calendars.forEach(calendar=>calendar.destroy());disposed=true;generation++;data=null;report=null;root.replaceChildren();disableActions(true);for(const id of ['report-period','report-start','report-end'])$(id).onchange=null;$('report-filters').onsubmit=null;$('report-export').onclick=null;$('report-print').onclick=null;}};
}
