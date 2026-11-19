/* ML SH Support — icones padronizados para o menu do portal, sem fontes externas. */
(() => {
  'use strict';
  const icons = {
    guide:'<path d="M12 3 9.5 9.5 3 12l6.5 2.5L12 21l2.5-6.5L21 12l-6.5-2.5L12 3Z"/><path d="M19 3v4M21 5h-4"/>',
    overview:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    vendas:'<path d="M3 3h2l2 12h12l2-8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    licenses:'<circle cx="7" cy="15" r="4"/><path d="m10 12 9-9 2 2-2 2 2 2-3 3-2-2-4 4"/>',
    devices:'<rect x="3" y="4" width="15" height="12" rx="2"/><path d="M8 20h5m-2-4v4"/><rect x="17" y="9" width="5" height="11" rx="1"/>',
    sales:'<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/><path d="M16 7h4v4"/>',
    'operational-report':'<path d="M8 3h8l4 4v14H4V3h4Z"/><path d="M16 3v5h4M8 12h8M8 16h8"/>',
    shipping:'<rect x="2" y="7" width="12" height="10" rx="1"/><path d="M14 10h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    'bulk-editor':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    'shipping-free':'<path d="M4 7h10v10H4zM14 10h4l3 4v3h-7"/><circle cx="8" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="m7 12 2 2 3-4"/>',
    automations:'<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M9 3h6"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17h6"/>',
    codes:'<path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14" stroke-dasharray="3 2"/><path d="M3 3h18v18H3z"/>',
    team:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5"/>',
    chat:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 10 10 0 0 1-4-.8L3 21l1.8-5.5A9 9 0 1 1 21 11.5Z"/><path d="M8 11h8M8 15h5"/>',
    'bling-entries':'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z"/><path d="m3 7 9 4 9-4M12 11v10M7.5 5l9 4"/>',
    'bling-integrations':'<path d="M7 7h14m-4-4 4 4-4 4M17 17H3m4-4-4 4 4 4"/>',
    'bling-labels':'<path d="M4 4h12l5 5v11H4V4Z"/><path d="M16 4v5h5M8 13h9M8 17h6"/>',
    'bling-dimensions':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10M7 12h6M7 17h10M10 5v4M16 10v4"/>',
    purchase:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M12 12v5M9.5 14.5h5"/>',
    billing:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h5"/>',
    support:'<path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="12" width="4" height="7" rx="2"/><rect x="18" y="12" width="4" height="7" rx="2"/><path d="M20 19a5 5 0 0 1-5 3h-3"/>',
    settings:'<path d="m9.8 3 .5 2a7 7 0 0 1 3.4 0l.5-2 3 1.3-.8 1.9a7 7 0 0 1 2.4 2.4l1.9-.8 1.3 3-.2.5-1.8.5a7 7 0 0 1 0 3.4l2 .5-1.3 3-1.9-.8a7 7 0 0 1-2.4 2.4l.8 1.9-3 1.3-.5-2a7 7 0 0 1-3.4 0l-.5 2-3-1.3.8-1.9a7 7 0 0 1-2.4-2.4l-1.9.8-1.3-3 2-.5a7 7 0 0 1 0-3.4l-2-.5 1.3-3 1.9.8a7 7 0 0 1 2.4-2.4L6.8 4.3 9.8 3Z"/><circle cx="12" cy="12" r="3"/>'
  };
  function replaceIcons() {
    document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(button => {
      const target = button.querySelector('.ico, .nav-icon');
      const art = icons[button.dataset.page];
      if (!target || !art || target.dataset.mlshVector === '1') return;
      target.dataset.mlshVector = '1';
      target.innerHTML = '<svg class="mlsh-nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+art+'</svg>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', replaceIcons, {once:true});
  else replaceIcons();
})();
