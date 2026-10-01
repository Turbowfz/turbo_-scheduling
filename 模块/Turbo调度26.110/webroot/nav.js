/* ── Tab 导航 (照抄温控模块) ── */
const TAB_NAMES = ['status','config','cloud','about'];
let _curTab = 0;
let _tabbarDragging = false;   /* 拖拽期间阻止 switchTab 覆盖指示器位置 */

/* ── 震动: 已按需求关闭 (原先 navigator.vibrate 失效时会落 root 兜底,
   而 ksu 通道串行 —— 拖动跨档连震会让滑块卡顿)。保留入口与调用点, 需要时改回即可 ── */
window.haptic = function() {};
function tapVibrate() { haptic(); }

/* 状态刷新避开滑块动画: 刷新要跑 root 命令 (ksu 通道串行), 动画期间会卡住滑块 */
function refreshWhenIdle(fn, delay) {
  setTimeout(function tick() {
    if (window._tabbarAnimating) { setTimeout(tick, 120); return; }
    try { fn(); } catch (_) {}
  }, delay || 0);
}

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
  /* 状态刷新延后到滑块动画结束: 刷新要跑 root 命令, 动画期间会把滑块卡住 */
  if (name === 'status') refreshWhenIdle(refreshStatus, 160);
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

/* ── Tabbar 拖拽/甩动 (物理版): 拖拽阻尼跟手, 松手入弹簧滑行,
   甩出距离由力度决定 (无档位上限), 冲出栏边缘进入缓冲区减速并被弹回,
   落定后切换到落点 tab。物理常量与积分在 physics.js (tests/spring_test.js 同源验证) ── */
