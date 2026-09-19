/* ── 状态页 (Scene/云控 + 系统信息) ── */

window.applyDevUI = function(sc) {
  const main = document.getElementById('st-main-card');
  const label = document.getElementById('s-dev');
  const sub = document.getElementById('s-dev-sub');
  const icoRun = document.getElementById('ico-run');
  const icoStop = document.getElementById('ico-stop');
  /* 圈和勾始终显示: 调度启用为绿色, 未启用为灰色, 状态未知不标红 */
  if (icoRun) icoRun.style.display = '';
  if (icoStop) icoStop.style.display = 'none';
  if (main) main.classList.toggle('scene-on', !!sc);
  if (sc === null || sc === undefined) {
    if (label) label.textContent = '状态未知';
    if (sub) sub.textContent = '无法读取调度状态 (exec 通道失败)';
    return;
  }
  if (!sc) {
    if (label) label.textContent = '未启用调度';
    if (sub) sub.textContent = '未安装二改Scene调度';
    return;
  }
  if (label) label.textContent = '调度正常';
  if (sub) sub.textContent = '原调度配置运行中';
};

window.fetchSystemStatus = async function() {
  const SEP = '||SEP||';
  const raw = await execStdout(
    `sc=$([ -f '${SCRC}/sc_installed' ] && echo 1 || echo 0); ` +
    `rc=$([ -f '${SCRC}/rc_installed' ] && echo 1 || echo 0); ` +
    `ct=$([ -f '${SCRC}/sc_installed' ] && cat '${SCRC}/config_type' 2>/dev/null | tr -d '\\r\\n' || echo '-'); ` +
    `gov=$(cat /sys/devices/system/cpu/cpufreq/policy0/scaling_governor 2>/dev/null | tr -d '\\r\\n'); ` +
    `of=$(pgrep -f '[o]iface' >/dev/null 2>&1 && echo 1 || echo 0); ` +
    `ho=$(pgrep -f '[h]orae' >/dev/null 2>&1 && echo 1 || echo 0); ` +
    `ur=$(pgrep -f '[u]rcc' >/dev/null 2>&1 && echo 1 || echo 0); ` +
    `go=$(pgrep -f '[g]ameopt' >/dev/null 2>&1 && echo 1 || echo 0); ` +
    /* 机型名 (上市名) 跨品牌读取链, 依次兜底:
       1 ro.vendor.oplus.market.name       一加/OPPO/Realme (欧加系官方中文名)
       2 ro.product.oplus.marketname       欧加系部分老机
       3 ro.vendor.oplus.market.enname     欧加系英文名
       4 ro.product.marketname             小米/红米/部分品牌上市名
       5 ro.config.marketing_name          华为/荣耀
       6 ro.product.vendor.marketname      vendor分区上市名 (三星部分/华硕等)
       7 ro.vivo.market.name               vivo/iQOO (无则跳过)
       最终兜底: 品牌名+型号 (如 samsung SM-S928B), 再不行仅型号 */
    `mkt=$(getprop ro.vendor.oplus.market.name 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$mkt" ] && mkt=$(getprop ro.product.oplus.marketname 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$mkt" ] && mkt=$(getprop ro.vendor.oplus.market.enname 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$mkt" ] && mkt=$(getprop ro.product.marketname 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$mkt" ] && mkt=$(getprop ro.config.marketing_name 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$mkt" ] && mkt=$(getprop ro.product.vendor.marketname 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$mkt" ] && mkt=$(getprop ro.vivo.market.name 2>/dev/null | tr -d '\\r\\n'); ` +
    `mdl=$(getprop ro.product.model 2>/dev/null | tr -d '\\r\\n'); ` +
    `brd=$(getprop ro.product.brand 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$mkt" ] && [ -n "$brd" ] && [ "$brd" != "$mdl" ] && mkt="$brd $mdl"; ` +
    `[ -z "$mkt" ] && mkt=$mdl; ` +
    `soc=$(getprop ro.soc.model 2>/dev/null | tr -d '\\r\\n'); ` +
    `[ -z "$soc" ] && soc=$(getprop ro.board.platform 2>/dev/null | tr -d '\\r\\n'); ` +
    `plt=$(getprop ro.board.platform 2>/dev/null | tr -d '\\r\\n'); ` +
    `kern=$(uname -r 2>/dev/null | tr -d '\\r\\n'); ` +
    `printf '%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s${SEP}%s' "$sc" "$rc" "$ct" "$gov" "$of" "$ho" "$ur" "$go" "$mkt" "$mdl" "$soc" "$plt" "$kern"`
  );
  const parts = raw.split(SEP);
  /* exec 通道失败/超时时 raw 为空 (不足13段): 返回 null, 由 applySystemStatus 显示"未知" */
  if (parts.length < 13) return null;
  return {
    scene: (parts[0] || '').trim() === '1',
    rc:    (parts[1] || '').trim() === '1',
    configType: (parts[2] || '').trim() || '--',
    governor:   (parts[3] || '').trim() || '--',
    oiface:  (parts[4] || '').trim() === '1',
    horae:   (parts[5] || '').trim() === '1',
    urcc:    (parts[6] || '').trim() === '1',
    gameopt: (parts[7] || '').trim() === '1',
    marketname: (parts[8] || '').trim(),
    model:      (parts[9] || '').trim(),
    soc:        (parts[10] || '').trim(),
    platform:   (parts[11] || '').trim(),
    kernel:     (parts[12] || '').trim()
  };
};

