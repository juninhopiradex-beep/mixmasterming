/* MIXMIND — aplicação instalável e offline (service worker sw.js). Só em https ou localhost. */
(function () {
  const MM = (window.MM = window.MM || {});
  MM.pwa = { installable: false, prompt: null };
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  if (window.MM_NO_SW) return; // testes automáticos
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker', e)); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); MM.pwa.prompt = e; MM.pwa.installable = true; });
  /** Mostra o diálogo de instalação do navegador (Chrome/Edge). */
  MM.pwa.install = async () => { if (!MM.pwa.prompt) return false; MM.pwa.prompt.prompt(); const r = await MM.pwa.prompt.userChoice; MM.pwa.prompt = null; MM.pwa.installable = false; return r.outcome === 'accepted'; };
})();
