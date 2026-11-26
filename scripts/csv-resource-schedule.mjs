import {parse} from 'csv-parse/sync';
import {DOMParser} from 'linkedom';
import {resourceId} from './resource-schedule.mjs';
import {slotKeys} from '../src/booking-resources.js';

const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const weekdays = new Map(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map((s,i)=>[s,i]));
['e diel','e hene','e marte','e merkure','e enjte','e premte','e shtune'].forEach((s,i)=>weekdays.set(s,i));
const children = (node,tag) => [...node.children].filter(c=>c.tagName===tag);
const name = node => children(node,'Name')[0]?.textContent.trim();

// FET's CSV names years/groups, while resources-v2 books atomic subgroups.
// Read the actual hierarchy instead of inferring membership from name prefixes.
export function parseCsvResourceSchedule(csv, fet, periods, previousCatalog) {
  const catalog = structuredClone(previousCatalog);
  const xml = new DOMParser().parseFromString(fet,'text/xml');
  const students = xml.querySelector('Students_List');
  if (!students) throw Error('Missing FET student hierarchy');
  const membership = new Map(), leafNames = new Map();
  function visit(node,rawName) {
    const ownName = name(node);
    if (!ownName) throw Error('Unnamed FET student set');
    let leaves;
    if (node.tagName === 'Subgroup') leaves = [ownName];
    else {
      const descendants = children(node,node.tagName==='Year'?'Group':'Subgroup');
      leaves = descendants.length ? descendants.flatMap(n=>visit(n)) : [ownName + (node.tagName==='Year'?' Automatic Group Automatic Subgroup':' Automatic Subgroup')];
    }
    leaves = [...new Set(leaves)];
    if (membership.has(ownName) && JSON.stringify(membership.get(ownName))!==JSON.stringify(leaves)) throw Error(`Inconsistent hierarchy: ${ownName}`);
    membership.set(ownName,leaves);
    for (const leaf of leaves) {
      const id = resourceId('g',leaf);
      const display = leaf.replace(/\s+Automatic (?:Group )?Automatic Subgroup$/i,'').replace(/\s+Automatic Group$/i,'').replace(/\s+Automatic Subgroup$/i,'');
      if (catalog.groupNames[id] && catalog.groupNames[id]!==leaf) throw Error(`Group identity mismatch: ${leaf}`);
      catalog.groupNames[id] = leaf;
      catalog.groups[id] = display;
      leafNames.set(leaf,id);
    }
    return leaves;
  }
  for (const year of children(students,'Year')) visit(year);
  // Refuse to silently leave an old selectable subgroup without its teaching locks.
  for (const [id,raw] of Object.entries(previousCatalog.groupNames)) {
    if (leafNames.get(raw)!==id) throw Error(`Existing subgroup absent from FET hierarchy: ${raw}`);
  }
  const rows = parse(csv,{columns:true,bom:true,skip_empty_lines:true,trim:true});
  if (!rows.length) throw Error('Empty timetable');
  for (const key of ['Activity Id','Day','Hour','Students Sets','Subject','Teachers','Room']) {
    if (!(key in rows[0])) throw Error(`Missing CSV column: ${key}`);
  }
  const periodMap = new Map(periods.map(p=>[p.fetHour??p.start,p.id]));
  const busy = Array.from({length:7},()=>new Map()), weeklyRooms = new Map(), regularClasses = new Map();
  const activityIds = new Set();
  for (const row of rows) {
    const day = weekdays.get(normalize(row.Day)), period = periodMap.get(row.Hour);
    if (day===undefined || !period || !row['Activity Id']) throw Error(`Invalid timetable slot: ${JSON.stringify(row)}`);
    activityIds.add(row['Activity Id']);
    const groups = row['Students Sets'] ? row['Students Sets'].split('+').flatMap(set=>{
      const leaves = membership.get(set.trim());
      if (!leaves) throw Error(`Unknown FET student set: ${set}`);
      return leaves.map(raw=>leafNames.get(raw));
    }) : [];
    const teachers = row.Teachers ? row.Teachers.split('+').map(s=>{
      const value=s.trim(),id=resourceId('t',value);catalog.teachers[id]=value;return id;
    }) : [];
    const room = row.Room ? resourceId('r',row.Room) : '';
    if (room) catalog.rooms[room]=row.Room;
    const classId='class-'+row['Activity Id'];
    const metadata={weekday:String(day),roomId:room,groupIds:[...new Set(groups)],teacherIds:[...new Set(teachers)],subject:row.Subject,tag:row['Activity Tags']||''};
    if(!regularClasses.has(classId))regularClasses.set(classId,{...metadata,periodIds:[]});
    const regular=regularClasses.get(classId);
    for(const key of Object.keys(metadata))if(JSON.stringify(regular[key])!==JSON.stringify(metadata[key]))throw Error(`Inconsistent regular class: ${classId}`);
    if(!regular.periodIds.includes(period))regular.periodIds.push(period);
    for (const id of new Set([...groups,...teachers,...(room?[room]:[])])) {
      const key=`${id}__${period}`,old=busy[day].get(key);
      if (old && old!==row['Activity Id']) throw Error(`Overlapping official activities ${old}/${row['Activity Id']}: ${day}/${key}`);
      busy[day].set(key,row['Activity Id']);
    }
    if (room) {
      const key=`${day}__${room}`;
      if (!weeklyRooms.has(key)) weeklyRooms.set(key,{weekday:String(day),roomId:room,busyPeriods:[],activities:{}});
      const entry=weeklyRooms.get(key);
      entry.activities[period]={activityId:row['Activity Id'],subject:row.Subject,teachers:row.Teachers,studentSets:row['Students Sets'],groupIds:[...new Set(groups)]};
      if (!entry.busyPeriods.includes(period)) entry.busyPeriods.push(period);
    }
  }
  for (const room of weeklyRooms.values()) room.busyPeriods.sort();
  for(const regular of regularClasses.values()){
    regular.periodIds.sort((a,b)=>periods.findIndex(p=>p.id===a)-periods.findIndex(p=>p.id===b));
    const selected=regular.periodIds.map(id=>periods.find(p=>p.id===id));
    const positions=regular.periodIds.map(id=>periods.findIndex(p=>p.id===id));
    if(positions.some((value,i)=>i&&value!==positions[i-1]+1))throw Error('A regular class has nonconsecutive periods');
    regular.keys=slotKeys(regular);
    regular.publicInfo={subject:regular.subject,tag:regular.tag,start:selected[0].start,end:selected.at(-1).end,
      room:regular.roomId?catalog.rooms[regular.roomId]:'',teachers:regular.teacherIds.map(id=>catalog.teachers[id]),
      groups:regular.groupIds.map(id=>catalog.groupNames[id]||catalog.groups[id])};
  }
  return {catalog,regularClasses,weekly:busy.map(keys=>({busyKeys:[...keys.keys()].sort()})),weeklyRooms,rows:rows.length,activities:activityIds.size};
}

