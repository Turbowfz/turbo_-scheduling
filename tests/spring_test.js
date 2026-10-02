/* spring_test: 验证 physics.js 的弹簧/边缘物理与 nav.js 使用方式一致。
   纯 node 运行 (physics.js 只挂 window.tPhysics, 无 DOM 依赖)。
   断言: 弹簧收敛、端点着陆制动 (普通甩动落在端点档, 不冲进边缘缓冲)、
   大力拖出被缓冲区拦下回弹、低速越过不启用边缘、无 NaN。 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
const code = fs.readFileSync(path.join(__dirname, '..', '模块', 'Turbo调度26.112', 'webroot', 'physics.js'), 'utf8');
eval(code);
const P = window.tPhysics;
if (!P) { console.error('FAIL physics.js 未挂载 tPhysics'); process.exit(1); }

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  OK   ' + m); };
const bad = m => { fail++; console.log('  FAIL ' + m); };

const MIN = 0, MAX = 300, OVER = 14;   /* 栏宽 300px 的相对坐标 (端点档位 = 端点) */

/* 模拟甩向右端点档的飞行: 与 nav.js 相同 —— 端点档追加着陆制动, 边缘按 EDGE_V_GATE 门限启用。
   返回 {path, escaped, frames, maxPos, cushion} */
function simFlight(v0, opts) {
  const o = opts || {};
  const st = { pos: 50, vel: v0, target: MAX, min: MIN, max: MAX, over: OVER, edgeOn: false };
  const dt = 1 / 60, K = P.FLIGHT_K, C = P.FLIGHT_C;
  let escaped = false, cushion = false, frames = 0;
  const path = [st.pos];
  for (let i = 0; i < 600; i++) {
    st.target = MAX;
    const toT = st.target - st.pos;
    const dirEnd = st.vel * toT > 0;
    const c = dirEnd ? P.landingC(st.vel, K, C, toT) : C;
    /* nav.js 的边缘门限: 用力越过端点才置位 edgeOn */
    if (!st.edgeOn && Math.abs(st.vel) > P.EDGE_V_GATE && (st.pos > st.max || st.pos < st.min)) st.edgeOn = true;
    if (st.edgeOn) cushion = true;
    P.step(st, dt, K, c);
    if (st.pos > MAX + OVER + 0.5 || st.pos < MIN - OVER - 0.5) escaped = true;
    path.push(st.pos);
    frames++;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - st.target) < P.SETTLE_X) break;
  }
  return { st, escaped, cushion, path, frames, maxPos: Math.max(...path) };
}

/* 1) 温和甩动 (v=800): 端点制动应让它落在端点档上, 不碰边缘缓冲 (最远 ≤ max+2) */
let r = simFlight(800);
if (!r.escaped && isFinite(r.st.pos)) ok('温和甩动收敛 pos=' + r.st.pos.toFixed(1)); else bad('温和甩动未收敛或逃逸');
if (r.maxPos <= MAX + 2) ok('温和甩动不碰边缘 (最远 ' + r.maxPos.toFixed(1) + ' ≤ ' + (MAX + 2) + ')'); else bad('温和甩动冲进了边缘缓冲: 最远 ' + r.maxPos.toFixed(1));
if (r.frames < 240) ok('收敛帧数 ' + r.frames + ' (<4s)'); else bad('收敛过慢: ' + r.frames);

/* 2) 大力甩动 (v=3000): 端点制动兜底, 同样不碰边缘缓冲、落在端点档 */
r = simFlight(3000);
if (!r.escaped && !r.cushion) ok('大力甩动仍被端点制动刹住 (最远 ' + r.maxPos.toFixed(1) + ', 未启用缓冲)'); else bad('大力甩动触发了缓冲/逃逸: 最远 ' + r.maxPos.toFixed(1));
if (Math.abs(r.st.pos - MAX) < P.SETTLE_X + 0.5) ok('大力甩动最终落在端点档 pos=' + r.st.pos.toFixed(1)); else bad('大力甩动未落在端点档: ' + r.st.pos.toFixed(1));

/* 3) 反方向 (v=-800): min=0 侧, 目标 min 端, 同样制动不碰边 */
(function () {
  const st = { pos: 250, vel: -800, target: 0, min: MIN, max: MAX, over: OVER, edgeOn: false };
  const dt = 1 / 60;
  let escaped = false, maxPen = 0;
  for (let i = 0; i < 600; i++) {
    st.target = 0;
    const toT = st.target - st.pos;
    const c = st.vel * toT > 0 ? P.landingC(st.vel, P.FLIGHT_K, P.FLIGHT_C, toT) : P.FLIGHT_C;
    P.step(st, dt, P.FLIGHT_K, c);
    maxPen = Math.min(maxPen, st.pos);
    if (st.pos < MIN - OVER - 0.5) escaped = true;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos) < P.SETTLE_X) break;
  }
  if (!escaped) ok('反方向甩动未飞出缓冲区 pos=' + st.pos.toFixed(1)); else bad('反方向甩动飞出!');
  if (maxPen >= MIN - 2) ok('反方向不碰边缘 (最深 ' + maxPen.toFixed(1) + ' ≥ ' + (MIN - 2) + ')'); else bad('反方向冲进缓冲: ' + maxPen.toFixed(1));
  if (Math.abs(st.pos) < P.SETTLE_X + 0.5) ok('反方向收敛在 min 端 pos=' + st.pos.toFixed(1)); else bad('反方向未收敛: ' + st.pos);
})();

