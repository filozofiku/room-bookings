export function weekForDate(date){
 const day=new Date(date+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
 const start=day.toISOString().slice(0,10);day.setUTCDate(day.getUTCDate()+7);
 return {start,end:day.toISOString().slice(0,10)};
}
