import {parseHTML} from 'linkedom';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export const resourceId = (prefix, name) => prefix + '_' + createHash('sha256').update(name).digest('hex').slice(0,12);
const weekdays = ['e diel','e hene','e marte','e merkure','e enjte','e premte','e shtune'];
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function parseResourceSchedule(directory, periods) {
  const catalog = {rooms:{},groups:{},teachers:{},groupNames:{}};
  const busy = Array.from({length:7},()=>new Set());
  const stamps = new Set(), dayPatterns = new Set();
  for (const [kind,file,prefix] of [['rooms','rooms','r'],['groups','subgroups','g'],['teachers','teachers','t']]) {
    const {document} = parseHTML(readFileSync(join(directory,`WinterF_${file}_days_vertical.html`),'utf8'));
    const tables = [...document.querySelectorAll('table[id^="table_"]')];
    if (!tables.length) throw Error(`No ${kind} tables`);
    for (const table of tables) {
      const rawName = table.querySelector('caption span.name')?.textContent.trim();
      if (!rawName) throw Error('Missing resource name');
      const id = resourceId(prefix,rawName);
      if (catalog[kind][id]) throw Error(`Duplicate ${rawName}`);
      catalog[kind][id] = kind === 'groups' ? rawName.replace(/\s+Automatic (?:Group )?Automatic Subgroup$/i,'').replace(/\s+Automatic Group$/i,'').replace(/\s+Automatic Subgroup$/i,'') : rawName;
      if (kind === 'groups') catalog.groupNames[id] = rawName;
      const times = [...table.querySelectorAll('thead th.xAxis')].map(t=>t.textContent.trim());
      if (times.length !== periods.length || times.some((t,i)=>t!==periods[i].start)) throw Error(`Period mismatch: ${rawName}`);
      const seen = new Set();
      for (const row of table.querySelectorAll('tbody tr')) {
        const header = row.querySelector('th.yAxis');
        if (!header) continue;
        const day = weekdays.indexOf(normalize(header.textContent));
        if (day < 0 || seen.has(day)) throw Error(`Invalid day ${rawName}`);
        seen.add(day);
        let index = 0;
        for (const cell of [...row.children].filter(c=>c.tagName==='TD')) {
          const count = Number(cell.getAttribute('colspan') || 1);
          if (!Number.isInteger(count) || count < 1 || cell.hasAttribute('rowspan')) throw Error('Unsupported table span');
          for (let n=0;n<count;n++,index++) {
            if (!periods[index]) throw Error('Too many columns');
            if (!cell.classList.contains('empty')) busy[day].add(`${id}__${periods[index].id}`);
          }
        }
        if (index !== periods.length) throw Error(`Missing cells: ${rawName}`);
      }
      if (![1,2,3,4,5].every(d=>seen.has(d))) throw Error(`Missing weekdays: ${rawName}`);
      dayPatterns.add([...seen].sort().join(','));
      const stamp = table.querySelector('tr.foot')?.textContent.match(/Timetable generated with FET[\s\S]*? on (.+)/i)?.[1]?.trim();
      if (!stamp) throw Error('Missing generation timestamp');
      stamps.add(stamp);
    }
  }
  if (dayPatterns.size !== 1) throw Error('Inconsistent days across exports');
  if (stamps.size !== 1) throw Error('Schedule exports do not share a generation timestamp');
  return {catalog,weekly:busy.map(keys=>({busyKeys:[...keys].sort()})),generatedAt:[...stamps][0]};
}
