/* spring_test: 验证 physics.js 的弹簧/边缘物理与 nav.js 使用方式一致。
   纯 node 运行 (physics.js 只挂 window.tPhysics, 无 DOM 依赖)。
   断言: 弹簧收敛、甩向端点的缓冲深度随力度递增且有硬上限、回弹小、
   最终留在端点档、低速自然回落、拖出边缘松手回弹、全程无 NaN。 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
const code = fs.readFileSync(path.join(__dirname, '..', '模块', 'Turbo调度26.113', 'webroot', 'physics.js'), 'utf8');
eval(code);
const P = window.tPhysics;
if (!P) { console.error('FAIL physics.js 未挂载 tPhysics'); process.exit(1); }

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  OK   ' + m); };
const bad = m => { fail++; console.log('  FAIL ' + m); };

const MIN = 0, MAX = 300;   /* 栏宽 300px 的相对坐标 (端点档位 = 端点) */

/* 模拟甩向右端点档的飞行: 与 nav.js 相同 —— 预测式启用边缘 + 深度随越过速度折算。
   返回 {path, escaped, cushion, frames, maxPos, peak, rebound, over, bufFrames} */
function simFlight(v0) {
  const st = { pos: 50, vel: v0, target: MAX, min: MIN, max: MAX, over: P.EDGE_OVER_MIN, edgeOn: false, edgeTab: null };
  const dt = 1 / 60, K = P.FLIGHT_K, C = P.FLIGHT_C;
  let escaped = false, cushion = false, frames = 0, peak = 50, peakAt = 0, afterPeakMin = Infinity, bufFrames = 0;
  const path = [st.pos];
  for (let i = 0; i < 600; i++) {
    st.target = MAX;   /* nav.js: edgeTab 锁定端点档, 与 target=MAX 等价 */
    /* nav.js 的边缘门限: 预测式启用 (高速帧一步就跨过缓冲区, 事后启用会先飞出钳位一帧) */
    const nextPos = st.pos + st.vel * dt;
    if (!st.edgeOn && Math.abs(st.vel) > P.EDGE_V_GATE &&
        (nextPos > st.max || nextPos < st.min || st.pos > st.max || st.pos < st.min)) {
      st.edgeOn = true;
      st.over = Math.min(P.EDGE_OVER_MAX, Math.max(P.EDGE_OVER_MIN, Math.abs(st.vel) / P.EDGE_OVER_VK));
    }
    if (st.edgeOn) { cushion = true; bufFrames++; }
    P.step(st, dt, K, c = C);
    if (st.pos > MAX + P.EDGE_OVER_MAX + 0.5 || st.pos < MIN - P.EDGE_OVER_MAX - 0.5) escaped = true;
    path.push(st.pos); frames++;
    if (st.pos > peak) { peak = st.pos; peakAt = frames; afterPeakMin = Infinity; }
    else if (frames > peakAt && st.pos < afterPeakMin) afterPeakMin = st.pos;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - st.target) < P.SETTLE_X) break;
  }
  return { st, escaped, cushion, path, frames, maxPos: Math.max(...path), peak, rebound: peak - afterPeakMin, over: st.over, bufFrames };
}
var c;   /* step 的 c 参数 (本测试里恒为 FLIGHT_C, 无端点制动) */

/* 1) 甩向端点各级力度: 深度随力度递增、有硬上限、回弹小、最终留在端点档 */
const prof = v => {
  const r = simFlight(v);
  return { depth: +(r.maxPos - MAX).toFixed(1), reb: +r.rebound.toFixed(1), settle: +r.st.pos.toFixed(1),
    ok: !r.escaped && Math.abs(r.st.pos - MAX) < P.SETTLE_X + 0.5, buf: r.bufFrames };
};
const a1 = prof(800), a2 = prof(2000), a3 = prof(4000), a4 = prof(8000);
/* 低力度段深度受振荡相位影响有 ~2px 波动, 单调性从中速起断言 */
if (a2.depth < a3.depth && a3.depth <= a4.depth) ok('力度越大缓冲越深 (' + a1.depth + ' → ' + a2.depth + ' → ' + a3.depth + ' → ' + a4.depth + ')'); else bad('深度未随力度递增: ' + [a1.depth, a2.depth, a3.depth, a4.depth].join('/'));
if (a4.depth <= P.EDGE_OVER_MAX + 0.5) ok('深度有硬上限 (' + a4.depth + ' ≤ ' + P.EDGE_OVER_MAX + ')'); else bad('深度超上限: ' + a4.depth);
if (a3.reb < 60 && a4.reb < 60) ok('回弹不多 (峰后回升 ' + a3.reb + 'px / ' + a4.reb + 'px < 60)'); else bad('回弹过多: ' + a3.reb + '/' + a4.reb);
for (const [n, p] of [['轻甩', a1], ['中甩', a2], ['猛甩', a3], ['极猛', a4]]) {
  if (p.ok) ok(n + '最终留在端点档 pos=' + p.settle); else bad(n + '未留在端点档: ' + p.settle);
}

/* 2) 力度越大在缓冲区里待得越久 (减速越久) */
if (a2.buf <= a3.buf && a3.buf <= a4.buf) ok('力度越大减速越久 (缓冲帧数 ' + a2.buf + ' → ' + a3.buf + ' → ' + a4.buf + ')'); else bad('减速时长未随力度递增: ' + a2.buf + '/' + a3.buf + '/' + a4.buf);

