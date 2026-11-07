// Shared with the public site's build so timetable changes update subscriptions.
import {build} from '../public-schedule/build-calendar-classes.mjs';
export {parseClasses,reconcileClasses,classKey,build} from '../public-schedule/build-calendar-classes.mjs';
if(process.argv[1]?.endsWith('/build-calendar-classes.mjs')||process.argv[1]==='scripts/build-calendar-classes.mjs')build(process.argv[2]||'public-schedule',process.argv[3]);
