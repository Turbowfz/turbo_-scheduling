/* ── 路径常量 (全部页面共享) ── */
const MODDIR      = '/data/adb/modules/Turbo_Scheduling';
const SCRC        = '/data/adb/turbo';
const PKG_CFG     = '/data/data/com.omarea.vtools/files/categories.json';
const SC_SCRIPT   = MODDIR + '/scripts/scene_config.sh';
/* 云控页 (cloud-io / cloud-form / cloud-page 共用) */
const CCCF        = MODDIR + '/cccf';
const BKC         = MODDIR + '/cccf_backup';
/* COSA 数据库工具 (Rust 二进制, 子命令接口; 数据库路径由工具内部发现) */
const COSA        = MODDIR + '/bin/cosa';

/* ── execFull: 完整 exec 结果 (错误码/输出/超时区分), 供写操作与关键读操作校验 ──
   关键: 实测 WebUI 的 ksu.exec 不经过 shell, 复合命令 (; && ||) 会整体失败,
   这里统一把命令经 base64 交给 sh -c 执行 —— 引号/特殊字符零转义问题 */
window.execFull = function(cmd, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const tmo = timeoutMs || 10000;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish({ ec: -1, out: '', err: '', timeout: true }), tmo);
    /* base64 包一层: sh -c "eval $(echo <b64> | base64 -d)" —— 命令内任何引号组合都安全 */
    let wrapped = cmd;
    try {
      wrapped = 'sh -c "eval $(echo ' + btoa(unescape(encodeURIComponent(cmd))) + ' | base64 -d)"';
    } catch (_) {}
    try {
      if (typeof ksu !== 'undefined' && ksu && ksu.exec) {
        const cb = 'excb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        window[cb] = function(ec, out, err) {
          try { delete window[cb]; } catch (_) {}
          clearTimeout(timer);
          const code = (ec === 0 || ec === '0') ? 0 : (typeof ec === 'number' ? ec : -1);
          finish({ ec: code, out: (out || '').trim(), err: (err || '').trim(), timeout: false });
        };
        ksu.exec(wrapped, "{}", cb);
        return;
      }
    } catch (_) {}
    try {
      if (typeof mmrl !== 'undefined' && mmrl && mmrl.exec) {
        mmrl.exec(wrapped).then(r => {
          clearTimeout(timer);
          finish({ ec: 0, out: (r && r.stdout || '').trim(), err: (r && r.stderr || '').trim(), timeout: false });
        }).catch(e => {
          clearTimeout(timer);
          finish({ ec: -1, out: '', err: String(e || ''), timeout: false });
        });
        return;
      }
    } catch (_) {}
    clearTimeout(timer);
    finish({ ec: -1, out: '', err: 'no-exec-channel', timeout: false });
  });
};

/* ── execStdout (回调形式, 兼容各版本 KsuWebUI): 语义与旧版一致, 仅供读操作 ──
   写文件/写库一律用 execFull 或 writeFileChecked 自行校验结果 */
window.execStdout = async function(cmd, timeoutMs) {
  const r = await execFull(cmd, timeoutMs);
  return r.ec === 0 ? r.out : '';
};

/* ── UTF-8 安全 base64 (写文件用, 避免 echo 转义/换行问题; 供 pkg/cloud 等页共享) ── */
window.toB64 = function(s) { return btoa(unescape(encodeURIComponent(s))); };

/* 校验式写文件: base64 分块 (≤60KB/段, 规避 MAX_ARG_STRLEN=128KB) 原子写入, 成功必须回显 __T_OK__ */
window.writeFileChecked = async function(path, content) {
  const b64 = toB64(content);
  const tmp = path + '.b64tmp';
  let cmd = `rm -f '${tmp}'`;
  for (let i = 0; i < b64.length; i += 60000) {
    cmd += `; printf '%s' '${b64.slice(i, i + 60000)}' >> '${tmp}'`;
  }
  cmd += `; base64 -d '${tmp}' > '${path}' && rm -f '${tmp}' && echo __T_OK__`;
  const r = await execFull(cmd, 30000);
  if (r.timeout) throw new Error('写入超时 (命令可能仍在后台执行, 请稍后确认)');
  if (!r.out.includes('__T_OK__')) {
    throw new Error('写入失败: ' + (r.out || r.err || ('exec 退出码 ' + r.ec)));
  }
  return true;
};

/* ── UI 工具 ── */
window.setDot = function(c) {
  const el = document.getElementById('dot');
  if (el) el.className = c;
};

window.popBtn = function(el) {
  if (!el) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
};

window.syncSl = function(el) {
  if (!el) return;
  const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100;
  const val = parseFloat(el.value) || min;
  el.style.setProperty('--p', ((val - min) / (max - min) * 100).toFixed(1) + '%');
};

window.escapeHTML = function(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[t] || t));
};

/* ── 视口缩放 (fontSize 随宽度微缩; CSS 只用 rem/font-size, 无 --vp-scale 引用) ── */
(function applyViewportScale() {
  function calc() {
    const vw = window.innerWidth || document.documentElement.clientWidth || 390;
    const scale = Math.max(0.87, Math.min(1.10, vw / 390));
    document.documentElement.style.fontSize = (14 * scale).toFixed(2) + 'px';
  }
  calc();
  window.addEventListener('resize', calc, { passive: true });
})();