/* 4) 拖出边缘后松手:
   a) 低速松手 (v=100 < EDGE_V_GATE): 不启用边缘, 弹簧温和拉回端点档
   b) 高速松手 (v=600 > 门限): 边缘缓冲接管, 钳在缓冲区内并回弹 */
(function () {
  const mk = v => ({ pos: MAX + 8, vel: v, target: MAX, min: MIN, max: MAX, over: OVER, edgeOn: false });
  let st = mk(100), escaped = false, cushion = false;
  for (let i = 0; i < 600; i++) {
    st.target = MAX;
    if (!st.edgeOn && Math.abs(st.vel) > P.EDGE_V_GATE && (st.pos > st.max || st.pos < st.min)) st.edgeOn = true;
    if (st.edgeOn) cushion = true;
    P.step(st, 1 / 60, P.FLIGHT_K, P.FLIGHT_C);
    if (st.pos > MAX + OVER + 0.5) escaped = true;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - MAX) < P.SETTLE_X) break;
  }
  if (!cushion && !escaped && Math.abs(st.pos - MAX) < P.SETTLE_X + 0.5) ok('慢拖出界松手: 弹簧温和拉回 (未启用缓冲) pos=' + st.pos.toFixed(1)); else bad('慢拖出界松手行为异常: cushion=' + cushion + ' pos=' + st.pos.toFixed(1));
  st = mk(600); escaped = false; cushion = false;
  let bounced = false, minVelAfter = 0;
  for (let i = 0; i < 600; i++) {
    st.target = MAX;
    if (!st.edgeOn && Math.abs(st.vel) > P.EDGE_V_GATE && (st.pos > st.max || st.pos < st.min)) st.edgeOn = true;
    if (st.edgeOn) cushion = true;
    const vBefore = st.vel;
    P.step(st, 1 / 60, P.FLIGHT_K, P.FLIGHT_C);
    if (st.pos > MAX + OVER + 0.5) escaped = true;
    if (st.pos <= MAX + OVER + 0.01 && vBefore > 0 && st.vel < 0) bounced = true;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - MAX) < P.SETTLE_X) break;
  }
  if (cushion && !escaped && Math.abs(st.pos - MAX) < P.SETTLE_X + 0.5) ok('快拖出界松手: 边缘缓冲接管并回弹落回端点档 pos=' + st.pos.toFixed(1)); else bad('快拖出界松手未走缓冲: cushion=' + cushion + ' pos=' + st.pos.toFixed(1) + ' escaped=' + escaped);
  if (bounced) ok('缓冲回弹实测发生 (速度反向)'); else bad('未见回弹');
})();

/* 5) 端点着陆制动特性: 距离越近/速度越快阻尼越大; 远距离低速不追加 */
(function () {
  const c0 = P.landingC(100, P.FLIGHT_K, P.FLIGHT_C, 200);
  const cNear = P.landingC(1000, P.FLIGHT_K, P.FLIGHT_C, 20);
  const cFar = P.landingC(1000, P.FLIGHT_K, P.FLIGHT_C, 300);
  if (c0 - P.FLIGHT_C <= 0.5) ok('低速远距追加量可忽略 (c=' + c0.toFixed(2) + ')'); else bad('低速远距追加过多: c=' + c0.toFixed(2));
  if (cNear > cFar && cNear > P.FLIGHT_C) ok('制动随速度增/随距离减 (' + cFar.toFixed(1) + ' → ' + cNear.toFixed(1) + ')'); else bad('制动梯度异常');
})();

/* 6) 力度越大过程位移峰值越大 (都落在端点档, 差别体现在途中) */
const peak = v => Math.max(...simFlight(v).path.map((x, i, a) => i ? x - a[i - 1] : 0));
const p1 = peak(200), p2 = peak(3000);
if (p2 > p1) ok('力度越大位移峰值越大 (' + p1.toFixed(1) + ' → ' + p2.toFixed(1) + ')'); else bad('力度与位移峰值脱钩');

/* 7) 全程无 NaN */
for (const v of [100, 800, 3000, 6000]) {
  const rr = simFlight(v);
  if (rr.path.every(x => isFinite(x))) ok('v=' + v + ' 全程数值有限'); else bad('v=' + v + ' 出现 NaN/Infinity');
}

console.log('\n结果: 通过 ' + pass + ', 失败 ' + fail);
process.exit(fail ? 1 : 0);