export function reconcileReservations(reservations, calendar, weekly) {
  const busy=weekly.map(d=>new Set(d.busyKeys)),updates=[],days=new Map();
  for (const {id,data:before} of reservations) {
    const date=calendar.get(before.date);
    if (!date) throw Error(`Missing calendar date for reservation ${id}`);
    const occupied = date.fetActive ? new Set([...busy[Number(date.weekday)]].filter(key=>!(date.releasedKeys||[]).includes(key))) : new Set();
    const conflicts = resource => before.periodIds.some(p=>occupied.has(`${resource}__${p}`));
    const removed = {
      roomId:before.roomId && conflicts(before.roomId)?before.roomId:'',
      groupIds:(before.groupIds||[]).filter(conflicts),
      teacherIds:(before.teacherIds||[]).filter(conflicts)
    };
    const changed = removed.roomId || removed.groupIds.length || removed.teacherIds.length;
    const after = changed ? {...before,
      roomId:removed.roomId?'':before.roomId,
      groupIds:(before.groupIds||[]).filter(id=>!removed.groupIds.includes(id)),
      teacherIds:(before.teacherIds||[]).filter(id=>!removed.teacherIds.includes(id)),
      revision:(before.revision||0)+1
    } : before;
    if (changed) updates.push({id,before,after,removed});
    for (const key of slotKeys(after)) {
      if (!days.has(after.date)) days.set(after.date,{bookings:{},changedReservationId:id});
      const locks=days.get(after.date).bookings;
      if (locks[key]) throw Error(`Reservations overlap: ${locks[key]}/${id}/${key}`);
      locks[key]=id;
    }
  }
  return {updates,days};
}
