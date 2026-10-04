/* ── Tab 导航 (照抄温控模块) ── */
const TAB_NAMES = ['status','config','cloud','about'];
let _curTab = 0;
let _tabbarDragging = false;   /* 拖拽期间阻止 switchTab 覆盖指示器位置 */
let _indTouched = false;       /* 指示器已被用户操作接管: load 回写初始位置/恢复过渡必须让路 */
let _indFrozen = false;        /* 点击滑行期间由 JS 接管位置: switchTab 不许写位置/不许清内联过渡 */

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
  if (_tabbarDragging || _indFrozen) return;
  const ind = document.getElementById('tab-indicator');
  if (!ind || !tabEl) return;
  ind.style.left  = tabEl.offsetLeft + 'px';
  ind.style.width = tabEl.offsetWidth + 'px';
}
/* 只带 scale 的过渡串: 拖拽/飞行期间位置相关属性 (left/width/translate) 必须瞬时生效,
   缩放单独走弹性回弹。曲线要与样式表 .tab-indicator 的 scale 过渡一致 (改一处要同步另一处) */
const IND_SCALE_T = 'scale .34s cubic-bezier(.3,1.6,.5,1)';
/* 恢复滑块样式表过渡 (清除拖拽遗留的内联过渡)。
   点击滑行期间不能清: 那个"只带 scale"的内联过渡是位置瞬时生效的前提 */
function restoreIndicatorTransition() {
  if (_indFrozen) return;
  const ind = document.getElementById('tab-indicator');
  if (!ind) return;
  const t = ind.style.transition;
  if (t === 'none' || t === IND_SCALE_T) ind.style.transition = '';
}

