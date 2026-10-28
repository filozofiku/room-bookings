export function requestDecisionEmail(work,periods,roomName) {
  if(!['approved','rejected'].includes(work.outcome))throw Error('invalid-request-decision');
  const selected=work.booking.periodIds.map(id=>periods.find(p=>p.id===id));
  if(!selected.length||selected.some(p=>!p))throw Error('missing-periods');
  selected.sort((a,b)=>a.start.localeCompare(b.start));
  const approved=work.outcome==='approved';
  return {
    subject:approved?'Kërkesa juaj për rezervim është miratuar':'Kërkesa juaj për rezervim është refuzuar',
    text:[
      'Përshëndetje,','',
      approved?'Ju njoftojmë se kërkesa juaj për rezervim është miratuar. Rezervimi është krijuar dhe është publikuar në orar.':'Ju njoftojmë se kërkesa juaj për rezervim është refuzuar. Kërkesa është fshirë dhe nuk është krijuar rezervim.','',
      `Aktiviteti: ${work.booking.title}`,`Data: ${work.booking.date}`,
      `Ora: ${selected[0].start}–${selected.at(-1).end}`,`Salla: ${roomName||work.booking.roomId}`,'',
      `${approved?'Miratuar':'Refuzuar'} nga: ${work.deciderName}`,'',
      'Arsyeja e vendimit:',work.reason,'',
      'Orari: https://filozofiku.github.io/#orari/reservations/te-gjitha','',
      'Fakulteti Filozofik','Universiteti i Prishtinës','',
      'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
    ].join('\n')
  };
}
