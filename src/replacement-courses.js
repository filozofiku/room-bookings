// Courses come from the imported timetable, never from user-entered titles.
export const isReplacement = type => type === 'Zëvendësim i mësimit';
export const requiresPrivateVisibility = type => isReplacement(type) || type === 'Kolokium';

export function timetableCourses(roomDays, catalog) {
  const courses = new Map();
  for (const {id, ...day} of roomDays) {
    for (const [periodId, activity] of Object.entries(day.activities || {})) {
      const title = activity.subject?.trim();
      if (!title) continue;
      if (!courses.has(title)) courses.set(title, {title, source: {weeklyRoomId:id, periodId}, groupIds:new Set()});
      const course = courses.get(title);
      if (Array.isArray(activity.groupIds)) {
        activity.groupIds.forEach(group => course.groupIds.add(group));
      } else {
        // Older imports identify student sets by their exported names.
        const sets = (activity.studentSets || '').split('+').map(s=>s.trim()).filter(Boolean);
        for (const [groupId, name] of Object.entries(catalog.groups || {})) {
          const raw = catalog.groupNames?.[groupId] || name;
          // Legacy faculty subgroups use e.g. Psikologji-2.1BA under
          // Psikologji-2BA. New imports supply the actual FET membership.
          const year = name.replace(/(-\d+)\.\d+(BA|MA)$/u,'$1$2');
          const named = sets.some(set => name === set || raw === set || raw.startsWith(set + ' ') || year === set);
          if (named) course.groupIds.add(groupId);
        }
      }
    }
  }
  return [...courses.values()].sort((a,b)=>a.title.localeCompare(b.title,'sq'));
}

export function coursesForGroups(courses, groupIds) {
  return groupIds.length ? courses.filter(course=>groupIds.some(id=>course.groupIds.has(id))) : courses;
}

export function validReplacementDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
