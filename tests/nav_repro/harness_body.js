/* 滑块"闪回原处"复现脚本 (页面内执行体)。
   模拟真机触摸序列 + WebView 在触摸结束后补发的"兼容鼠标事件"(mousedown/mouseup/click),
   每 25ms 采样滑块位置, 用过程数据判定是否闪回。
   关键: 位置一律换算成"相对 tabbar"的坐标 —— 页面内容变化会让整页横向漂移,
   绝对坐标(视口坐标)会失真, 相对坐标不受影响。
   参数从 window.__reproParams 读: { mode:'drag'|'tap', steps, durMs, burstDelay, tabFrom, tabTo }  */
const P = window.__reproParams || {};
window.__navLog = [];
const NAMES = ['status', 'config', 'cloud', 'about'];
const tb = document.getElementById('tabbar');
const ind = document.getElementById('tab-indicator');
const byName = {};
NAMES.forEach(n => byName[n] = document.getElementById('tab-' + n));

/* rAF 垫片: 后台标签页 rAF 不触发, 用真实时钟驱动的 setTimeout 代替 */
window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = id => clearTimeout(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tbLeft0 = tb.getBoundingClientRect().left;
const relCenter = el => { const r = el.getBoundingClientRect(); return (r.left + r.width / 2) - tbLeft0; };
function tabRel() {   /* 各可见档位相对 tabbar 的中心 (隐藏档 width<1 跳过) */
  const out = {};
  for (const n of NAMES) { const r = byName[n].getBoundingClientRect(); if (r.width < 1) continue; out[n] = (r.left + r.width / 2) - tbLeft0; }
  return out;
}
const rel0 = tabRel();
const baseC = rel0[P.tabFrom || 'status'], targetC = rel0[P.tabTo || 'cloud'];

/* ── 采样 ── */
const S = [];
const t0 = performance.now();
const timer = setInterval(() => {
  const r = ind.getBoundingClientRect();
  const at = document.querySelector('.tab.active');
  const mt = /translateX\(([-0-9.]+)px\)/.exec(ind.style.transform || '');
  S.push({ t: Math.round(performance.now() - t0),
           c: +((r.left + r.width / 2) - tb.getBoundingClientRect().left).toFixed(1),
           g: ind.classList.contains('grabbed') ? 1 : 0, tab: at ? at.id.replace('tab-', '') : '',
           il: ind.style.left, iw: ind.style.width,
           tx: mt ? +parseFloat(mt[1]).toFixed(1) : (ind.style.transform ? 'none' : ''),
           it: (ind.style.transition || '').slice(0, 22) });
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

const tbr = tb.getBoundingClientRect();
const from = byName[P.tabFrom || 'status'], to = byName[P.tabTo || 'cloud'];
const rectCenter = el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
const x0 = rectCenter(from), x1 = rectCenter(to);
const y = tbr.top + tbr.height / 2;
const geom = () => {
  const tbR = tb.getBoundingClientRect();
  return { tb: [+tbR.left.toFixed(1), +tbR.top.toFixed(1), +tbR.width.toFixed(1)],
    win: [window.innerWidth, window.innerHeight, Math.round(document.documentElement.scrollWidth)],
    tabs: tabRel(), ind: { l: ind.style.left, w: ind.style.width, tf: ind.style.transform,
      relL: +(ind.getBoundingClientRect().left - tbR.left).toFixed(1) } };
};
const geomStart = geom();
const burstDelay = (P.burstDelay === undefined) ? 20 : P.burstDelay;
let burstTarget = '(none)';

if (P.mode === 'tap') {
  touchEv('touchstart', x1, y);
  await sleep(40);
  touchEv('touchend', x1, y);
  await sleep(30);
  burstTarget = compatBurst(x1, y);
  await sleep(1200);
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

return JSON.stringify({
  ok: stable && uniq >= 5 && peak > 0.5 && flash === 0 && landed === under && grabbedSamples > 0 && !ind.classList.contains('grabbed'),
  stable, uniq, flash, flashAt, peak: +peak.toFixed(2), finalFrac,
  landed, under, grabbedSamples, grabbedAtEnd: ind.classList.contains('grabbed'),
  burstTarget, baseC: +baseC.toFixed(1), targetC: +targetC.toFixed(1), finalC: last.c,
  geomStart, geomEnd: geom(),
  log: window.__navLog || [],
  samples: S.map(s => [s.t, s.c, s.g, s.tab, s.il, s.iw, s.tx, s.it])
});
