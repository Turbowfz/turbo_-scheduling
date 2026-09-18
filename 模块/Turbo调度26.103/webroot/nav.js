/* ── Tab 导航 (照抄温控模块) ── */
const TAB_NAMES = ['status','config','cloud','about'];
let _curTab = 0;
let _tabbarDragging = false;   /* 拖拽期间阻止 switchTab 覆盖指示器位置 */

/* ── 震动统一入口: navigator.vibrate 优先 (零开销), root 兜底带 250ms 节流
   (拖动跨档高频调用 root shell 会排队卡顿) ── */
let _vibBusy = false;
let _lastRootVib = 0;
window.haptic = function(ms) {
  ms = ms || 12;
  try {
    if (navigator.vibrate && navigator.vibrate(ms) === true) return;
  } catch (_) {}
  const now = Date.now();
  if (now - _lastRootVib < 250) return;
  _lastRootVib = now;
  if (_vibBusy) return;
  _vibBusy = true;
  try {
    execStdout('cmd vibrator vibrate 30');
  } catch (_) {}
  setTimeout(() => { _vibBusy = false; }, 150);
};
function tapVibrate() { haptic(); }

function moveIndicator(tabEl) {
  if (_tabbarDragging) return;
  const ind = document.getElementById('tab-indicator');
  if (!ind || !tabEl) return;
  ind.style.left  = tabEl.offsetLeft + 'px';
  ind.style.width = tabEl.offsetWidth + 'px';
}
/* 恢复滑块样式表过渡 (清除拖拽遗留的内联 transition:none) */
function restoreIndicatorTransition() {
  const ind = document.getElementById('tab-indicator');
  if (ind && ind.style.transition === 'none') ind.style.transition = '';
}

window.switchTab = function(name) {
  const idx = TAB_NAMES.indexOf(name);
  if (idx < 0) return;
  _curTab = idx;
  restoreIndicatorTransition();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  const tab  = document.getElementById('tab-'  + name);
  if (page) page.classList.add('active');
  if (tab)  { tab.classList.add('active'); moveIndicator(tab); }
  if (page) {
    page.querySelectorAll('.card:not(.in), .card-anim:not(.in)').forEach((c, i) => {
      c.style.setProperty('--del', (i * 28) + 'ms');
      c.classList.add('in');
    });
  }
  /* 状态刷新延迟执行, 避免与震动 exec 并发排队 (ksu 通道串行会拖慢震动反馈) */
  if (name === 'status') setTimeout(refreshStatus, 160);
};

window.addEventListener('load', () => {
  const firstTab = document.getElementById('tab-status');
  const ind = document.getElementById('tab-indicator');
  if (firstTab && ind) {
    ind.style.transition = 'none';
    moveIndicator(firstTab);
    requestAnimationFrame(() => { ind.style.transition = ''; });
  }
});

