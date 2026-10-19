(function () {
  'use strict';
  // Only the local preview server injects this script. Published QR assets and
  // their app-first HTTPS association remain untouched.
  function browserDestination(path, origin) {
    const parts = path.split('/');
    if (parts.length !== 4 || parts[0] !== '' || parts[1] !== 'r' ||
        !['coupons', 'bitescore'].includes(parts[2])) return null;
    let id;
    try { id = decodeURIComponent(parts[3]); } catch (_) { return null; }
    if (!id || id.trim() !== id || id.includes('/') || /[\u0000-\u001f\u007f]/.test(id)) return null;
    const base = new URL(origin || 'https://bitestar.app');
    if (!['http:', 'https:'].includes(base.protocol)) return null;
    base.pathname = '/';
    base.search = '';
    base.hash = '/r/' + parts[2] + '/' + encodeURIComponent(id);
    return base.toString();
  }
  if (typeof module !== 'undefined') module.exports = { browserDestination };
  if (typeof document === 'undefined') return;
  const destination = browserDestination(window.location.pathname,
    document.currentScript.dataset.customerOrigin);
  if (!destination) return; // Invites never enter the public customer shortcut.
  const actions = document.querySelector('.actions');
  const browser = document.createElement('a');
  browser.id = 'continue-in-browser';
  browser.className = 'button button-orange';
  browser.href = destination;
  browser.textContent = 'Continue in Browser';
  actions.prepend(browser);
  const download = document.createElement('button');
  download.className = 'button button-disabled';
  download.disabled = true;
  download.textContent = 'Download BiteStar — coming soon';
  actions.append(download);
  document.getElementById('fallback-message').textContent =
    'Open the installed BiteStar app, or continue to this restaurant in your browser.';
}());