window.switchTab = function(name) {
  const idx = TAB_NAMES.indexOf(name);
  if (idx < 0) return;
  _curTab = idx;
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

  let visNames = [], visRects = [];
  let tbLeft = 0, baseLeft = 0;   /* baseLeft: 拖拽/飞行期间指示器 left 冻结为此值, 位移全走 translate (缩放走独立 scale) */
  let startX = 0, startY = 0;
  let dragging = false, intentDecided = false;
  let lastBest = 0;
  let mode = 'idle';              /* idle | drag | flight */
  let sim = null;                 /* {pos, wid, vel, target, targetW, min, max, over} */
  let raf = 0, lastFrame = 0, flTries = 0;
  let frameAvg = 16, degrade = 0; /* 自适应降级: 0 正常, 1 冻结宽度, 2 去模糊, 3 弹簧刚度加倍提前交 CSS */
  let prevT = 0, prevX = 0, lastT = 0, lastX = 0;   /* 速度采样: 倒数两次 move */
  let _suppressClick = false;   /* 拖动/飞行刚结束: 忽略紧随的 click (鼠标拖拽会额外触发一次) */
  let clickTab = null;          /* 点击滑行锁定的目标档 (null = 甩动飞行, 目标每帧取最近档) */
  let shrinkStarted = false;    /* 本次飞行已提前触发缩回 (grabbed 已摘, endFlight 里不必再摘) */

  function cacheRects() {
    visNames = []; visRects = [];
    /* 基准必须是 tabbar 的"内容盒(padding 边)"左缘: 指示器的 CSS left 相对它, moveIndicator 写的
       tab.offsetLeft 也相对它; 而 getBoundingClientRect 给的是边框盒 —— 差一个 border 宽度
       (实测 ~0.7px)。差这 0.7px 会让边缘逻辑以为滑块一开始就出界, 用 3 倍刚度把它钉住,
       点击切页起步那 ~150ms 的"爬"就是这么来的 */
    const tbr = tabbar.getBoundingClientRect();
    tbLeft = tbr.left + (parseFloat(getComputedStyle(tabbar).borderLeftWidth) || 0);
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

  /* 当前视觉左缘 (tabbar 坐标) = 内联 left + translate 位移 (缩放由 .grabbed 的 scale 负责)。
     拖拽/飞行期间 inline left 冻结在抓取时的值, 真实位置在 translate 里 ——
     只读 left 会把滑块当成还在抓取前的位置 (闪回根源), 所有"从当前位置接着走"的地方都用它 */
  function visualLeft() {
    const tv = parseFloat(ind.style.translate);
    if (isFinite(tv)) return (parseFloat(ind.style.left) || 0) + tv;
    const mtx = /translateX\(([-0-9.]+)px\)/.exec(ind.style.transform || '');
    return (parseFloat(ind.style.left) || 0) + (mtx ? parseFloat(mtx[1]) : 0);
  }

  function render() {
    /* left 在拖拽/飞行期间冻结为 baseLeft (抓取时写一次), 每帧只更新 translate 与 width。
       缩放交给 .grabbed 的独立属性 scale —— 这里若写 transform 会打断 scale 的弹性过渡 */
    ind.style.translate = (sim.pos - baseLeft) + 'px';
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
        /* 飞行目标: 点击滑行锁定到点中的那一档 (移动中改点只换锁 —— 同向直接追过去,
           反向时当前速度会带着滑块先冲过头、像撞到栏边一样回弹, 再落到新档);
           甩动则每帧取最近档: 力度决定飞多远, 边缘缓冲负责拦住。
           edgeTab: 撞过边缘后目标锁死在边缘档 —— 回弹途中最近档会翻回里面一档,
           不锁的话滑块最终就落在里面那档而不是边缘档 (user 要求撞边后只留边缘页) */
        const locked = clickTab ? visNames.indexOf(clickTab) : -1;
        const idx = (sim.edgeTab !== null && sim.edgeTab !== undefined) ? sim.edgeTab
          : (locked >= 0 ? locked : nearestIdx(tbLeft + sim.pos + sim.wid / 2));
        sim.target  = visRects[idx].left  - tbLeft;
        sim.targetW = visRects[idx].width;
        const k = degrade >= 3 ? P.FLIGHT_K * 4 : P.FLIGHT_K;
        let c = degrade >= 3 ? P.FLIGHT_C * 2 : P.FLIGHT_C;
        /* 端点不做着陆制动: 到达端点档的剩余动量自然冲进边缘缓冲 —— 深度/减速时长
           随甩动力度增长 (有 24px 硬上限), 由缓冲物理软着陆, 最终留在边缘档 */
        /* 与 step 内部同一条稳定性钳制: 落定时间估算必须用"实际生效"的阻尼 */
        c = Math.min(c, 0.9 / dt);
        /* 边缘缓冲只归"用力越过端点"的手势: 低速越过 (自然过冲/慢拖出界后松手) 不启用。
           启用判定用"本帧预测位置" —— 高速帧一步就跨过缓冲区, 事后启用会先飞出钳位一帧。
           启用瞬间: 缓冲深度按越过速度折算 (力度越大冲得越深、减速越久), 钳在 14~24px */
        const nextPos = sim.pos + sim.vel * dt;
        if (!sim.edgeOn && Math.abs(sim.vel) > P.EDGE_V_GATE &&
            (nextPos > sim.max || nextPos < sim.min || sim.pos > sim.max || sim.pos < sim.min)) {
          sim.edgeOn = true;
          sim.edgeTab = sim.vel > 0 ? visRects.length - 1 : 0;
          sim.over = Math.min(P.EDGE_OVER_MAX, Math.max(P.EDGE_OVER_MIN, Math.abs(sim.vel) / P.EDGE_OVER_VK));
        }
        P.step(sim, dt, k, c);
        render();
        flTries++;
        /* 数值兜底: 任何 NaN/Infinity 都立即落定 (endFlight 写的是有限的目标值) */
        if (!isFinite(sim.pos) || !isFinite(sim.vel)) { endFlight(); return; }
        /* 缩放提前收 (需求: "将要变为静止时开始缩小, 缩小结束时滑块刚好停止运动"):
           弹簧包络按 e^(-c/2·t) 衰减, 用当前与目标的距离反推还要多久落定 (tRem);
           进入最后一段 (≤0.26s) 就开始缩回, 且缩放过渡的"时长=剩余滑行时间"、
           曲线用后段加载 (ease-in) —— 尺寸的变化集中在最后一段, 过渡结束的一刻
           正好是静止点。用弹性曲线时视觉上 ~半程就已回到 1.0, 之后的位置滑行
           看起来就像"缩小完了还在动" (user 复测指出的)。
           0.26 / 下限 0.12: 收得干脆 (user: "缩小速度再快一点点"; 实测可见缩小耗时
           由 ~230ms 降到 ~170ms, 而收完之后剩余位置位移 ≤1.5px, 察觉不到) */
        if (!shrinkStarted) {
          const d = Math.abs(sim.pos - sim.target);
          const tRem = Math.log(d / P.SETTLE_X) / (c / 2);
          if (d > P.SETTLE_X && tRem <= 0.26) {
            shrinkStarted = true;
            const dur = Math.min(0.26, Math.max(0.12, tRem)).toFixed(2);
            ind.style.transition = 'scale ' + dur + 's cubic-bezier(.7,0,.84,.3)';
            ind.classList.remove('grabbed');
          }
        }
        const settled = Math.abs(sim.vel) < P.SETTLE_V && Math.abs(sim.pos - sim.target) < P.SETTLE_X;
        if (settled || flTries > 240) { endFlight(); return; }
      } else { stopLoop(); return; }
    } catch (e) {
      /* 任何意外都收尾复位, 绝不把滑块留在放大/半路状态 (曾因异常卡住且无法自愈) */
      try { if (window.cloudLog) cloudLog('滑块动画异常已复位: ' + e.message, 'warning'); } catch (_) {}
      mode = 'idle'; clickTab = null; _indFrozen = false;
      ind.style.translate = '';
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
    ind.style.translate = '';      /* 清掉内联位移 (缩放由 .grabbed 类的 scale 独立负责) */
    ind.classList.remove('grabbed');
    /* 必须先强制一次重排再恢复过渡: 浏览器不会在两个 JS 写之间重算样式, 若在同一任务里就把
       transition 恢复成样式表规则, 上面这次 left 变化会被当成"过渡"从抓取时的旧值慢慢滑过来,
       而 translate 清空是瞬时的 —— 视觉上就是先闪回拖动前的位置、再滑向目标 (真机闪回元凶)。
       顺序上先摘 grabbed 再重排: 缩放过渡此刻就开始走 (只带 scale 的内联过渡), 回弹不受影响 */
    void ind.offsetWidth;
    ind.style.transition = '';
    stopLoop();
    /* 落定判定必须按"实际停下的位置"取档 —— 早先按速度做衰减预估, 预测值常与弹簧
       真正停下的档位不一致, 于是落定后又被 switchTab 拽回原档 (表现为滑块突然从原位再移一次) */
    clickTab = null; _indFrozen = false;   /* 滑行结束: 位置交回样式表 / switchTab 校正 */
    /* 撞过边缘的飞行: 落定档直接取锁定的边缘档 (user: 撞边后最终只留在边缘的那个页面);
       位置此刻就在边缘档上, nearestIdx 也只会给出它 —— 显式取值只是把意图写明 */
    const landIdx = (sim.edgeTab !== null && sim.edgeTab !== undefined)
      ? sim.edgeTab : nearestIdx(tbLeft + sim.pos + sim.wid / 2);
    sim.edgeTab = null;
    const landTab = visNames[landIdx];
    if (landTab && landTab !== TAB_NAMES[_curTab]) switchTab(landTab);
  }

  /* 释放入弹簧: 初速决定滑行距离 (无档位上限), 目标每帧跟随最近档, 边缘缓冲负责拦住 */
  function beginFlight(vpx) {
    mode = 'flight'; flTries = 0; shrinkStarted = false; sim.edgeOn = false; sim.edgeTab = null;
    sim.vel = vpx;                       /* px/s, 甩动力度直接进弹簧 */
    sim.over = P.EDGE_OVER_MIN;          /* 边缘缓冲深度: 启用瞬间按力度重折算 (14~24px) */
    sim.min = visRects[0].left - tbLeft;
    sim.max = visRects[visRects.length - 1].right - tbLeft - sim.wid;
  }

  function gestureStart(tx, ty, ts) {
    startX = tx; startY = ty;
    _suppressClick = false;   /* 新手势开始: 上一手势的收尾 click 已不可能再到达 */
    _indTouched = true;       /* 指示器从此归手势逻辑管, load 初始定位不再插手 */
    cacheRects();
    lastBest = Math.max(0, visNames.indexOf(TAB_NAMES[_curTab]));
    dragging = false; intentDecided = false;
    prevT = lastT = ts || 0; prevX = lastX = tx;
    const ir = ind.getBoundingClientRect();
    const onSlider = tx >= ir.left && tx <= ir.right && ty >= ir.top && ty <= ir.bottom;
    /* 按住滑块: 截停当前运动 (含点击滑行), 转入抓取。
       不再"飞行中任意位置按住即截停" —— 那样点击别的档位会被当成截停, 抢掉"移动中改点跟随" */
    if (onSlider) {
      stopLoop(); mode = 'idle'; clickTab = null; _indFrozen = false;
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
              max: visRects[visRects.length - 1].right - tbLeft - baseW, over: P.EDGE_OVER_MIN, edgeOn: false, edgeTab: null };
      ind.style.transition = IND_SCALE_T;   /* 位置冻结要瞬时, 放大走独立 scale 过渡 */
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
      sim.over = 14;   /* 拖动允许把滑块带出端点最多一个缓冲区 ("拖动稍微超过边缘") */
      ind.style.transition = IND_SCALE_T;   /* 拖拽中位置/宽度跟手要瞬时, 缩放保持弹性 */
      ind.classList.add('grabbed');
      haptic(10);
    }
    if (!dragging) return;

    prevT = lastT; prevX = lastX;
    lastT = ts || 0; lastX = cx;

    const pos = indPosForX(cx);
    if (!pos) return;
    sim.target = pos.left; sim.targetW = pos.width;
    /* 拖出端点的部分: 目标允许越过端点最多 over (缓冲区) —— 松手后低速由弹簧拉回档位,
       高速才由边缘缓冲减速回弹 (EDGE_V_GATE 门限) */
    if (visRects.length) {
      const lastR = visRects[visRects.length - 1], firstR = visRects[0];
      if (cx > lastR.right) sim.target = Math.min(sim.max + sim.over, sim.target + (cx - lastR.right));
      else if (cx < firstR.left) sim.target = Math.max(sim.min - sim.over, sim.target - (firstR.left - cx));
    }
    if (pos.best !== lastBest) { lastBest = pos.best; haptic(6); }
    startLoop(ts || performance.now());
  }

  function onEnd() {
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
        /* 收尾同样走 FLIP 顺序: 先把"当前视觉位置"固化成 left/width 再清 translate ——
           拖拽/飞行期间位移在 translate 里, 直接清它会瞬移回抓取前的 left */
        const curL = visualLeft();
        const curW = parseFloat(ind.style.width) || (sim ? sim.wid : 0);
        ind.style.transition = IND_SCALE_T;   /* 位置固化要瞬时, 缩小仍走弹性 scale */
        ind.style.left = curL + 'px';
        ind.style.width = curW + 'px';
        ind.style.translate = '';
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
       初速直接进弹簧 —— 甩出距离由力度决定; 上限防事件时间戳抖动算出的假速度
       (两帧落在同一毫秒会算出几万 px/s, 把弹簧打进不稳定区) */
    let v = 0;
    if (lastT && prevT && lastT - prevT > 0 && lastT - prevT < 120) {
      v = (lastX - prevX) / (lastT - prevT) * 1000;
      const vmax = P.MAX_RELEASE_V;
      if (v > vmax) v = vmax; else if (v < -vmax) v = -vmax;
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

  /* 档位集合变了 (状态刷新切换「配置/云控」两档的显隐) → 每个档的宽度都变, 滑块按旧宽度
     放在旧位置就对不上了。这里重取几何并把它"瞬间"归位到当前档: 不加过渡是因为整栏此刻
     正在重排, 让它跟着一起瞬间落位才自然 (若让它滑过去, 看起来就是"落定后又挪一小段")。
     动画/飞行中不抢位置 —— 飞行每帧都用 visRects 重算目标, 重取几何后它自己会修正 */
  window.syncTabIndicator = function () {
    cacheRects();
    if (mode !== 'idle' || _indFrozen || _tabbarDragging) return;
    const actEl = document.getElementById('tab-' + TAB_NAMES[_curTab]);
    if (!actEl || !visNames.length) return;
    ind.style.transition = 'none';
    ind.style.translate = '';
    ind.style.left = actEl.offsetLeft + 'px';
    ind.style.width = actEl.offsetWidth + 'px';
    void ind.offsetWidth;
    ind.style.transition = '';
  };

  /* 点击切页: 与甩动共用同一套弹簧, 区别只在"目标锁定"(锁到点中的那一档), 于是移动中改点
     能自然重定向 —— 同向直接追过去; 反向时当前速度会带着滑块先冲过头 (撞到栏边的手感)
     再回弹到新档。缩放从点下开始放大、到落定 (endFlight) 才缩回, 中途改目标不动大小 */
  function startClickMove(name, el) {
    cacheRects();
    if (visNames.indexOf(name) < 0) return;   /* 该档当前不可见 (被状态页隐藏): 不滑行 */
    stopLoop();
    mode = 'idle';
    const lv = parseFloat(ind.style.left);
    const curL = visualLeft();
    baseLeft = isFinite(lv) ? curL : el.offsetLeft;   /* 内联 left 还没写过时退回该档真实位置 */
    const curW = parseFloat(ind.style.width);
    const baseW = (isFinite(curW) && curW > 0) ? curW : el.offsetWidth;
    sim = { pos: baseLeft, wid: baseW, vel: 0, target: baseLeft, targetW: baseW,
            min: visRects[0].left - tbLeft,
            max: visRects[visRects.length - 1].right - tbLeft - baseW, over: P.EDGE_OVER_MIN, edgeOn: false, edgeTab: null };
    ind.style.transition = IND_SCALE_T;   /* 位置瞬时接管, 放大走弹性 scale */
    ind.style.left = baseLeft + 'px';
    ind.style.translate = '0px';
    ind.classList.add('grabbed');         /* 点下即放大; 到达落定前不再动大小 */
    clickTab = name;
    _indFrozen = true;                    /* 这段滑行由 JS 接管: switchTab 不许写位置/清过渡 */
    mode = 'flight'; flTries = 0; shrinkStarted = false;
    switchTab(name);                      /* 页面立即切换 (与旧行为一致) */
    startLoop(performance.now());
  }
  /* 移动中改点: 只换锁定目标 + 立即切页, 位置与大小都交给弹簧接着走 */
  function retargetClickMove(name) {
    clickTab = name;
    switchTab(name);
    /* 缩放已提前收但新目标还很远: 重新放大, 收尾时序作废 (由新一段飞行重算) */
    if (shrinkStarted && sim && visRects.length) {
      const li = visNames.indexOf(name);
      if (li >= 0 && Math.abs(sim.pos - (visRects[li].left - tbLeft)) > 24) {
        shrinkStarted = false;
        ind.classList.add('grabbed');
      }
    }
    if (!raf) { mode = 'flight'; startLoop(performance.now()); }   /* 保险: 循环必须在跑 */
  }

  tabbar.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    if (_suppressClick) { _suppressClick = false; return; }
    const name = t.id.replace('tab-', '');
    const el = document.getElementById('tab-' + name);
    if (!el) return;
    /* 点击滑行中再点: 优先跟随用户 —— 换目标, 不打断 (弹簧自己决定是直接追还是先撞再弹) */
    if (clickTab) { retargetClickMove(name); return; }
    /* 拖动/甩动的收尾 click 与甩动飞行中的点击忽略: 落定由 endFlight 负责 */
    if (mode !== 'idle') return;
    if (name === TAB_NAMES[_curTab]) return;
    startClickMove(name, el);
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
  window._webuiBuild = '113b-20261005';
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
