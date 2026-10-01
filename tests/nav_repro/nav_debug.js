/* ── Tab 导航 (照抄温控模块) ── */
const TAB_NAMES = ['status','config','cloud','about'];
let _curTab = 0;
let _tabbarDragging = false;   /* 拖拽期间阻止 switchTab 覆盖指示器位置 */
let _indTouched = false;       /* 指示器已被用户操作接管: load 回写初始位置/恢复过渡必须让路 */

/* ── 震动: 已按需求关闭 (原先 navigator.vibrate 失效时会落 root 兜底,
   而 ksu 通道串行 —— 拖动跨档连震会让滑块卡顿)。保留入口与调用点, 需要时改回即可 ── */
window.haptic = function() {};
function tapVibrate() { haptic(); }

/* 状态刷新避开滑块动画: 刷新要跑 root 命令 (ksu 通道串行), 动画期间会卡住滑块 */
function refreshWhenIdle(fn, delay) {
  setTimeout(function tick() {
    if (window._tabbarAnimating) { setTimeout(tick, 120); return; }
    try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' refreshFire'); } catch (_) {}
    try { fn(); } catch (_) {}
  }, delay || 0);
}

function moveIndicator(tabEl) {
  if (_tabbarDragging) return;
  const ind = document.getElementById('tab-indicator');
  if (!ind || !tabEl) return;

  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' moveInd tab=' + tabEl.id + ' offL=' + tabEl.offsetLeft + ' offW=' + tabEl.offsetWidth + ' tbLeft=' + document.getElementById('tabbar').getBoundingClientRect().left.toFixed(1) + ' indRectL=' + ind.getBoundingClientRect().left.toFixed(1)); } catch (_) {}  ind.style.left  = tabEl.offsetLeft + 'px';
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
  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + " switchTab " + name); } catch (_) {}
  _indTouched = true;
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
  /* 初始定位只在"用户从未碰过指示器"时执行。页面 load 会因背景图/资源慢而晚于第一次操作,
     那时再回写会把滑块从拖动/飞行/已切换的档位拽回"状态页"; 它顺手恢复的样式表过渡还会让
     落定时的 left 写入变成动画 (先闪回抓取前的位置, 再滑向目标) —— 真机闪回的元凶。
     另外: 拖拽/飞行期间的内联 transition:none 是"落定原子性"的前提, 谁都不能提前清掉 */
  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' load.init touched=' + _indTouched + ' cur=' + TAB_NAMES[_curTab] + ' indL=' + (document.getElementById('tab-indicator') || {}).style.left + ' trans=' + (document.getElementById('tab-indicator') || {}).style.transition); } catch (_) {}
  if (_indTouched) return;
  const firstTab = document.getElementById('tab-status');
  const ind = document.getElementById('tab-indicator');
  if (firstTab && ind) {
    ind.style.transition = 'none';
    moveIndicator(firstTab);
    requestAnimationFrame(() => { if (!_indTouched) ind.style.transition = ''; });
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
  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' init tbLeft=' + tabbar.getBoundingClientRect().left.toFixed(1) + ' tbW=' + tabbar.getBoundingClientRect().width.toFixed(1) + ' indL=' + ind.style.left + ' indW=' + ind.style.width); } catch (_) {}
  function dbg(m) { try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' ' + m); } catch (_) {} }

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
  let _suppressClick = false;   /* 拖动/飞行刚结束: 忽略紧随的 click (鼠标拖拽会额外触发一次) */

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

  /* 当前视觉左缘 (tabbar 坐标) = 内联 left + transform 的 translateX 位移。
     拖拽/飞行期间 inline left 冻结在抓取时的值, 真实位置在 transform 里 ——
     只读 left 会把滑块当成还在抓取前的位置 (闪回根源), 所有"从当前位置接着走"的地方都用它 */
  function visualLeft() {
    const mtx = /translateX\(([-0-9.]+)px\)/.exec(ind.style.transform || '');
    return (parseFloat(ind.style.left) || 0) + (mtx ? parseFloat(mtx[1]) : 0);
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
    try {
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
    } catch (e) {
      dbg('CATCH ' + e.message);
      /* 任何意外都收尾复位, 绝不把滑块留在放大/半路状态 (曾因异常卡住且无法自愈) */
      try { if (window.cloudLog) cloudLog('滑块动画异常已复位: ' + e.message, 'warning'); } catch (_) {}
      mode = 'idle';
      ind.style.transform = '';
      ind.classList.remove('grabbed');
      const actEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
      if (actEl) { ind.style.transition = ''; ind.style.left = actEl.offsetLeft + 'px'; ind.style.width = actEl.offsetWidth + 'px'; }
      stopLoop();
      return;
    }

    raf = requestAnimationFrame(loop);
  }

  /* 落定: 位置/宽度落到目标档并摘掉抓取态 (switchTab 里的 moveIndicator 会用 tab 真实值再校正一次) */
  function endFlight() {
    mode = 'idle';
    sim.pos = sim.target; sim.wid = sim.targetW;
    ind.style.left = sim.pos + 'px';
    ind.style.width = sim.wid + 'px';
    ind.style.transform = '';      /* 清掉内联 transform, 让 CSS 的 grabbed 缩放规则重新生效 */
    ind.classList.remove('grabbed');
    /* 必须先强制一次重排再恢复过渡: 浏览器不会在两个 JS 写之间重算样式, 若在同一任务里就把
       transition 恢复成样式表规则, 上面这次 left 变化会被当成"过渡"从抓取时的旧值慢慢滑过来,
       而 transform 清空是瞬时的 —— 视觉上就是先闪回拖动前的位置、再滑向目标 (真机闪回元凶) */
    void ind.offsetWidth;
    ind.style.transition = '';
    stopLoop();
    /* 落定判定必须按"实际停下的位置"取档 —— 早先按速度做衰减预估, 预测值常与弹簧
       真正停下的档位不一致, 于是落定后又被 switchTab 拽回原档 (表现为滑块突然从原位再移一次) */
    const landIdx = nearestIdx(tbLeft + sim.pos + sim.wid / 2);
    const landTab = visNames[landIdx];
    dbg('endFlight pos=' + sim.pos.toFixed(1) + ' landTab=' + landTab + ' cur=' + TAB_NAMES[_curTab]);
    if (landTab && landTab !== TAB_NAMES[_curTab]) switchTab(landTab);
  }

  /* 释放入弹簧: 初速决定滑行距离 (无档位上限), 目标每帧跟随最近档, 边缘缓冲负责拦住 */
  function beginFlight(vpx) {
    mode = 'flight'; flTries = 0;
    sim.vel = vpx;                       /* px/s, 甩动力度直接进弹簧 */
    sim.over = 14;                       /* 边缘缓冲区: 最远冲出 14px */
    sim.min = visRects[0].left - tbLeft;
    sim.max = visRects[visRects.length - 1].right - tbLeft - sim.wid;
  }

  function gestureStart(tx, ty, ts) {
    dbg('gstart mode=' + mode + ' tf=' + (ind.style.transform || 'none'));
    startX = tx; startY = ty;
    _suppressClick = false;   /* 新手势开始: 上一手势的收尾 click 已不可能再到达 */
    _indTouched = true;       /* 指示器从此归手势逻辑管, load 初始定位不再插手 */
    cacheRects();
    lastBest = Math.max(0, visNames.indexOf(TAB_NAMES[_curTab]));
    dragging = false; intentDecided = false;
    prevT = lastT = ts || 0; prevX = lastX = tx;
    const ir = ind.getBoundingClientRect();
    const onSlider = tx >= ir.left && tx <= ir.right && ty >= ir.top && ty <= ir.bottom;
    dbg('gstart onSlider=' + onSlider);
    /* 按住滑块 或 飞行中任意位置按住: 截停当前运动, 转入抓取 */
    if (onSlider || mode === 'flight') {
      stopLoop(); mode = 'idle';
      /* 抓取态不能用 getBoundingClientRect 当布局值 (含 scale(1.28) 缩放), 也不能只读
         inline left (飞行中它停在抓取前的值, 位移在 transform 里) —— 必须用视觉位置初始化,
         否则抓取瞬间位置会跳变 (曾把滑块瞬移回拖动前的位置) */
      const actEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
      const curL = visualLeft();
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
  }

  function gestureMove(cx, cy, ts) {
    const dx = cx - startX;
    const dy = cy - startY;
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
    lastT = ts || 0; lastX = cx;

    const pos = indPosForX(cx);
    if (!pos) return;
    sim.target = pos.left; sim.targetW = pos.width;
    if (pos.best !== lastBest) { lastBest = pos.best; haptic(6); }
    startLoop(ts || performance.now());
  }

  function onEnd() {
    dbg('onEnd mode=' + mode);
    dragging = false; intentDecided = false; _tabbarDragging = false;
    /* 飞行中收到的 end (另一根手指/另一次点击) 不能把飞行打断在半路 —— 一打断就会停在
       放大态且无人接管的半途位置; 让它照常落定 */
    if (mode === 'flight') return;
    if (mode !== 'drag') {
      /* 只按了一下没拖动 (轻点滑块): 就近落档, 不要回写"当前档" —— 飞行中截停时滑块停在
         半路, 回写当前档 = 突然闪回拖动前的位置 (用户反馈"被重置回原处"的元凶之一) */
      if (mode === 'idle' && ind.classList.contains('grabbed')) {
        _suppressClick = true;   /* 轻点滑块不是"点标签", 收尾 click 不再触发页面切换 */
        let landTab = null;
        if (sim && visRects.length) {
          const li = nearestIdx(tbLeft + sim.pos + sim.wid / 2);
          landTab = visNames[li] || null;
        }
        /* 收尾同样走 FLIP 顺序: 先把"当前视觉位置"固化成 left/width 再清 transform ——
           拖拽/飞行期间位移在 transform 里, 直接清 transform 会瞬移回抓取前的 left */
        const curL = visualLeft();
        const curW = parseFloat(ind.style.width) || (sim ? sim.wid : 0);
        dbg('settle landTab=' + landTab + ' cur=' + TAB_NAMES[_curTab] + ' curL=' + curL.toFixed(1) + ' simPos=' + (sim ? sim.pos.toFixed(1) : 'null'));
        ind.style.transition = 'none';
        ind.style.left = curL + 'px';
        ind.style.width = curW + 'px';
        ind.style.transform = '';
        ind.classList.remove('grabbed');
        void ind.offsetWidth;    /* 强制重排: 上述固化在"无过渡"下立即生效 */
        ind.style.transition = '';   /* 恢复样式表过渡 (left/width 弹性曲线) */
        if (landTab && landTab !== TAB_NAMES[_curTab]) {
          switchTab(landTab);    /* 就近落档: 目标位置由 switchTab 写, 滑块弹滑过去 */
        } else {
          const actEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
          if (actEl) { ind.style.left = actEl.offsetLeft + 'px'; ind.style.width = actEl.offsetWidth + 'px'; }
        }
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
    /* 本手势的收尾 click 一律忽略 (鼠标拖拽必发一次 click; 触摸的兼容 click 可能迟到,
       晚于飞行落定)。标记不设定时器 —— 留到下一次手势开始才清 (见 gestureStart):
       click 到达的时刻在"飞行中/刚落定"之间浮动, 定时器永远猜不准 */
    _suppressClick = true;
    beginFlight(v);
    startLoop(performance.now());
  }

  /* ── 事件绑定: 触摸 (真机) 与鼠标 (桌面预览/调试) 共用同一套手势逻辑 ── */
  let _lastTouchAt = 0;   /* 最近一次触摸事件时刻: 识别触摸兼容鼠标事件用 */
  tabbar.addEventListener('touchstart', e => {
    _lastTouchAt = performance.now();
    if (e.target.closest('.tab')) tapVibrate();
    const t0 = e.touches[0]; gestureStart(t0.clientX, t0.clientY, e.timeStamp);
  }, { passive: true });
  tabbar.addEventListener('touchmove', e => {
    _lastTouchAt = performance.now();
    const t0 = e.touches[0]; gestureMove(t0.clientX, t0.clientY, e.timeStamp);
  }, { passive: true });
  tabbar.addEventListener('touchend',    () => { _lastTouchAt = performance.now(); onEnd(); });
  tabbar.addEventListener('touchcancel', () => { _lastTouchAt = performance.now(); onEnd(); });

  /* 触摸设备上, 每个触摸序列结束后浏览器还会补发一整套"兼容鼠标事件" (mousedown/mouseup/click),
     坐标就是手指位置。其中的 mousedown 会被当成桌面鼠标按下 → 截停正在飞行的滑块、把位置
     重置回抓取前 (用户反馈"甩出去后被重置回原处、变大消失"的直接原因)。
     真机触摸时鼠标路径不该参与 —— 用浏览器标记 + 最近有触摸事件在场 双重识别并忽略 */
  let _mouseDown = false;
  function fromTouch(e) {
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return true;
    return performance.now() - _lastTouchAt < 1000;
  }
  tabbar.addEventListener('mousedown', e => {
    dbg('mousedown guard=' + fromTouch(e) + ' btn=' + e.button);
    if (e.button !== 0 || fromTouch(e)) return;
    _mouseDown = true;
    gestureStart(e.clientX, e.clientY, e.timeStamp);
  });
  window.addEventListener('mousemove', e => {
    if (!_mouseDown) return;
    gestureMove(e.clientX, e.clientY, e.timeStamp);
  });
  window.addEventListener('mouseup', () => {
    if (!_mouseDown) return;
    _mouseDown = false;
    onEnd();
  });

  /* 点击其他标签: FLIP 两段式 —— 先无过渡固化当前视觉位, 再挂过渡滑向目标 */
  tabbar.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    dbg('click suppress=' + _suppressClick + ' mode=' + mode);
    if (_suppressClick) { _suppressClick = false; return; }
    /* 拖动/飞行的收尾 click 与飞行中的点击都直接忽略:
       飞行的落定由 endFlight 负责, 这里一旦"复位到当前档"就会把滑块
       从半路拽回拖动前的位置 (曾把 400ms 的抑制窗当成整个飞行过程, 而飞行要 700~900ms) */
    if (mode !== 'idle') return;
    const name = t.id.replace('tab-', '');
    if (name === TAB_NAMES[_curTab]) return;
    const el = document.getElementById('tab-' + name);
    if (!el) return;
    /* FLIP 顺序必须是: ①无过渡把"当前视觉位置"固化成 left/width (清掉 transform 位移)
       ②强制一次重排让 transition:none 生效 ③挂上过渡 ④由 switchTab 写入目标位置驱动动画。
       反过来先写目标位置再挂过渡 → 位置已是终点, 过渡无事可做 = 瞬移 (曾犯此错) */
    const curL = visualLeft();
    const actEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
    const curW = parseFloat(ind.style.width) || (actEl ? actEl.offsetWidth : 0);
    ind.style.transition = 'none';
    ind.classList.add('grabbed');
    ind.style.transform = '';
    ind.style.left = curL + 'px';
    ind.style.width = curW + 'px';
    void ind.offsetWidth;             /* 强制重排: 上述定位在"无过渡"下立即生效 */
    ind.style.transition = 'left .42s cubic-bezier(.3,1.6,.5,1), width .42s cubic-bezier(.3,1.6,.5,1), transform .34s cubic-bezier(.3,1.65,.45,1)';
    window._tabbarAnimating = true;   /* 这段滑动期间不让状态刷新抢 ksu 通道 (会造成卡顿) */
    switchTab(name);                  /* 写入目标 left/width → 过渡驱动真正的滑动 */
    setTimeout(() => { ind.classList.remove('grabbed'); ind.style.transition = ''; window._tabbarAnimating = false; }, 470);
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

  /* 构建标记: 真机若看到的不是这个号, 说明 WebView 还在跑缓存里的旧文件 */
  window._webuiBuild = '110g-20261001';
  if (window.cloudLog) cloudLog('界面构建: ' + window._webuiBuild, 'info');

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