/* ── Tabbar 拖拽 (指示器实时跟手, 越过中线立即切页, 松手 snap) ── */
(function initTabbarDrag() {
  const tabbar = document.getElementById('tabbar');
  const ind    = document.getElementById('tab-indicator');
  if (!tabbar || !ind) return;

  let startX = 0, startY = 0, startTab = 0;
  let dragging = false, intentDecided = false;
  /* 仅缓存可见 tab: 隐藏页签 (display:none) 的 rect 是全零,
     混进插值会让宽度朝 0 收缩 + 位置瞬移 (变短→闪现的根源) */
  let visNames = [], visRects = [];
  let lastBest = 0;
  let tbLeft = 0;   /* tabbar 每次拖动只测一次, touchmove 不再强制重排 */

  function cacheRects() {
    visNames = []; visRects = [];
    tbLeft = tabbar.getBoundingClientRect().left;
    for (const n of TAB_NAMES) {
      const el = document.getElementById('tab-' + n);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      visNames.push(n);
      visRects.push(r);
    }
  }

  /* 根据手指 X 计算指示器连续位置 (插值只在可见 tab 之间) */
  function indPosForX(x) {
    const n = visRects.length;
    if (!n) return null;
    const first = visRects[0], last = visRects[n - 1];
    const cx = Math.max(first.left, Math.min(last.right, x));

    let best = startTab;
    for (let i = 0; i < n; i++) {
      const r = visRects[i];
      if (cx >= r.left && cx <= r.right) { best = i; break; }
    }

    const cur = visRects[best];
    if (!cur) return null;
    const mid = cur.left + cur.width / 2;
    let t = 0;
    if (cx < mid && best > 0) {
      const prev = visRects[best - 1];
      if (prev) t = Math.max(-1, (cx - mid) / (mid - (prev.left + prev.width / 2)));
    } else if (cx > mid && best < n - 1) {
      const next = visRects[best + 1];
      if (next) t = Math.min(1, (cx - mid) / ((next.left + next.width / 2) - mid));
    }

    const targetIdx = t < 0 ? best - 1 : best + 1;
    const targetRect = (t !== 0 && visRects[targetIdx]) ? visRects[targetIdx] : null;
    const at = Math.abs(t);
    const left  = targetRect ? cur.left  + (targetRect.left  - cur.left)  * at : cur.left;
    const width = targetRect ? cur.width + (targetRect.width - cur.width) * at : cur.width;
    const tbRectLeft = tbLeft;
    return { left: left - tbRectLeft, width, best };
  }

  tabbar.addEventListener('touchstart', e => {
    /* 手指按下 tab 立即震 (零延迟感知), click 不再重复震 */
    if (e.target.closest('.tab')) tapVibrate();
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    cacheRects();
    startTab  = visNames.indexOf(TAB_NAMES[_curTab]);
    if (startTab < 0) startTab = 0;
    lastBest  = startTab;
    dragging  = false;
    intentDecided = false;
    /* 只有按在滑块上: 立即放大 (无过渡, 按下即到位) */
    const ir = ind.getBoundingClientRect();
    const tx = e.touches[0].clientX, ty = e.touches[0].clientY;
    if (tx >= ir.left && tx <= ir.right && ty >= ir.top && ty <= ir.bottom) {
      ind.style.transition = 'none';
      ind.classList.add('grabbed');
    }
  }, { passive: true });

  tabbar.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!intentDecided) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      intentDecided = true;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) return;   /* 纵向, 放弃 */
      dragging = true;
      _tabbarDragging = true;
      ind.style.transition = 'none';
      ind.classList.add('grabbed');   /* 拖动放大: 瞬时到位, 拖动中恒定 */
      haptic(10);
    }
    if (!dragging) return;

    const pos = indPosForX(e.touches[0].clientX);
    if (!pos) return;

    /* 指示器直接跟手, 无 transition; 拖动中不切页, 松手时再切 */
    if (ind.style.transition !== 'none') ind.style.transition = 'none';
    ind.style.left  = pos.left  + 'px';
    ind.style.width = pos.width + 'px';

    if (pos.best !== lastBest) {
      lastBest = pos.best;
      haptic(6);
    }
  }, { passive: true });

  function onEnd() {
    /* 先挂过渡 (位置snap + 缩放果冻回弹), 再撤 grabbed → 松手同时回弹 */
    ind.style.transition = 'left .38s cubic-bezier(.34,1.48,.64,1), width .38s cubic-bezier(.34,1.48,.64,1), transform .3s cubic-bezier(.34,1.56,.64,1)';
    ind.classList.remove('grabbed');
    if (!dragging) { dragging = false; intentDecided = false; return; }
    dragging = false;
    intentDecided = false;

    _tabbarDragging = false;

    /* 松手时一次性切换到手指最后所在的标签 */
    if (lastBest !== startTab && visNames[lastBest]) {
      switchTab(visNames[lastBest]);
    }

    const activeEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
    if (activeEl) {
      ind.style.left  = activeEl.offsetLeft  + 'px';
      ind.style.width = activeEl.offsetWidth + 'px';
    }
    /* 收尾: 清掉内联过渡, 回归样式表的回弹曲线 */
    setTimeout(() => { if (!_tabbarDragging) { ind.style.transition = ''; } }, 400);
  }

  tabbar.addEventListener('touchend',    onEnd);
  tabbar.addEventListener('touchcancel', onEnd);

  /* 点击其他标签: 缩放果冻放大 → 弹性滑过去 → 缩回 (震动已由 touchstart 触发) */
  tabbar.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    const name = t.id.replace('tab-', '');
    if (name === TAB_NAMES[_curTab]) return;
    /* 恢复样式表过渡 (清掉拖拽遗留的 transition:none), transform 果济曲线由内联提供 */
    ind.style.transition = 'left .38s cubic-bezier(.34,1.48,.64,1), width .38s cubic-bezier(.34,1.48,.64,1), transform .3s cubic-bezier(.34,1.56,.64,1)';
    ind.classList.add('grabbed');
    switchTab(name);
    /* 等弹性滑动结束再缩回 */
    setTimeout(() => { ind.classList.remove('grabbed'); }, 400);
  });
})();

