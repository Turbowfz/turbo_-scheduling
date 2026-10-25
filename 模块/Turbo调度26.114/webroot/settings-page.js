/* ── 关于页 (外观设置 + 关于 + 捐赠) ── */

window.onOpacity = function(el) {
  syncSl(el);
  const v = Math.max(0, Math.min(40, parseInt(el.value) || 0));
  document.getElementById('v-opacity').textContent = v;
  document.documentElement.style.setProperty('--blur', v + 'px');
  try { localStorage.setItem('turbo-blur', String(v)); } catch (_) {}
};

window.onBgVis = function(el) {
  syncSl(el);
  const v = Math.max(0, Math.min(100, parseInt(el.value) || 0));
  document.getElementById('v-bgvis').textContent = v;
  const bg = document.getElementById('bg-layer');
  if (bg) bg.style.opacity = (v / 100);
  try { localStorage.setItem('turbo-bgvis', String(v)); } catch (_) {}
};

window.setBgSolid = function() {
  const bg = document.getElementById('bg-layer');
  if (bg) { bg.style.backgroundImage = 'none'; bg.style.opacity = 0; }
  const r = document.getElementById('r-bgvis'); if (r) { r.value = 0; syncSl(r); }
  const v = document.getElementById('v-bgvis'); if (v) v.textContent = 0;
  try { localStorage.setItem('turbo-bgvis', '0'); } catch (_) {}
};

window.setBgDefault = function() {
  const bg = document.getElementById('bg-layer');
  if (bg) { bg.style.backgroundImage = "url('webui.jpg')"; bg.style.opacity = .91; }
  const r = document.getElementById('r-bgvis'); if (r) { r.value = 91; syncSl(r); }
  const v = document.getElementById('v-bgvis'); if (v) v.textContent = 91;
  try { localStorage.setItem('turbo-bgvis', '91'); } catch (_) {}
};

window.openLink = async function(btnId, url) {
  popBtn(document.getElementById(btnId));
  try { await execStdout(`am start -a android.intent.action.VIEW -d '${url}' >/dev/null 2>&1 &`); } catch (_) {}
};

window.toggleTheme = function() {
  const el = document.documentElement;
  const dark = el.getAttribute('data-theme') === 'dark';
  el.setAttribute('data-theme', dark ? 'light' : 'dark');
  try { localStorage.setItem('turbo-theme', dark ? 'light' : 'dark'); } catch (_) {}
  const b = document.getElementById('theme-btn');
  if (b) b.textContent = dark ? '🌙' : '☀️';
};

/* ── 捐赠弹窗 ── */
window.showDonate = function() {
  const overlay = document.getElementById('donate-overlay');
  if (!overlay) return;
  popBtn(document.getElementById('b-donate'));
  overlay.classList.remove('out');
  overlay.classList.add('in');
  window.haptic ? haptic(8) : (navigator.vibrate && navigator.vibrate(8));
};

window.hideDonate = function() {
  const overlay = document.getElementById('donate-overlay');
  if (!overlay) return;
  overlay.classList.remove('in');
  overlay.classList.add('out');
  window.haptic ? haptic(4) : (navigator.vibrate && navigator.vibrate(4));
  setTimeout(() => {
    overlay.classList.remove('out');
    overlay.style.display = 'none';
  }, 210);
};