/* 3) 反方向 (v=-800): min=0 侧, 对称行为 */
(function () {
  const st = { pos: 250, vel: -800, target: 0, min: MIN, max: MAX, over: P.EDGE_OVER_MIN, edgeOn: false, edgeTab: null };
  const dt = 1 / 60;
  let escaped = false, maxPen = 0;
  for (let i = 0; i < 600; i++) {
    st.target = 0;
    const nextPos = st.pos + st.vel * dt;
    if (!st.edgeOn && Math.abs(st.vel) > P.EDGE_V_GATE && (nextPos < st.min || nextPos > st.max || st.pos < st.min || st.pos > st.max)) {
      st.edgeOn = true;
      st.over = Math.min(P.EDGE_OVER_MAX, Math.max(P.EDGE_OVER_MIN, Math.abs(st.vel) / P.EDGE_OVER_VK));
    }
    P.step(st, dt, P.FLIGHT_K, P.FLIGHT_C);
    maxPen = Math.min(maxPen, st.pos);
    if (st.pos < MIN - P.EDGE_OVER_MAX - 0.5) escaped = true;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos) < P.SETTLE_X) break;
  }
  if (!escaped) ok('反方向甩动未飞出缓冲区 pos=' + st.pos.toFixed(1)); else bad('反方向甩动飞出!');
  if (maxPen < MIN && maxPen >= MIN - P.EDGE_OVER_MAX) ok('反方向缓冲对称 (浅缓冲 ' + maxPen.toFixed(1) + 'px, 界内)'); else bad('反方向深度异常: ' + maxPen.toFixed(1));
  if (Math.abs(st.pos) < P.SETTLE_X + 0.5) ok('反方向收敛在 min 端 pos=' + st.pos.toFixed(1)); else bad('反方向未收敛: ' + st.pos);
})();

/* 4) 拖出边缘后松手:
   a) 极低速松手 (v=100, 低于门限? 100<240 → 不启用, 弹簧温和拉回)
   b) 中速松手 (v=600 > 门限): 边缘缓冲接管, 小回弹落回端点档 */
(function () {
  const dt = 1 / 60;
  const mk = v => ({ pos: MAX + 8, vel: v, target: MAX, min: MIN, max: MAX, over: P.EDGE_OVER_MIN, edgeOn: false, edgeTab: null });
  let st = mk(100), escaped = false, cushion = false;
  for (let i = 0; i < 600; i++) {
    st.target = MAX;
    const nextPos = st.pos + st.vel * dt;
    if (!st.edgeOn && Math.abs(st.vel) > P.EDGE_V_GATE && (nextPos > st.max || nextPos < st.min || st.pos > st.max || st.pos < st.min)) {
      st.edgeOn = true; st.over = Math.min(P.EDGE_OVER_MAX, Math.max(P.EDGE_OVER_MIN, Math.abs(st.vel) / P.EDGE_OVER_VK));
    }
    if (st.edgeOn) cushion = true;
    P.step(st, 1 / 60, P.FLIGHT_K, P.FLIGHT_C);
    if (st.pos > MAX + P.EDGE_OVER_MAX + 0.5) escaped = true;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - MAX) < P.SETTLE_X) break;
  }
  if (!cushion && !escaped && Math.abs(st.pos - MAX) < P.SETTLE_X + 0.5) ok('极慢拖出界松手: 未达门限, 弹簧温和拉回 pos=' + st.pos.toFixed(1)); else bad('极慢拖出界松手行为异常: cushion=' + cushion + ' pos=' + st.pos.toFixed(1));
  st = mk(600); escaped = false; cushion = false;
  let bounced = false;
  for (let i = 0; i < 600; i++) {
    st.target = MAX;
    const nextPos = st.pos + st.vel * dt;
    if (!st.edgeOn && Math.abs(st.vel) > P.EDGE_V_GATE && (nextPos > st.max || nextPos < st.min || st.pos > st.max || st.pos < st.min)) {
      st.edgeOn = true; st.over = Math.min(P.EDGE_OVER_MAX, Math.max(P.EDGE_OVER_MIN, Math.abs(st.vel) / P.EDGE_OVER_VK));
    }
    if (st.edgeOn) cushion = true;
    const vBefore = st.vel;
    P.step(st, 1 / 60, P.FLIGHT_K, P.FLIGHT_C);
    if (st.pos > MAX + P.EDGE_OVER_MAX + 0.5) escaped = true;
    if (st.pos <= MAX + st.over + 0.01 && vBefore > 0 && st.vel < 0) bounced = true;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - MAX) < P.SETTLE_X) break;
  }
  if (cushion && !escaped && Math.abs(st.pos - MAX) < P.SETTLE_X + 0.5) ok('中速拖出界松手: 边缘缓冲接管并回弹落回端点档 pos=' + st.pos.toFixed(1)); else bad('中速拖出界松手未走缓冲: cushion=' + cushion + ' pos=' + st.pos.toFixed(1) + ' escaped=' + escaped);
  if (bounced) ok('缓冲回弹实测发生 (速度反向)'); else bad('未见回弹');
})();

/* 5) 力度越大过程位移峰值越大 */
const peakOf = v => Math.max(...simFlight(v).path.map((x, i, a) => i ? x - a[i - 1] : 0));
const p1 = peakOf(200), p2 = peakOf(6000);
if (p2 > p1) ok('力度越大位移峰值越大 (' + p1.toFixed(1) + ' → ' + p2.toFixed(1) + ')'); else bad('力度与位移峰值脱钩');

/* 6) 全程无 NaN */
for (const v of [100, 800, 2000, 4000, 8000]) {
  const rr = simFlight(v);
  if (rr.path.every(x => isFinite(x))) ok('v=' + v + ' 全程数值有限'); else bad('v=' + v + ' 出现 NaN/Infinity');
}

console.log('\n结果: 通过 ' + pass + ', 失败 ' + fail);
process.exit(fail ? 1 : 0);