/* ── DOMContentLoaded ── */
document.addEventListener('DOMContentLoaded', async () => {
  /* 主题回显 */
  try {
    if (localStorage.getItem('turbo-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    const tb = document.getElementById('theme-btn');
    if (tb) tb.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  } catch (_) {}

  /* 模糊度恢复 (NaN 守卫: localStorage 脏值不再产生 "NaNpx") */
  try {
    const savedOp = localStorage.getItem('turbo-blur');
    const opN = parseInt(savedOp);
    const val = Number.isFinite(opN) ? Math.max(0, Math.min(40, opN)) : 13;
    const sl = document.getElementById('r-opacity');
    const vl = document.getElementById('v-opacity');
    if (sl) { sl.value = val; syncSl(sl); }
    if (vl) vl.textContent = val;
    document.documentElement.style.setProperty('--blur', val + 'px');
  } catch (_) {}

  /* 背景可见度恢复 */
  try {
    const savedBv = localStorage.getItem('turbo-bgvis');
    const bvN = parseInt(savedBv);
    const bv = Number.isFinite(bvN) ? Math.max(0, Math.min(100, bvN)) : 91;
    const bsl = document.getElementById('r-bgvis');
    const bvl = document.getElementById('v-bgvis');
    if (bsl) { bsl.value = bv; syncSl(bsl); }
    if (bvl) bvl.textContent = bv;
    const bg = document.getElementById('bg-layer');
    if (bg) bg.style.opacity = (bv / 100);
  } catch (_) {}

  /* 背景图 */
  try {
    const bgEl = document.getElementById('bg-layer');
    const bimg = new Image();
    bimg.onload = () => { if (bgEl && !bgEl.style.backgroundImage) bgEl.style.backgroundImage = "url('webui.jpg')"; };
    bimg.src = 'webui.jpg';
    if (bgEl && !bgEl.style.backgroundImage) bgEl.style.backgroundImage = "url('webui.jpg')";
  } catch (_) {}

  /* 入场动画 */
  const hdr = document.querySelector('.hdr');
  if (hdr) hdr.classList.add('in');
  document.querySelectorAll('.card, .card-anim').forEach((c, i) => {
    c.style.setProperty('--del', (i * 35) + 'ms');
    c.classList.add('in');
  });

  /* 事件绑定: 短视频包名 (逐个判空, 单点 id 缺失不中断后续初始化/轮询) */
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('add-btn', 'click', addPackage);
  on('pkg-input', 'keydown', e => { if (e.key === 'Enter') addPackage(); });
  on('clear-log', 'click', () => { const lc = document.getElementById('log-content'); if (lc) lc.innerHTML = ''; pkgLog('日志已清空', 'warning'); });
  on('search-input', 'input', e => {
    const kw = e.target.value.trim().toLowerCase();
    renderPackageList(kw ? _packages.filter(p => p.toLowerCase().includes(kw)) : _packages);
  });
  const pListEl = document.getElementById('package-list');
  if (pListEl) pListEl.addEventListener('click', e => {
    const b = e.target.closest('.delete-btn');
    if (b) deletePackage(b.dataset.pkg);
  });
  document.querySelectorAll('#page-config .row .btn[data-pkg]').forEach(b => {
    b.addEventListener('click', () => {
      const inp = document.getElementById('pkg-input');
      inp.value = b.dataset.pkg;
      inp.focus();
    });
  });

  /* 首次状态 */
  await Promise.all([refreshStatus(), loadPackages()]);
  const tabbarEl = document.getElementById('tabbar');
  if (tabbarEl) tabbarEl.classList.add('in');

  /* 4s 轮询状态 (页面不可见或不在状态页时跳过: 省电, 不占 ksu 通道) */
  setInterval(async () => {
    try {
      if (document.hidden) return;
      if (TAB_NAMES[_curTab] !== 'status') return;
      await refreshStatus();
    } catch (_) {}
  }, 4000);
});
