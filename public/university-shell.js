(() => {
 const button=document.querySelector('.rail-toggle');
 if(!button)return;
 const apply=collapsed=>{
  document.body.classList.toggle('sidebar-collapsed',collapsed);
  button.setAttribute('aria-expanded',String(!collapsed));
  const label=collapsed?'Shfaq menynë':'Fshih menynë';
  button.setAttribute('aria-label',label);
  button.title=label;
  button.querySelector('span').textContent=label;
 };
 document.querySelectorAll('.rail-links a').forEach(link=>{
  const label=link.textContent.trim();link.setAttribute('aria-label',label);link.title=label;
 });
 try{apply(localStorage.getItem('faculty-sidebar-collapsed')==='true');}catch{apply(false);}
 button.addEventListener('click',()=>{
  const collapsed=!document.body.classList.contains('sidebar-collapsed');apply(collapsed);
  try{localStorage.setItem('faculty-sidebar-collapsed',String(collapsed));}catch{}
 });
})();
