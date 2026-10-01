/* 滑块复现脚本 (页面内执行体)。
   模拟真机触摸序列 + WebView 在触摸结束后补发的"兼容鼠标事件"(mousedown/mouseup/click),
   每 25ms 采样滑块位置/缩放, 用过程数据判定。
   关键: 位置一律换算成"相对 tabbar"的坐标 —— 页面内容变化会让整页横向漂移,
   绝对坐标(视口坐标)会失真, 相对坐标不受影响。
   参数 window.__reproParams: { mode:'drag'|'tap'|'intercept'|'scaleanim',
                              steps, durMs, burstDelay, tabFrom, tabTo, hitDelay }  */
const P = window.__reproParams || {};
window.__navLog = [];
const NAMES = ['status', 'config', 'cloud', 'about'];
const tb = document.getElementById('tabbar');
const ind = document.getElementById('tab-indicator');
const byName = {};
NAMES.forEach(n => byName[n] = document.getElementById('tab-' + n));
/* status-page.js 在状态未知时会隐藏「配置/云控」(本地无 ksu 环境即如此)。
   多档位的用例 (改点跟随) 需要 4 个可见档, 用 showAllTabs 打开 —— 打开后必须重新摆一次滑块,
   否则它还是按 2 档布局放置的 (宽 183), 与被测状态对不上 */
if (P.showAllTabs) {
  NAMES.forEach(n => { const e = byName[n]; if (e && e.style.display === 'none') e.style.display = ''; });
  const first = byName[P.tabFrom || 'status'];
  if (first) {
    ind.style.transition = 'none';
    ind.style.left = first.offsetLeft + 'px';
    ind.style.width = first.offsetWidth + 'px';
    void ind.offsetWidth;
    ind.style.transition = '';
  }
}

/* rAF 垫片: 后台标签页 rAF 不触发, 用真实时钟驱动的 setTimeout 代替 */
window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = id => clearTimeout(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scaleOf = () => +(parseFloat(getComputedStyle(ind).scale) || 1).toFixed(3);

const tbLeft0 = tb.getBoundingClientRect().left;
function tabRel() {   /* 各可见档位相对 tabbar 的中心 (隐藏档 width<1 跳过) */
  const out = {};
  for (const n of NAMES) { const r = byName[n].getBoundingClientRect(); if (r.width < 1) continue; out[n] = (r.left + r.width / 2) - tbLeft0; }
  return out;
}
const rel0 = tabRel();
const baseC = rel0[P.tabFrom || 'status'], targetC = rel0[P.tabTo || 'cloud'];

/* ── 采样: 位置 (相对 tabbar 的中心) + 缩放 (计算值, 反映过渡中间态) ── */
const S = [];
const t0 = performance.now();
const timer = setInterval(() => {
  const r = ind.getBoundingClientRect();
  const at = document.querySelector('.tab.active');
  S.push({ t: Math.round(performance.now() - t0),
           c: +((r.left + r.width / 2) - tb.getBoundingClientRect().left).toFixed(1),
           g: ind.classList.contains('grabbed') ? 1 : 0, tab: at ? at.id.replace('tab-', '') : '',
           il: ind.style.left, iw: ind.style.width, tr: ind.style.translate || '', sc: scaleOf() });
}, 25);

function touchEv(type, x, y) {
  const t = new Touch({ identifier: 7, target: tb, clientX: x, clientY: y, pageX: x, pageY: y });
  const ended = (type === 'touchend' || type === 'touchcancel');
  tb.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
    touches: ended ? [] : [t], targetTouches: ended ? [] : [t], changedTouches: [t] }));
}
function mouseEv(type, x, y, target) {
  (target || tb).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, detail: 1 }));
}
/* WebView 兼容鼠标事件序列: 目标 = 手指下方的元素 (标签), 冒泡到 tabbar/window */
function compatBurst(x, y) {
  const hit = document.elementFromPoint(x, y);
  const target = (hit && hit.closest && hit.closest('.tab')) || tb;
  mouseEv('mousedown', x, y, target);
  mouseEv('mouseup',  x, y, target);
  mouseEv('click',    x, y, target);
  return target.id || target.tagName;
}
/* 手动推进动画时钟取样: 测试窗格被遮挡时浏览器不给渲染帧, CSS 过渡时钟停在 0,
   实时采样会得到"点了一下没动/没弹"的假失败; 手动 step 后读到的就是真实过程 */
function stepAnim(from, to, stepMs, pick) {
  const out = [];
  const anims = ind.getAnimations();
  for (let ct = from; ct <= to; ct += stepMs) {
    anims.forEach(a => { try { a.currentTime = ct; } catch (_) {} });
    out.push(ct + ':' + pick());
  }
  return out;
}

