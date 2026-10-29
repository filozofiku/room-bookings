export const REQUEST_REVIEWER_EMAIL='bardhok.bashota@uni-pr.edu';
export function requestSubmittedEmail(booking,periods,roomName){
 const selected=booking.periodIds.map(id=>periods.find(p=>p.id===id));
 if(!selected.length||selected.some(p=>!p))throw Error('missing-periods');
 selected.sort((a,b)=>a.start.localeCompare(b.start));
 return {subject:'Kërkesë e re për rezervimin e sallës',text:[
  'Përshëndetje,','',
  'Është paraqitur një kërkesë e re për rezervimin e një salle që kërkon miratim.','',
  `Kërkuesi: ${booking.creatorName}`,`Aktiviteti: ${booking.title}`,`Lloji: ${booking.eventType}`,
  `Salla: ${roomName||booking.roomId}`,`Data: ${booking.date}`,`Ora: ${selected[0].start}–${selected.at(-1).end}`,
  ...(booking.description?['','Përshkrimi:',booking.description]:[]),'',
  'Për të parë gjendjen aktuale dhe për ta miratuar ose refuzuar kërkesën, hyni në aplikacion dhe hapni rubrikën “Kërkesat për miratim”:',
  'https://filozofiku.github.io/room-bookings/','',
  'Kërkesa mund të jetë shqyrtuar ndërkohë nga një përdorues tjetër me të drejta miratimi.','',
  'Fakulteti Filozofik','Universiteti i Prishtinës','',
  'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
 ].join('\n')};
}
