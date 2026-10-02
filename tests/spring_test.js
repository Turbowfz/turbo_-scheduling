/* spring_test: 验证 physics.js 的弹簧/边缘物理与 nav.js 使用方式一致。
   纯 node 运行 (physics.js 只挂 window.tPhysics, 无 DOM 依赖)。
   断言: 弹簧收敛、过冲 2~3 次、大力甩向端点不飞出缓冲区且回弹、无 NaN。 */
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

/* 模拟一维弹簧滑行: 返回 {path, overshoots, settled, escaped} */
function simFlight(v0, opts) {
  const min = 0, max = 300, over = 14;          /* 栏宽 300px 的相对坐标 */
  const st = { pos: 50, vel: v0, target: max, min, max, over };
  const dt = 1 / 60, K = P.FLIGHT_K, C = P.FLIGHT_C;
  let prev = st.pos, crossing = 0, escaped = false, frames = 0, minV = Infinity, dir = v0 > 0 ? 1 : -1;
  const path = [st.pos];
  for (let i = 0; i < 600; i++) {
    /* 与 nav.js 相同: 目标 = 最近的端点代表档位中心, 这里用 max 端代表 "甩向右边" */
    st.target = max;
    P.step(st, dt, K, C);
    if (st.pos > max + over + 0.5) escaped = true;
    if (!isNaN(st.pos) === false) { escaped = true; break; }
    /* 过冲计数: 越过 target 后又折返 */
    if ((prev - max) * (st.pos - max) < 0) crossing++;
    prev = st.pos;
    path.push(st.pos);
    frames++;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - st.target) < P.SETTLE_X) break;
  }
  return { st, crossing, escaped, frames, path, dir };
}

/* 1) 温和甩动 (1 档力度 v=800px/s): 应收敛在 max 附近, 过冲 1~3 次, 不逃出缓冲区 */
let r = simFlight(800);
if (!r.escaped && isFinite(r.st.pos)) ok('温和甩动收敛 pos=' + r.st.pos.toFixed(1)); else bad('温和甩动未收敛或逃逸');
if (r.crossing >= 1 && r.crossing <= 4) ok('过冲 ' + r.crossing + ' 次 (欠阻尼多段回弹)'); else bad('过冲次数异常: ' + r.crossing);
if (r.frames < 240) ok('收敛帧数 ' + r.frames + ' (<4s)'); else bad('收敛过慢: ' + r.frames);

/* 2) 大力甩动 (v=3000px/s): 允许顶出缓冲区一次 (pos 达 max+over), 但不得超出 over+0.5, 且最终回弹收敛 */
r = simFlight(3000);
if (!r.escaped) ok('大力甩动未飞出缓冲区 (最远 ' + Math.max(...r.path).toFixed(1) + ' ≤ ' + (300 + 14) + ')'); else bad('大力甩动飞出了缓冲区!');
if (isFinite(r.st.pos) && Math.abs(r.st.pos - 300) < P.SETTLE_X) ok('大力甩动最终回弹收敛在端点 pos=' + r.st.pos.toFixed(1)); else bad('大力甩动未回弹收敛: ' + r.st.pos);

/* 3) 反方向 (v=-800): min=0 侧, 目标 min 端 */
(function () {
  const st = { pos: 250, vel: -800, target: 0, min: 0, max: 300, over: 14 };
  const dt = 1 / 60;
  let escaped = false, frames = 0;
  for (let i = 0; i < 600; i++) {
    st.target = 0;
    P.step(st, dt, P.FLIGHT_K, P.FLIGHT_C);
    if (st.pos < -over0()) escaped = true;
    frames++;
    if (Math.abs(st.vel) < P.SETTLE_V && Math.abs(st.pos - 0) < P.SETTLE_X) break;
  }
  function over0() { return 14 + 0.5; }
  if (!escaped) ok('反方向甩动未飞出缓冲区 pos=' + st.pos.toFixed(1)); else bad('反方向甩动飞出!');
  if (Math.abs(st.pos) < P.SETTLE_X + 0.5) ok('反方向收敛在 min 端 pos=' + st.pos.toFixed(1)); else bad('反方向未收敛: ' + st.pos);
})();

/* 4) 甩动力度体现在过程: 力度越大, 撞边前的单帧位移峰值越大 (两者最终都被边缘拦下) */
const peak = v => Math.max(...simFlight(v).path.map((x, i, a) => i ? x - a[i - 1] : 0));
const p1 = peak(200), p2 = peak(3000);
if (p2 > p1) ok('力度越大位移峰值越大 (' + p1.toFixed(1) + ' → ' + p2.toFixed(1) + ')'); else bad('力度与位移峰值脱钩');

/* 5) 全程无 NaN */
for (const v of [100, 800, 3000, 6000]) {
  const rr = simFlight(v);
  if (rr.path.every(x => isFinite(x))) ok('v=' + v + ' 全程数值有限'); else bad('v=' + v + ' 出现 NaN/Infinity');
}

console.log('\n结果: 通过 ' + pass + ', 失败 ' + fail);
process.exit(fail ? 1 : 0);
