"use strict";
// An app boundary, not an authentication or data-security boundary.
(() => {
  const capabilities = Object.freeze({ mode: 'synthetic-local', network: false, camera: false,
    notifications: false, externalSharing: false, authenticatedStaff: false, deviceSync: false,
    persistentInventory: false });
  function back() {
    if (typeof busy !== 'undefined' && busy) { toast('Finish or recover the current action first.'); return true; }
    const dialogs = Array.from(document.querySelectorAll('dialog[open]'));
    if (dialogs.length) {
      const top = dialogs[dialogs.length - 1];
      if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
      return true;
    }
    if (typeof pending === 'function' && pending()) { toast('Recover the saved request before leaving this desk.'); return true; }
    if (location.hash && location.hash !== '#start') { history.back(); return true; }
    return false;
  }
  Object.defineProperty(window, 'SharePassShell', { value: Object.freeze({ capabilities, back }), writable: false });
  const publicSite = 'https://sharepass.example.test/staff';
  const welcome = document.querySelector('#start-panel');
  if (welcome) {
    const desk = welcome.querySelector('#choose-event');
    const link = document.createElement('a');
    link.href = publicSite;
    link.textContent = 'Open shared register';
    link.className = 'button primary';
    link.dataset.publicShowcase = 'true';
    desk.before(link);
    desk.textContent = 'Practice on this phone';
    desk.classList.replace('primary', 'secondary');
  }
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (link?.dataset?.publicShowcase === 'true' && link.href === publicSite) return;
    if (link && /^(https?:|mailto:|tel:|intent:|whatsapp:)/i.test(link.getAttribute('href'))) {
      event.preventDefault(); event.stopImmediatePropagation();
      toast('App foundation: sharing stays as a local preview. No message or external app is opened.');
    }
  }, true);
  const note = document.querySelector('.practice-disclosure');
  if (note) note.innerHTML = '<strong>App foundation - practice only.</strong> Synthetic data. No live sign-in, device sync, camera or messages. Closing or reloading resets records.';
})();
