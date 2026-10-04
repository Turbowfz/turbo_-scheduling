/* ── 底栏滑块物理 (纯函数, 供 nav.js 与 tests/spring_test.js 共用, 禁止依赖 DOM) ── */
window.tPhysics = {
  DRAG_K: 0.3,        /* 拖拽期阻尼系数: 每帧向手指目标靠近 30% (轻微滞后黏滑) */
  FLIGHT_K: 60,       /* 释放后飞行弹簧刚度 1/s^2 —— 值越小甩得越远, 距离随力度自然缩放 */
  FLIGHT_C: 11,       /* 飞行阻尼 1/s —— ζ≈0.71: 到达带一次轻弹, 不回摆一截再荡过去 */
  EDGE_K_MUL: 3,      /* 缓冲区内刚度倍率: 冲出边缘的部分被加速拉回 (缓冲减速) */
  EDGE_DAMP: 40,      /* 缓冲区内阻尼下限: 冲进去就开始放速度, 到硬钳位时已所剩无几 —— 回弹小 */
  EDGE_BOUNCE: 0.15,  /* 顶到缓冲区硬限时的速度反弹系数 (小反弹: 不返回过多, 最终留在边缘档) */
  SETTLE_V: 25,       /* 落定速度阈值 px/s */
  SETTLE_X: 1.5,      /* 落定距离阈值 px */
  EDGE_V_GATE: 240,   /* px/s: 越过端点时速度高于它才启用边缘缓冲 —— 低速越过属于
                         普通落定的自然过冲/慢拖出界后的松手, 交给弹簧自己拉回 */
  EDGE_OVER_MIN: 14,  /* 缓冲区深度下限 px */
  EDGE_OVER_MAX: 24,  /* 缓冲区深度上限 px: 力度越大冲得越深, 但到此为止 */
  EDGE_OVER_VK: 150,  /* 深度按越过速度折算: over = |v|/150, 钳在 [MIN, MAX] */
  MAX_RELEASE_V: 8000,/* px/s: 松手速度上限。事件时间戳抖动 (两帧落在同一毫秒) 会算出
                         几万 px/s 的假速度, 不设限会把弹簧打进不稳定区 */

  /* 拖拽期阻尼追手: 每帧调用 */
  chase: function (pos, target) { return pos + (target - pos) * this.DRAG_K; },

  /* 飞行/弹簧单步积分: st = {pos, vel, target, min, max, over, edgeOn}, dt 单位秒,
     k/c 按降级档位传入。
     边缘物理只在 st.edgeOn 为真时接管 (nav.js 在"用力越过端点"时置位): 缓冲区内
     刚度×3 + 阻尼加强 (冲进去就开始泄速度, 越深的劲泄得越多 → 减速时长随力度增长),
     顶到硬限时小反弹 —— 回弹少, 最终由弹簧拉回端点档。
     低速越过端点 (edgeOn 未置位) 不钳不弹, 由弹簧自己拉回档位。
     就地更新 st.pos / st.vel 并返回 st。 */
  step: function (st, dt, k, c) {
    const ov = st.over || 0;
    let t = st.target, kk = k, cc = c;
    if (st.edgeOn) {
      if (st.max !== undefined) {
        /* 顶到硬限: 只在"仍向外冲"时小反弹 (0.15), 已被弹回的向内速度不干预 ——
           深度由缓冲内的阻尼/刚度自然决定 (随力度加深), 硬限只兜底 */
        if (st.pos > st.max + ov) { st.pos = st.max + ov; if (st.vel > 0) st.vel *= -this.EDGE_BOUNCE; }
        if (st.pos > st.max) { t = st.max; kk = k * this.EDGE_K_MUL; cc = Math.max(cc, this.EDGE_DAMP); }
      }
      if (st.min !== undefined) {
        if (st.pos < st.min - ov) { st.pos = st.min - ov; if (st.vel < 0) st.vel *= -this.EDGE_BOUNCE; }
        if (st.pos < st.min) { t = st.min; kk = k * this.EDGE_K_MUL; cc = Math.max(cc, this.EDGE_DAMP); }
      }
    }
    /* 稳定性钳制: 显式积分里阻尼项 vel += (-c·vel)·dt 只在 c·dt < 2 时收敛,
       超过就变成正反馈 (速度越大阻尼越大 → 速度更大), 几帧内指数爆炸到 Infinity/NaN。
       端点制动/缓冲阻尼/降级档都会把 c 抬高, 所以在这里统一封顶 (0.9 留安全余量) */
    const cSafe = Math.min(cc, 0.9 / dt);
    const a = kk * (t - st.pos) - cSafe * st.vel;
    st.vel += a * dt;
    st.pos += st.vel * dt;
    /* 积分后二次钳制: 高速帧一步就可能跨过缓冲区, 不钳会飞出栏外 (同样只拦向外的速度) */
    if (st.edgeOn) {
      if (st.max !== undefined && st.pos > st.max + ov) { st.pos = st.max + ov; if (st.vel > 0) st.vel *= -this.EDGE_BOUNCE; }
      if (st.min !== undefined && st.pos < st.min - ov) { st.pos = st.min - ov; if (st.vel < 0) st.vel *= -this.EDGE_BOUNCE; }
    }
    return st;
  }
};
