/* 生成调试版 nav.js: 在关键分支插入 window.__navLog 打点, 供复现测试读取。
   源 = 当前(修复版) webroot/nav.js。输出 tests/nav_repro/nav_debug.js */
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', '..', '模块', 'Turbo调度26.110', 'webroot', 'nav.js');
const OUT = path.resolve(__dirname, 'nav_debug.js');

let s = fs.readFileSync(SRC, 'utf8');
const ins = (anchor, add, where) => {
  const i = s.indexOf(anchor);
  if (i < 0) throw new Error('anchor not found: ' + anchor.slice(0, 60));
  const at = where === 'before' ? i : i + anchor.length;
  s = s.slice(0, at) + add + s.slice(at);
};
const DBG = "\n  function dbg(m) { try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' ' + m); } catch (_) {} }";

ins('  const P = window.tPhysics;', DBG);
ins('  function onEnd() {', "\n    dbg('onEnd mode=' + mode);");
ins('  function gestureStart(tx, ty, ts) {', "\n    dbg('gstart mode=' + mode + ' tr=' + (ind.style.translate || 'none') + ' sc=' + (parseFloat(getComputedStyle(ind).scale) || 1));");
ins('    const onSlider = tx >= ir.left && tx <= ir.right && ty >= ir.top && ty <= ir.bottom;',
    "\n    dbg('gstart onSlider=' + onSlider);");
ins('        const curW = parseFloat(ind.style.width) || (sim ? sim.wid : 0);',
    "\n        dbg('settle landTab=' + landTab + ' cur=' + TAB_NAMES[_curTab] + ' curL=' + curL.toFixed(1) + ' simPos=' + (sim ? sim.pos.toFixed(1) : 'null'));");
ins('    const landTab = visNames[landIdx];',
    "\n    dbg('endFlight pos=' + sim.pos.toFixed(1) + ' landTab=' + landTab + ' cur=' + TAB_NAMES[_curTab]);");
ins('    } catch (e) {', "\n      dbg('CATCH ' + e.message);");
/* moveIndicator: 记录 offsetLeft/offsetWidth 写入值与取值来源 (检查坐标基准是否与拖拽用的 rect 一致) */
ins("  ind.style.left  = tabEl.offsetLeft + 'px';",
    "\n  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' moveInd tab=' + tabEl.id + ' offL=' + tabEl.offsetLeft + ' offW=' + tabEl.offsetWidth + ' tbLeft=' + document.getElementById('tabbar').getBoundingClientRect().left.toFixed(1) + ' indRectL=' + ind.getBoundingClientRect().left.toFixed(1)); } catch (_) {}",
    'before');
/* 布局变化监听: 一旦 tabbar/tab 的 rect 在运行中变化, 就能看到 */
ins('  const P = window.tPhysics;',
    "\n  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' init tbLeft=' + tabbar.getBoundingClientRect().left.toFixed(1) + ' tbW=' + tabbar.getBoundingClientRect().width.toFixed(1) + ' indL=' + ind.style.left + ' indW=' + ind.style.width); } catch (_) {}");
/* 延迟刷新实际执行时刻 (它跑 root 命令, 会短暂占住主线程) */
ins('    try { fn(); } catch (_) {}',
    "    try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' refreshFire'); } catch (_) {}\n", 'before');
/* load 初始定位是否执行 (真机闪回的元凶) */
ins('  if (_indTouched) return;',
    "  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + ' load.init touched=' + _indTouched + ' cur=' + TAB_NAMES[_curTab] + ' indL=' + (document.getElementById('tab-indicator') || {}).style.left + ' trans=' + (document.getElementById('tab-indicator') || {}).style.transition); } catch (_) {}\n", 'before');
ins('    if (_suppressClick) { _suppressClick = false; return; }',
    "    dbg('click suppress=' + _suppressClick + ' mode=' + mode);\n", 'before');
ins('    if (e.button !== 0 || fromTouch(e)) return;',
    "    dbg('mousedown guard=' + fromTouch(e) + ' btn=' + e.button);\n", 'before');
/* 点击滑行: 开局参数 / 改点 / 飞行锁与目标变化 */
ins('  function startClickMove(name, el) {', "\n    dbg('startClick ' + name);");
ins("    ind.style.left = baseLeft + 'px';",
    "\n    dbg('startClick.2 baseLeft=' + baseLeft.toFixed(1) + ' baseW=' + baseW.toFixed(1) + ' vis=' + visNames.join(',') + ' tgt=' + (visNames.indexOf(name) >= 0 ? (visRects[visNames.indexOf(name)].left - tbLeft).toFixed(1) : 'X'));");
ins('  function retargetClickMove(name) {', "\n    dbg('retarget ' + name + ' curPos=' + (sim ? sim.pos.toFixed(1) : '?') + ' vel=' + (sim ? sim.vel.toFixed(0) : '?'));");
ins('        const idx = locked >= 0 ? locked : nearestIdx(tbLeft + sim.pos + sim.wid / 2);',
    "\n        if (window.__lastTgt !== idx || window.__lastLock !== locked) { window.__lastTgt = idx; window.__lastLock = locked; dbg('flight tgt=' + idx + ' locked=' + locked + ' pos=' + sim.pos.toFixed(1) + ' lock=' + clickTab); }");
/* 飞行头几帧: 步长/速度/位置/弹簧参数 —— 用来查"起步慢"这类异常 */
ins('        P.step(sim, dt, k, c);',
    "\n        if (flTries < 10) dbg('F' + flTries + ' pos=' + sim.pos.toFixed(2) + ' vel=' + sim.vel.toFixed(0) + ' tgt=' + sim.target.toFixed(1) + ' tw=' + sim.targetW.toFixed(1) + ' k=' + k + ' c=' + c + ' dt=' + dt.toFixed(4) + ' wid=' + sim.wid.toFixed(1));");
// switchTab 在 IIFE 外, 直接内联 push
s = s.replace('  _curTab = idx;', '  _curTab = idx;\n  try { (window.__navLog = window.__navLog || []).push(Math.round(performance.now()) + " switchTab " + name); } catch (_) {}');

fs.writeFileSync(OUT, s, 'utf8');
console.log('nav_debug.js written, dbg 点数 =', (s.match(/dbg\(/g) || []).length);