const tbr = tb.getBoundingClientRect();
const from = byName[P.tabFrom || 'status'], to = byName[P.tabTo || 'cloud'];
const rectCenter = el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
const x0 = rectCenter(from), x1 = rectCenter(to);
const y = tbr.top + tbr.height / 2;
const geom = () => {
  const tbR = tb.getBoundingClientRect();
  return { tb: [+tbR.left.toFixed(1), +tbR.top.toFixed(1), +tbR.width.toFixed(1)],
    win: [window.innerWidth, window.innerHeight, Math.round(document.documentElement.scrollWidth)],
    tabs: tabRel(), ind: { l: ind.style.left, w: ind.style.width, tr: ind.style.translate, sc: scaleOf(),
      relL: +(ind.getBoundingClientRect().left - tbR.left).toFixed(1) } };
};
const geomStart = geom();
const burstDelay = (P.burstDelay === undefined) ? 20 : P.burstDelay;
const relStep = () => ((ind.getBoundingClientRect().left + ind.getBoundingClientRect().width / 2) - tb.getBoundingClientRect().left).toFixed(1);
let burstTarget = '(none)';
const tapSteps = [], pressSteps = [], relSteps = [];

if (P.mode === 'tap') {
  touchEv('touchstart', x1, y);
  await sleep(40);
  touchEv('touchend', x1, y);
  await sleep(30);
  burstTarget = compatBurst(x1, y);
  await sleep(400);
  try { tapSteps.push(...stepAnim(0, 480, 40, relStep)); } catch (_) {}
  await sleep(700);
} else if (P.mode === 'scaleanim') {
  /* 缩放过程: ①按住滑块 → 放大 (应过冲 >1.28 再回落) ②原地松手 → 缩小 (应欠冲 <1 再回弹) */
  touchEv('touchstart', x0, y);
  await sleep(60);
  try { pressSteps.push(...stepAnim(0, 400, 40, scaleOf)); } catch (_) {}
  touchEv('touchend', x0, y);
  await sleep(150);
  try { relSteps.push(...stepAnim(0, 400, 40, scaleOf)); } catch (_) {}
  await sleep(600);
} else if (P.mode === 'retarget') {
  /* 点按切页 → 移动中改点另一档 (同向/反向由 tabTo2 与 tabTo 的位置关系决定):
     期望 ①移动全程大小不变 ②反向时先按原方向冲过头再弹回 ③最终落到新点的档
     ④到达后才缩小 */
  const x2 = tbLeft0 + rel0[P.tabTo2 || 'status'];
  touchEv('touchstart', x1, y); await sleep(30); touchEv('touchend', x1, y);
  await sleep(30); burstTarget = compatBurst(x1, y);
  await sleep(P.retargetDelay || 130);          /* 滑行进行中 */
  touchEv('touchstart', x2, y); await sleep(30); touchEv('touchend', x2, y);
  await sleep(30); compatBurst(x2, y);
  await sleep(1800);
} else if (P.mode === 'intercept') {
  /* 甩动 → 飞行途中按住滑块截停 → 原地松手 (就近落档) */
  touchEv('touchstart', x0, y);
  await sleep(30);
  for (let i = 1; i <= 4; i++) { await sleep(60); touchEv('touchmove', x0 + (x1 - x0) * (i / 4), y); }
  touchEv('touchend', x1, y);
  await sleep(P.hitDelay || 250);
  const ir = ind.getBoundingClientRect();
  const cx = ir.left + ir.width / 2, cy = ir.top + ir.height / 2;
  touchEv('touchstart', cx, cy);
  await sleep(300);
  touchEv('touchend', cx, cy);
  await sleep(1500);
} else {
  /* 拖动 → 松手飞行 → 落定 (期间穿插兼容鼠标事件) */
  touchEv('touchstart', x0, y);
  await sleep(30);
  const steps = P.steps || 8, dur = P.durMs || 400;
  for (let i = 1; i <= steps; i++) {
    await sleep(dur / steps);
    touchEv('touchmove', x0 + (x1 - x0) * (i / steps), y);
  }
  touchEv('touchend', x1, y);
  if (burstDelay >= 0) { await sleep(burstDelay); burstTarget = compatBurst(x1, y); }
  await sleep(1800);
}
clearInterval(timer);

/* ── 判定 (相对坐标) ── */
const relEnd = tabRel();
const span = targetC - baseC;
let peak = -9, flash = 0, flashAt = null;
for (const s of S) {
  const f = (s.c - baseC) / span;
  if (f > peak) peak = f;
  if (peak > 0.5 && f < 0.25) { flash++; if (flashAt === null) flashAt = s.t; }
}
const last = S[S.length - 1];
const uniq = new Set(S.map(s => s.c)).size;
const at = document.querySelector('.tab.active');
const landed = at ? at.id.replace('tab-', '') : '';
let under = '';
for (const n of Object.keys(relEnd)) {
  const half = byName[n].getBoundingClientRect().width / 2;
  if (Math.abs(last.c - relEnd[n]) <= half + 6) under = n;
}
const grabbedSamples = S.filter(s => s.g).length;
const finalFrac = +((last.c - baseC) / span).toFixed(2);
/* 布局稳定性: 起止两次测得的各档中心必须一致 (页面漂移会让所有判定失真) */
const stable = NAMES.every(n => (rel0[n] === undefined) === (relEnd[n] === undefined)
  && (rel0[n] === undefined || Math.abs(rel0[n] - relEnd[n]) < 2));
