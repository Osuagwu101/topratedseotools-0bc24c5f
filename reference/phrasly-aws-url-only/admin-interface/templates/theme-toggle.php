<style>
  .oc-theme-toggle { background: none; border: none; padding: 0; cursor: pointer; line-height: 0; }
  .oc-theme-toggle-track {
    display: inline-flex; align-items: center; width: 52px; height: 28px; border-radius: 999px;
    background: linear-gradient(135deg, #1e4e8c, #3f7fd1); position: relative; transition: background .3s ease;
    padding: 3px;
  }
  html.dark .oc-theme-toggle-track { background: #1e293b; }
  .oc-theme-toggle-thumb {
    width: 22px; height: 22px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center;
    transform: translateX(0); transition: transform .3s ease; box-shadow: 0 1px 3px rgba(0,0,0,.3);
  }
  html.dark .oc-theme-toggle-thumb { transform: translateX(24px); background: #0f172a; }
  .oc-theme-toggle-thumb svg { width: 14px; height: 14px; }
  .oc-icon-sun { color: #f5b400; display: block; }
  .oc-icon-moon { color: #93c5fd; display: none; }
  html.dark .oc-icon-sun { display: none; }
  html.dark .oc-icon-moon { display: block; }
</style>
<button type="button" class="oc-theme-toggle" aria-label="Toggle dark mode" onclick="ocToggleTheme()">
  <span class="oc-theme-toggle-track">
    <span class="oc-theme-toggle-thumb">
      <svg class="oc-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>
        <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
      <svg class="oc-icon-moon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </span>
  </span>
</button>
<script>
  function ocToggleTheme() {
    document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('oc_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); } catch (e) {}
  }
</script>