window.applySystemStatus = function(status) {
  /* status=null: exec 通道失败, 全部显示"未知"而不是红色"未启用" */
  const unknown = !status;
  if (unknown) status = { scene: null, rc: null };
  setDot(unknown ? '' : (status.scene ? 'ok' : 'er'));
  const tabDot = document.getElementById('tab-dot-status');
  if (tabDot) tabDot.className = 'tab-dot' + (!unknown && status.scene ? ' visible' : '');
  const sScene = document.getElementById('s-scene');
  const sRc = document.getElementById('s-rc');
  const st = (v) => unknown ? '未知' : (v ? '已启用' : '未启用');
  if (sScene) { sScene.textContent = st(status.scene); sScene.classList.toggle('on', !unknown && !!status.scene); }
  if (sRc) { sRc.textContent = st(status.rc); sRc.classList.toggle('on', !unknown && !!status.rc); }
  /* 页面显隐: 未启用二改调度隐藏短视频包名页, 未启用云控注入隐藏云控页
     (对应功能未部署时其配置文件/数据库流程均无意义, 状态未知时也隐藏以防误操作) */
  const tCfg = document.getElementById('tab-config');
  if (tCfg) tCfg.style.display = (!unknown && status.scene) ? '' : 'none';
  const tCld = document.getElementById('tab-cloud');
  if (tCld) tCld.style.display = (!unknown && status.rc) ? '' : 'none';
  /* 系统信息: 设备型号 marketname(model), 芯片 soc(platform) */
  const sKern = document.getElementById('s-kern'); if (sKern) sKern.textContent = status.kernel;
  const sModel = document.getElementById('s-model');
  if (sModel) sModel.textContent = status.marketname ? status.marketname + '(' + status.model + ')' : (status.model || '--');
  const sChip = document.getElementById('s-chip');
  if (sChip) sChip.textContent = status.soc ? status.soc + '(' + status.platform + ')' : '--';
  /* 调度状态面板: 运行状态 + 官方调度服务进程 */
  const s2Scene = document.getElementById('s2-scene');
  const s2Rc = document.getElementById('s2-rc');
  const s2Type = document.getElementById('s2-type');
  const s2Gov = document.getElementById('s2-gov');
  if (s2Scene) { s2Scene.textContent = st(status.scene); s2Scene.style.color = unknown ? '' : (status.scene ? 'var(--ok)' : 'var(--er)'); }
  if (s2Rc) { s2Rc.textContent = st(status.rc); s2Rc.style.color = unknown ? '' : (status.rc ? 'var(--ok)' : 'var(--er)'); }
  if (s2Type) s2Type.textContent = status.configType === 'generic' ? '通用版' : status.configType === 'oplus' ? 'oplus版' : status.configType;
  if (s2Gov) s2Gov.textContent = status.governor;
  const setProc = (id, alive) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = unknown ? '未知' : (alive ? '运行中' : '未运行');
    el.style.color = unknown ? '' : (alive ? 'var(--ok)' : 'var(--er)');
  };
  setProc('s2-oiface', status.oiface);
  setProc('s2-horae', status.horae);
  setProc('s2-urcc', status.urcc);
  setProc('s2-gameopt', status.gameopt);
  applyDevUI(status.scene);
};

/* ── 信息卡点击切换面板 (照抄温控模块: 系统信息 ↔ 调度状态) ── */
let _infoPanel = 'sysinfo';
let _infoBusy = false;

window.toggleInfoPanel = function() {
  if (_infoBusy) return;
  const pSys  = document.getElementById('panel-sysinfo');
  const pSched = document.getElementById('panel-sched');
  const title = document.getElementById('info-card-title');
  const label = document.getElementById('info-switch-label');
  const icon  = document.getElementById('info-switch-icon');
  if (!pSys || !pSched) return;
  _infoBusy = true;
  /* 与 nav.js 共用统一震动入口 (带 root 兜底) */
  window.haptic ? haptic(6) : (navigator.vibrate && navigator.vibrate(6));
  if (icon) {
    icon.style.transition = 'transform .28s cubic-bezier(.34,1.56,.64,1)';
    icon.style.transform  = 'rotate(180deg) scale(1.2)';
    setTimeout(() => { icon.style.transform = ''; }, 320);
  }
  const outPanel = _infoPanel === 'sysinfo' ? pSys : pSched;
  outPanel.classList.add('info-panel-out');
  setTimeout(() => {
    outPanel.classList.remove('info-panel-out');
    outPanel.style.display = 'none';
    if (_infoPanel === 'sysinfo') {
      pSched.style.display = '';
      if (title) title.textContent = '调度状态';
      if (label) label.textContent = '切换至系统信息';
      _infoPanel = 'sched';
      pSched.classList.add('info-panel-in');
      setTimeout(() => { pSched.classList.remove('info-panel-in'); _infoBusy = false; }, 450);
    } else {
      pSys.style.display = '';
      if (title) title.textContent = '系统信息';
      if (label) label.textContent = '切换至调度状态';
      _infoPanel = 'sysinfo';
      pSys.classList.add('info-panel-in');
      setTimeout(() => { pSys.classList.remove('info-panel-in'); _infoBusy = false; }, 450);
    }
  }, 140);
};

window.refreshStatus = async function() {
  try { applySystemStatus(await fetchSystemStatus()); } catch (_) {}
};
