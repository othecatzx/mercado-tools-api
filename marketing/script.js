(()=>{
 const button=document.getElementById('menuButton'),nav=document.getElementById('mainNav');
 function closeMenu(){nav.classList.remove('open');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Abrir navegação');}
 button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';nav.classList.toggle('open',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Fechar navegação':'Abrir navegação');});
 nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
 const desktop=window.matchMedia('(min-width: 641px)');desktop.addEventListener?.('change',e=>{if(e.matches)closeMenu();});
 if('IntersectionObserver' in window&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}}),{threshold:.08});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));document.documentElement.classList.add('motion-ready');}
})();