(function initTabbarDrag() {
  const tabbar = document.getElementById('tabbar');
  const ind    = document.getElementById('tab-indicator');
  if (!tabbar || !ind || !window.tPhysics) return;
  const P = window.tPhysics;

  let visNames = [], visRects = [];
  let tbLeft = 0, baseLeft = 0;   /* baseLeft: 拖拽/飞行期间指示器 left 冻结为此值, 位移全走 transform */
  let startX = 0, startY = 0;
  let dragging = false, intentDecided = false;
  let lastBest = 0;
  let mode = 'idle';              /* idle | drag | flight */
  let sim = null;                 /* {pos, wid, vel, target, targetW, min, max, over} */
  let raf = 0, lastFrame = 0, flTries = 0;
  let frameAvg = 16, degrade = 0; /* 自适应降级: 0 正常, 1 冻结宽度, 2 去模糊, 3 弹簧刚度加倍提前交 CSS */
  let prevT = 0, prevX = 0, lastT = 0, lastX = 0;   /* 速度采样: 倒数两次 move */
  let pendingTab = '';

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
  function nearestIdx(x) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < visRects.length; i++) {
      const d = Math.abs(x - (visRects[i].left + visRects[i].width / 2));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /* 根据手指 X 计算指示器连续位置 (插值只在可见 tab 之间, left/width 相对 tabbar) */
  function indPosForX(x) {
    const n = visRects.length;
    if (!n) return null;
    const first = visRects[0], last = visRects[n - 1];
    const cx = Math.max(first.left, Math.min(last.right, x));

    let best = lastBest;
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
    return { left: left - tbLeft, width, best };
  }
  function setDegrade(lv) {
    if (lv === degrade) return;
    degrade = lv;
    ind.classList.toggle('noblur', lv >= 2);
  }

  function render() {
    /* left 在拖拽/飞行期间冻结为 baseLeft (抓取时写一次), 每帧只更新 transform 与 width */
    ind.style.transform = 'translateX(' + (sim.pos - baseLeft) + 'px) scale(1.28)';
    if (degrade < 1) ind.style.width = sim.wid + 'px';
  }
  function startLoop(now) {
    window._tabbarAnimating = true;
    if (!raf) { lastFrame = now || 0; raf = requestAnimationFrame(loop); }
  }
  function stopLoop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    window._tabbarAnimating = false;
  }

  function loop(now) {
    /* 本帧回调已触发 → 先清掉 id: 否则末尾的续帧判断永远为假, 循环只跑一帧就死
       (表现为滑块跟手走一下就冻住、甩动停在原地、抓取态永不摘掉) */
    raf = 0;
    const dtMs = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    let dt = dtMs / 1000; if (dt > 0.05) dt = 0.05; if (dt <= 0) dt = 0.016;
    /* 自适应降级: 帧间隔均值 >24ms 逐级降, <17ms 回升 */
    frameAvg = frameAvg * 0.9 + dtMs * 0.1;
    if (frameAvg > 24 && degrade < 3) setDegrade(degrade + 1);
    else if (frameAvg < 17 && degrade > 0) setDegrade(degrade - 1);

    if (mode === 'drag') {
      sim.pos = P.chase(sim.pos, sim.target);
      sim.wid = P.chase(sim.wid, sim.targetW);
      render();
    } else if (mode === 'flight') {
      /* 飞行目标随推进更新 = 最近的 tab; 甩动力度决定飞多远, 边缘缓冲负责拦住 */
      const idx = nearestIdx(tbLeft + sim.pos + sim.wid / 2);
      sim.target  = visRects[idx].left  - tbLeft;
      sim.targetW = visRects[idx].width;
      const k = degrade >= 3 ? P.FLIGHT_K * 4 : P.FLIGHT_K;
      const c = degrade >= 3 ? P.FLIGHT_C * 2 : P.FLIGHT_C;
      P.step(sim, dt, k, c);
      render();
      flTries++;
      const settled = Math.abs(sim.vel) < P.SETTLE_V && Math.abs(sim.pos - sim.target) < P.SETTLE_X;
      if (settled || flTries > 240) { endFlight(); return; }
    } else { stopLoop(); return; }

    raf = requestAnimationFrame(loop);
  }

  /* 落定: 位置/宽度落到目标档并摘掉抓取态 (switchTab 里的 moveIndicator 会用 tab 真实值再校正一次) */
  function endFlight() {
    mode = 'idle';
    sim.pos = sim.target; sim.wid = sim.targetW;
    ind.style.left = sim.pos + 'px';
    ind.style.width = sim.wid + 'px';
    ind.style.transform = '';      /* 清掉内联 transform, 让 CSS 的 grabbed 缩放规则重新生效 */
    ind.style.transition = '';
    ind.classList.remove('grabbed');
    stopLoop();
    if (pendingTab) { const t = pendingTab; pendingTab = ''; switchTab(t); }
  }

  /* 甩动力度 → 目标档 (用于提前切页): 沿速度做衰减扫描, 落点决定 tab */
  function beginFlight(vpx) {
    mode = 'flight'; flTries = 0;
    sim.vel = vpx;                       /* px/s, 甩动力度直接进弹簧 */
    sim.over = 14;                       /* 边缘缓冲区: 最远冲出 14px */
    sim.min = visRects[0].left - tbLeft;
    sim.max = visRects[visRects.length - 1].right - tbLeft - sim.wid;
    let stop = sim.pos, v = vpx;
    for (let i = 0; i < 40 && Math.abs(v) > P.SETTLE_V; i++) { v *= 0.9; stop += v * 0.016; }
    const cx = Math.max(visRects[0].left + sim.wid / 2,
               Math.min(visRects[visRects.length - 1].right - sim.wid / 2, stop + sim.wid / 2));
    pendingTab = visNames[nearestIdx(cx)] || TAB_NAMES[_curTab];
  }

  tabbar.addEventListener('touchstart', e => {
    if (e.target.closest('.tab')) tapVibrate();
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    cacheRects();
    lastBest = Math.max(0, visNames.indexOf(TAB_NAMES[_curTab]));
    dragging = false; intentDecided = false;
    prevT = lastT = 0; prevX = lastX = 0;
    const ir = ind.getBoundingClientRect();
    const tx = e.touches[0].clientX, ty = e.touches[0].clientY;
    const onSlider = tx >= ir.left && tx <= ir.right && ty >= ir.top && ty <= ir.bottom;
    /* 按住滑块 或 飞行中任意位置按住: 截停当前运动, 转入抓取 */
    if (onSlider || mode === 'flight') {
      stopLoop(); mode = 'idle'; pendingTab = '';
      /* 抓取态的 rect 含 scale(1.28) 缩放, 不能当布局值用 —— 用内联样式(未缩放)初始化,
         否则抓取瞬间位置/宽度会被缩放值污染而跳一下 */
      const actEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
      const curL = parseFloat(ind.style.left);
      const curW = parseFloat(ind.style.width);
      baseLeft = isFinite(curL) ? curL : (actEl ? actEl.offsetLeft : 0);
      const baseW = (isFinite(curW) && curW > 0) ? curW : (actEl ? actEl.offsetWidth : ir.width);
      sim = { pos: baseLeft, wid: baseW, vel: 0, target: baseLeft, targetW: baseW,
              min: visRects[0].left - tbLeft,
              max: visRects[visRects.length - 1].right - tbLeft - baseW, over: 14 };
      ind.style.transition = 'none';
      ind.style.left = baseLeft + 'px';
      ind.classList.add('grabbed');
      render();
    }
  }, { passive: true });

  tabbar.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!intentDecided) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      intentDecided = true;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) return;   /* 纵向, 放弃 */
      dragging = true; _tabbarDragging = true; mode = 'drag';
      sim.min = visRects[0].left - tbLeft;
      sim.max = visRects[visRects.length - 1].right - tbLeft - sim.wid;
      sim.over = 0;
      ind.style.transition = 'none';
      ind.classList.add('grabbed');
      haptic(10);
    }
    if (!dragging) return;

    prevT = lastT; prevX = lastX;
    lastT = e.timeStamp; lastX = e.touches[0].clientX;

    const pos = indPosForX(e.touches[0].clientX);
    if (!pos) return;
    sim.target = pos.left; sim.targetW = pos.width;
    if (pos.best !== lastBest) { lastBest = pos.best; haptic(6); }
    startLoop(e.timeStamp);
  }, { passive: true });

  function onEnd() {
    dragging = false; intentDecided = false; _tabbarDragging = false;
    if (mode !== 'drag') {
      /* 只按了一下没拖动: 摘掉抓取态并把位置/宽度交回当前档, 否则会一直保持放大 */
      if (mode === 'idle' && ind.classList.contains('grabbed')) {
        const actEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
        ind.style.transition = '';
        ind.style.transform = '';
        ind.classList.remove('grabbed');
        if (actEl) { ind.style.left = actEl.offsetLeft + 'px'; ind.style.width = actEl.offsetWidth + 'px'; }
      }
      mode = 'idle';
      return;
    }
    /* 甩动速度: 最近两次 move (px/ms → px/s); 时间窗 120ms 外视为静止。
       初速直接进弹簧 —— 甩出距离由力度决定, 落点由 beginFlight 内部按衰减轨迹预估 */
    let v = 0;
    if (lastT && prevT && lastT - prevT > 0 && lastT - prevT < 120) {
      v = (lastX - prevX) / (lastT - prevT) * 1000;
    }
    beginFlight(v);
    startLoop(performance.now());
  }

  tabbar.addEventListener('touchend',    onEnd);
  tabbar.addEventListener('touchcancel', onEnd);

  /* 点击其他标签: FLIP 两段式 —— 先无过渡落到当前视觉位, 再挂弹性过渡滑向目标 */
  tabbar.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t || mode !== 'idle') return;
    const name = t.id.replace('tab-', '');
    if (name === TAB_NAMES[_curTab]) return;
    const el = document.getElementById('tab-' + name);
    if (!el) return;
    ind.style.transition = 'none';
    ind.classList.add('grabbed');
    ind.style.left = el.offsetLeft + 'px';
    ind.style.width = el.offsetWidth + 'px';
    void ind.offsetWidth;
    ind.style.transition = 'left .38s cubic-bezier(.3,1.6,.5,1), width .38s cubic-bezier(.3,1.6,.5,1), transform .3s cubic-bezier(.3,1.65,.45,1)';
    switchTab(name);
    setTimeout(() => { ind.classList.remove('grabbed'); ind.style.transition = ''; }, 420);
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
      if (window._tabbarAnimating) return;   /* 滑块动画中不抢 ksu 通道 */
      await refreshStatus();
    } catch (_) {}
  }, 4000);
});
