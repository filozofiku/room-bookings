import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseResourceSchedule,resourceId} from '../scripts/resource-schedule.mjs';
const periods=[{id:'p01',start:'08:00'},{id:'p02',start:'08:15'},{id:'p03',start:'08:30'}];
const html=(name,stamp='today')=>`<table id="table_1"><caption><span class="name">${name}</span></caption><thead><tr>${periods.map(p=>`<th class="xAxis">${p.start}</th>`).join('')}</tr></thead><tbody>${['E hënë','E martë','E mërkurë','E enjte','E premte'].map((d,i)=>`<tr><th class="yAxis">${d}</th>${i===0?'<td colspan="2">Aktivitet</td><td class="empty">---</td>':'<td colspan="3" class="empty">---</td>'}</tr>`).join('')}<tr class="foot"><td>Timetable generated with FET 7 on ${stamp}</td></tr></tbody></table>`;
test('imports all resource types with exact colspan occupancy, stable IDs and matching exports',()=>{
 const directory=mkdtempSync(join(tmpdir(),'fet-parser-'));
 try{
  for(const [file,name] of [['rooms','Salla 02'],['subgroups','Grupi 1 Automatic Subgroup'],['teachers','Mësimdhënësi']])writeFileSync(join(directory,`WinterF_${file}_days_vertical.html`),html(name));
  const result=parseResourceSchedule(directory,periods);
  const group=resourceId('g','Grupi 1 Automatic Subgroup');
  assert.equal(result.catalog.groups[group],'Grupi 1');assert.equal(result.catalog.groupNames[group],'Grupi 1 Automatic Subgroup');
  assert.equal(result.weekly[1].busyKeys.length,6);assert.ok(result.weekly[1].busyKeys.includes(`${group}__p02`));
  assert.equal(result.weekly[6].busyKeys.length,0);assert.equal(result.weekly[0].busyKeys.length,0);
  assert.throws(()=>parseResourceSchedule(directory,[...periods].reverse()),/Period mismatch/);
  writeFileSync(join(directory,'WinterF_teachers_days_vertical.html'),html('Mësimdhënësi','yesterday'));
  assert.throws(()=>parseResourceSchedule(directory,periods),/generation timestamp/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
