/* ── 底栏滑块物理 (纯函数, 供 nav.js 与 tests/spring_test.js 共用, 禁止依赖 DOM) ── */
window.tPhysics = {
  DRAG_K: 0.3,        /* 拖拽期阻尼系数: 每帧向手指目标靠近 30% (轻微滞后黏滑) */
  FLIGHT_K: 60,       /* 释放后飞行弹簧刚度 1/s^2 —— 值越小甩得越远, 距离随力度自然缩放 */
  FLIGHT_C: 11,       /* 飞行阻尼 1/s —— ζ≈0.71: 到达带一次轻弹, 不回摆一截再荡过去 */
  EDGE_K_MUL: 3,      /* 缓冲区内刚度倍率: 冲出边缘的部分被加速拉回 (缓冲减速) */
  EDGE_BOUNCE: 0.35,  /* 顶出缓冲区时的速度反弹系数 */
  SETTLE_V: 25,       /* 落定速度阈值 px/s */
  SETTLE_X: 1.5,      /* 落定距离阈值 px */

  /* 拖拽期阻尼追手: 每帧调用 */
  chase: function (pos, target) { return pos + (target - pos) * this.DRAG_K; },

  /* 飞行/弹簧单步积分: st = {pos, vel, target, min, max, over}, dt 单位秒, k/c 按降级档位传入。
     边缘物理: [min, max] 是栏两端; 允许越出 over 一小段作缓冲, 缓冲区内刚度×3 减速,
     顶出缓冲区则硬钳并原速反弹 —— 滑块最远只冲到边缘外一点点。
     就地更新 st.pos / st.vel 并返回 st。 */
  step: function (st, dt, k, c) {
    const ov = st.over || 0;
    let t = st.target, kk = k;
    if (st.max !== undefined) {
      if (st.pos > st.max + ov) { st.pos = st.max + ov; st.vel *= -this.EDGE_BOUNCE; }
      if (st.pos > st.max) { t = st.max; kk = k * this.EDGE_K_MUL; }
    }
    if (st.min !== undefined) {
      if (st.pos < st.min - ov) { st.pos = st.min - ov; st.vel *= -this.EDGE_BOUNCE; }
      if (st.pos < st.min) { t = st.min; kk = k * this.EDGE_K_MUL; }
    }
    const a = kk * (t - st.pos) - c * st.vel;
    st.vel += a * dt;
    st.pos += st.vel * dt;
    /* 积分后二次钳制: 高速帧一步就可能跨过缓冲区, 不钳会飞出栏外 */
    if (st.max !== undefined && st.pos > st.max + ov) { st.pos = st.max + ov; st.vel *= -this.EDGE_BOUNCE; }
    if (st.min !== undefined && st.pos < st.min - ov) { st.pos = st.min - ov; st.vel *= -this.EDGE_BOUNCE; }
    return st;
  }
};