const dragOk = stable && uniq >= 5 && peak > 0.5 && flash === 0 && landed === under && grabbedSamples > 0 && !ind.classList.contains('grabbed');
const tapVals = tapSteps.map(s => +s.split(':')[1]);
const tapUniq = new Set(tapVals).size;
const tapFinal = tapVals.length ? tapVals[tapVals.length - 1] : null;
/* 点击滑行现在也是 JS 弹簧 (不是 CSS 过渡), 实时采样就能取到过程; 手动推时钟仅作补充证据 */
const tapOk = stable && uniq >= 5 && Math.abs(last.c - targetC) < 5
  && landed === (P.tabTo || 'cloud') && grabbedSamples > 0 && !ind.classList.contains('grabbed');
/* 缩放: 放大要过冲 (>1.28) 后回到 1.28; 缩小要欠冲 (<1) 后回到 1; 各自要有 ≥5 个中间值 */
const pressVals = pressSteps.map(s => +s.split(':')[1]);
const relVals = relSteps.map(s => +s.split(':')[1]);
const pressUniq = new Set(pressVals).size, relUniq = new Set(relVals).size;
const pressPeak = pressVals.length ? Math.max(...pressVals) : 0;
const pressEnd = pressVals.length ? pressVals[pressVals.length - 1] : 0;
const shrinkMin = relVals.length ? Math.min(...relVals) : 0;
const shrinkEnd = relVals.length ? relVals[relVals.length - 1] : 0;
const scaleOk = pressUniq >= 5 && pressPeak > 1.29 && Math.abs(pressEnd - 1.28) < 0.01
  && relUniq >= 5 && shrinkMin < 0.99 && Math.abs(shrinkEnd - 1) < 0.01;
/* 改点跟随: 移动中不允许缩小; 改点后允许"先冲过头"; 最终落到新点的档, 到达后才缩回 */
const tab2 = P.tabTo2 || 'status';
const c2rel = rel0[tab2];
let ri = -1;
for (let i = 0; i < S.length; i++) { if (S[i].tab === tab2) { ri = i; break; } }   /* 页面切到新档 ≈ 改点时刻 */
const beforeR = ri > 0 ? S[ri - 1].c : null;
const peakAfter = ri >= 0 ? Math.max(...S.slice(ri).map(s => s.c)) : null;
const rebound = (beforeR !== null && peakAfter !== null) ? +(peakAfter - beforeR).toFixed(1) : null;
const moving = S.filter((s, i) => i > 0 && Math.abs(s.c - S[i - 1].c) > 2);
/* 大小是否在移动中变化: 看驱动的类 (grabbed) 而不是计算值 —— 窗格被遮挡时 CSS 过渡时钟不走,
   计算值会停在起点造成假失败; 过渡曲线本身由 scaleanim 模式(手动推时钟)单独验证 */
const shrinkWhileMoving = moving.filter(s => !s.g).length;
const retargetOk = stable && ri >= 0 && shrinkWhileMoving === 0
  && Math.abs(last.c - c2rel) < 5 && landed === tab2 && last.sc > 0.99
  && (P.expectRebound ? (rebound !== null && rebound > 3) : true);

return JSON.stringify({
  ok: (P.mode === 'tap' ? tapOk : (P.mode === 'scaleanim' ? scaleOk : (P.mode === 'retarget' ? retargetOk : dragOk))),
  stable, uniq, flash, flashAt, peak: +peak.toFixed(2), finalFrac,
  landed, under, grabbedSamples, grabbedAtEnd: ind.classList.contains('grabbed'),
  burstTarget, baseC: +baseC.toFixed(1), targetC: +targetC.toFixed(1), finalC: last.c,
  tapUniq, tapFinal, tapSteps,
  pressUniq, relUniq, pressPeak, pressEnd, shrinkMin, shrinkEnd, pressSteps, relSteps,
  retargetIdx: ri, rebound, shrinkWhileMoving, movingSamples: moving.length, c2rel: c2rel === undefined ? null : +c2rel.toFixed(1),
  geomStart, geomEnd: geom(),
  log: window.__navLog || [],
  samples: S.map(s => [s.t, s.c, s.g, s.tab, s.il, s.iw, s.tr, s.sc])
});
