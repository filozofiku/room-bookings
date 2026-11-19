import {formatDate,localDate,parseDate,monthName} from './dates.js';
const iso=date=>date.toISOString().slice(0,10);
const monthOf=value=>value.slice(0,7)+'-01';
const shift=(value,days)=>{const date=parseDate(value);date.setUTCDate(date.getUTCDate()+days);return iso(date);};
export function inlineCalendar(input,{language=()=>document.documentElement.lang||'sq'}={}){
 const en=()=>language().startsWith('en');
 const text=(sq,english)=>en()?english:sq;
 const wrapper=document.createElement('div');wrapper.className='inline-calendar';wrapper.id=input.id+'-calendar';wrapper.setAttribute('role','group');
 const label=document.querySelector(`label[for="${input.id}"]`);if(label){label.id||=input.id+'-label';wrapper.setAttribute('aria-labelledby',label.id);}
 const selection=document.createElement('p');selection.className='calendar-selection';selection.setAttribute('aria-live','polite');
 const header=document.createElement('div');header.className='calendar-header';
 const previous=document.createElement('button'),next=document.createElement('button'),heading=document.createElement('strong');heading.id=input.id+'-month';
 previous.type=next.type='button';previous.textContent='‹';next.textContent='›';header.append(previous,heading,next);
 const weekdays=document.createElement('div');weekdays.className='calendar-weekdays';weekdays.setAttribute('aria-hidden','true');
 const grid=document.createElement('div');grid.className='calendar-grid';grid.setAttribute('role','grid');grid.setAttribute('aria-labelledby',heading.id);
 const today=document.createElement('button');today.type='button';today.className='calendar-today';
 wrapper.append(selection,header,weekdays,grid,today);input.after(wrapper);input.hidden=true;input.tabIndex=-1;
 let selected=null,month=monthOf(input.value||localDate()),focused='';
 const allowed=value=>(!input.min||value>=input.min)&&(!input.max||value<=input.max)&&!input.disabled;
 const clamp=value=>input.min&&value<input.min?input.min:input.max&&value>input.max?input.max:value;
 function choose(value){if(!allowed(value))return;input.value=value;focused=value;render();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));grid.querySelector(`[data-date="${value}"]`)?.focus();}
 function moveMonth(amount){const date=parseDate(month);date.setUTCMonth(date.getUTCMonth()+amount);month=iso(date);render();}
 function render(){
  if(selected!==input.value){selected=input.value;month=monthOf(clamp(selected||localDate()));focused=selected;}
  month=monthOf(clamp(month));
  const date=parseDate(month),now=localDate();
  selection.textContent=input.value?formatDate(input.value,language()):text('Zgjidhni datën','Choose a date');
  heading.textContent=`${monthName(date.getUTCMonth()+1,language())} ${date.getUTCFullYear()}`;
  previous.setAttribute('aria-label',text('Muaji i mëparshëm','Previous month'));next.setAttribute('aria-label',text('Muaji i ardhshëm','Next month'));
  previous.disabled=Boolean(input.disabled||input.min&&month<=monthOf(input.min));next.disabled=Boolean(input.disabled||input.max&&month>=monthOf(input.max));
  weekdays.replaceChildren();for(let i=0;i<7;i++){const day=document.createElement('span');day.textContent=(en()?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['Hën','Mar','Mër','Enj','Pre','Sht','Die'])[i];weekdays.append(day);}
  const start=shift(month,-((date.getUTCDay()+6)%7));grid.replaceChildren();
  const active=allowed(focused)&&focused.slice(0,7)===month.slice(0,7)?focused:clamp(month);
  for(let week=0;week<6;week++){
   const row=document.createElement('div');row.className='calendar-week';row.setAttribute('role','row');
   for(let day=0;day<7;day++){
    const value=shift(start,week*7+day),cell=document.createElement('div'),button=document.createElement('button');cell.setAttribute('role','gridcell');cell.setAttribute('aria-selected',String(value===input.value));
    button.type='button';button.dataset.date=value;button.textContent=String(Number(value.slice(8)));button.disabled=!allowed(value);button.tabIndex=value===active?0:-1;
    button.setAttribute('aria-label',formatDate(value,language()));if(value===now)button.setAttribute('aria-current','date');
    button.className=[value===input.value?'selected':'',value.slice(0,7)!==month.slice(0,7)?'other-month':''].filter(Boolean).join(' ');
    button.onclick=()=>choose(value);button.onkeydown=event=>{
     const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-day,End:6-day};let target;
     if(event.key in offsets)target=shift(value,offsets[event.key]);
     else if(event.key==='PageUp'||event.key==='PageDown'){const targetMonth=parseDate(monthOf(value)),number=Number(value.slice(8));targetMonth.setUTCMonth(targetMonth.getUTCMonth()+(event.key==='PageUp'?-1:1));const end=new Date(targetMonth);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);targetMonth.setUTCDate(Math.min(number,end.getUTCDate()));target=iso(targetMonth);}
     if(!target)return;event.preventDefault();focused=clamp(target);month=monthOf(focused);render();grid.querySelector(`[data-date="${focused}"]`)?.focus();
    };cell.append(button);row.append(cell);
   }grid.append(row);
  }
  today.textContent=text('Sot','Today');today.disabled=!allowed(now);today.setAttribute('aria-label',text('Zgjidhni sot: ','Choose today: ')+formatDate(now,language()));
 }
 previous.onclick=()=>moveMonth(-1);next.onclick=()=>moveMonth(1);today.onclick=()=>choose(localDate());input.addEventListener('change',render);render();
 return {render,destroy(){input.removeEventListener('change',render);wrapper.remove();input.hidden=false;input.removeAttribute('tabindex');}};
}
