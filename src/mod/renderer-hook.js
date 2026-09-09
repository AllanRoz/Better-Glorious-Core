/**
 * Better Glorious Core - Renderer Process Hook
 * Automatically injected into Glorious Core renderer window.
 */
(function () {
  if (window.__BETTER_GLORIOUS_CORE_LOADED__) return;
  window.__BETTER_GLORIOUS_CORE_LOADED__ = true;

  console.log(
    '%c Better Glorious Core %c v1.0.0 Active 🚀 ',
    'background: #ffb800; color: #111; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px;',
    'background: #1e222d; color: #fff; border-radius: 0 4px 4px 0; padding: 2px 6px;'
  );

  // Expose modding API to window
  window.BetterGloriousCore = {
    version: '1.0.0',
    installed: true,
    theme: {
      injectCSS: function (cssString) {
        const style = document.createElement('style');
        style.textContent = cssString;
        document.head.appendChild(style);
        return style;
      }
    }
  };

  // Mount UI status badge once DOM is ready
  function mountBadge() {
    if (document.getElementById('bgc-status-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'bgc-status-badge';
    badge.innerHTML = '<span class="bgc-accent">⚡</span>Better Glorious Core';
    document.body.appendChild(badge);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBadge);
  } else {
    mountBadge();
  }
})();
