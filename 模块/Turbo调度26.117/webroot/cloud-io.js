/* ── 云控页 · 数据 IO 层 (cosa 工具版) ──
   依赖 core.js (MODDIR/CCCF/execStdout/execFull/writeFileChecked/toB64/escapeHTML)
   DB 操作全部走 bin/cosa (Rust 工具, 单命令子接口): check / list / list-cloud / read / read-cloud / write / delete / sync / localize / protect / unprotect / diag
   WebUI 只发单命令, 无 SQL 命令行参数/无复合命令/无引号转义 —— 免疫宿主 exec 怪癖 */

/* ═══ cosa 子命令调用 (单命令) ═══ */
async function cosa(sub, ...args) {
  /* LD_LIBRARY_PATH 双保险: cosa 已烧 rpath, 显式指定可防模块路径变动 */
  const cmd = ['LD_LIBRARY_PATH=' + MODDIR + '/bin', COSA, sub, ...args].join(' '); const r = await execFull(cmd, 60000); return { ok: r.ec === 0, out: r.out || '', err: r.err || '', ec: r.ec, timeout: r.timeout };
}

/* root 命令执行探针: 区分 "命令失败" 与 "exec 通道不可用" */
async function execAlive() {
  const probe = await execStdout('echo __T_ALIVE__'); return probe.includes('__T_ALIVE__');
}

/* 文件名/包名白名单: 这些值会拼进 root shell 与文件路径, 配置 JSON 可能来自他人分享 —— 单引号可逃逸成任意 root 命令, ../ 可路径穿越 */
function safeName(s) { return /^[A-Za-z0-9._-]+$/.test(String(s || '')); }

/* 按钮 busy 包装: 执行期间禁用按钮, 防双击并发 */
async function withBusy(btn, fn) {
  if (!btn) return fn(); if (btn.disabled) return; const txt = btn.textContent; btn.disabled = true; btn.textContent = txt + '...'; try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = txt; }
}

/* DB 列中需要解包的 JSON 字符串字段 (DB 存转义字符串, 编辑器展示为对象) */
const DB_JSON_COLS = ['cpu_config','gpu_config','io_config','dynamic_resolution','launch_boost','usage_power_ratio', 'memory_clear','frameBoost','refresh_rate','gpa_config','sdk_config','other','data_collector','simple_client', 'cool_ex','lighting_start','prison','tgpa_client','game_zone','bind_core','decision','control','game_loading', 'game_loading_finish','game_start','game_stop','game_status','game_switch','game_config','perf_mode','target_fps', 'thermal_frame','unity_game_boost','fps_stabilizer','bg_update','resv_7','resv_8','resv_9','resv_10','resv_11', 'resv_12','resv_13']; /* 行对象: 嵌套 JSON 字符串解包为对象 (供表单/文本编辑); from_server 保留数值 */
function unfoldRow(row) {
  for (const c of DB_JSON_COLS) {
    const v = row[c]; if (typeof v === 'string' && v !== '' && (v.startsWith('{') || v.startsWith('['))) {
      try { row[c] = JSON.parse(v); } catch (_) {}
    }
  }
  return row;
}

/* ── cccf 文件列表 (填充 UI 版下拉 + 数量徽标) ── */
window.loadCloudFiles = async function() {
  const sel1 = document.getElementById('cf-base-file'); const badge = document.getElementById('cloud-badge'); try {
    if (!(await execAlive())) {
      cloudLog('无法执行 root 命令 (ksu.exec 不可用或超时), 请确认已授权', 'error'); return; }
    const raw = await execStdout(`ls '${CCCF}'/*.json 2>/dev/null | sed 's|.*/||'; ls '${CCCF}'/*.enc 2>/dev/null | sed 's|.*/||'`); const files = raw.split('\n').map(s => s.trim()).filter(Boolean); const jsons = files.filter(f => f.endsWith('.json')); const encs = files.filter(f => f.endsWith('.enc')); const opts = '<option value="">— 选择游戏配置 —</option>' +
      jsons.map(f => `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`).join('') +
      encs.map(f => `<option value="${escapeHTML(f)}" disabled>${escapeHTML(f)} (加密)</option>`).join(''); if (sel1) { const prev = sel1.value; sel1.innerHTML = opts; sel1.value = files.includes(prev) ? prev : ''; }
    if (badge) badge.textContent = jsons.length + ' json · ' + encs.length + ' enc'; } catch (e) {
    cloudLog('加载 cccf 列表失败: ' + e.message, 'error'); }
}; /* ── 数据库已建档游戏列表 (cosa list) ── */
window.loadDbPackages = async function() {
  const sel = document.getElementById('cf-db-pkg'); if (!sel) return; try {
    if (!(await execAlive())) { cloudLog('无法执行 root 命令, 数据库游戏列表未加载', 'error'); return; }
    const r = await cosa('list'); if (!r.ok) {
      sel.innerHTML = '<option value="">— 未找到 COSA 数据库 —</option>'; cloudLog('读取数据库列表失败: ' + (r.out || r.err || '数据库不存在, 需先打开过一次游戏'), 'error'); return; }
    const pkgs = r.out.split('\n').map(s => s.trim()).filter(Boolean);
    /* 标出库里有"官方下发"行 (from_server != 0) 的游戏: 这些可以直接点「☁ 获取云端配置」 */
    let cloud = new Set(); const rc = await cosa('list-cloud'); if (rc.ok) cloud = new Set(rc.out.split('\n').map(s => s.trim()).filter(Boolean));
    const prev = sel.value; sel.innerHTML = '<option value="">— 数据库已建档游戏 (' + pkgs.length + ', 官方下发 ' + cloud.size + ') —</option>' +
      pkgs.map(p => `<option value="${escapeHTML(p)}">${cloud.has(p) ? '☁ ' : ''}${escapeHTML(p)}</option>`).join(''); sel.value = pkgs.includes(prev) ? prev : ''; cloudLog('数据库游戏: ' + pkgs.length + ' 个' + (cloud.size ? ', 其中 ' + cloud.size + ' 个已有官方下发配置 (标 ☁)' : ''), pkgs.length ? 'info' : 'warning'); } catch (e) { cloudLog('数据库游戏列表加载失败: ' + e.message, 'error'); }
}; /* ═══════════ UI 版: 选择/保存 (本地 cccf 文件) ═══════════ */

/* 粘贴 JSON 载入 UI 表单 (WebView 无剪贴板读权限 → 展开文本区手动粘贴, 不用 Clipboard API)
   只展开、不折叠 (幂等: 即使被重复触发也不会把文本区收起来); 折叠由「取消」按钮负责 */
window.pasteBaseConfig = function() {
  const box = document.getElementById('cf-base-paste-box'); const ta = document.getElementById('cf-base-paste-text'); if (!box || !ta) return; box.style.display = 'block'; ta.focus(); cloudLog('长按文本区"粘贴"贴入完整 JSON, 再点"载入表单"', 'info');
}; /* 解析粘贴文本 → 载入表单 (校验对象与 package_name, 失败不覆盖当前配置) */
window.loadBaseConfigFromPaste = function() {
  const ta = document.getElementById('cf-base-paste-text'); const text = (ta ? ta.value : '').trim(); if (!text) { cloudLog('请先粘贴 JSON 文本', 'warning'); return; }
  let obj; try {
    obj = JSON.parse(text); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('内容不是 JSON 对象'); if (!obj.package_name) throw new Error('配置缺少 package_name'); } catch (e) { cloudLog('JSON 解析失败: ' + e.message, 'error'); return; }
  _baseObj = obj; const file = document.getElementById('cf-base-file'); if (file) {
    const name = obj.package_name + '.json'; if (!Array.from(file.options || []).some(o => o.value === name)) {
      const op = document.createElement('option'); op.value = name; op.textContent = name; file.appendChild(op); }
    file.value = name; }
  renderBaseForm(); const box = document.getElementById('cf-base-paste-box'); if (box) box.style.display = 'none'; if (ta) ta.value = ''; cloudLog('已从粘贴文本载入: ' + obj.package_name + ' (编辑后点"保存到 cccf")', 'success');
}; window.onBaseFile = async function() {
  const name = document.getElementById('cf-base-file').value; if (!name) { _baseObj = null; renderBaseForm(); return; }
  if (!safeName(name)) { cloudLog('文件名异常: ' + name, 'error'); return; }
  try {
    const content = await execStdout(`cat '${CCCF}/${name}' 2>/dev/null`); if (!content.trim()) throw new Error('文件为空或读取失败'); _baseObj = JSON.parse(content); renderBaseForm(); cloudLog('已加载基础编辑: ' + name, 'success'); } catch (e) {
    _baseObj = null; renderBaseForm(); cloudLog('加载失败 (' + name + '): ' + e.message, 'error'); }
}; window.saveBaseConfig = async function() {
  await withBusy(document.getElementById('cf-base-save'), async () => {
    const name = document.getElementById('cf-base-file').value; if (!name || !_baseObj) { cloudLog('请先选择游戏配置', 'warning'); return; }
    if (!safeName(name)) { cloudLog('文件名异常, 已拒绝保存: ' + name, 'error'); return; }
    try {
      const obj = collectBaseForm(); obj.from_server = 0; clampFsTemp(obj); /* 保存到 cccf = 本地配置 (区分云端下发值); fps_stabilizer.temp 与 from_server 同批只抬不压 */
      const j = JSON.stringify(obj, null, 2); await writeFileChecked(`${CCCF}/${name}`, j); cloudLog('已保存到 cccf: ' + name, 'success'); } catch (e) { cloudLog('保存失败: ' + e.message, 'error'); }
  });
}; /* ═══════════ 文本版: 从本地 cccf 读取 ═══════════ */

/* 下拉包名 → 本地 cccf 文件名 (读本地cccf/删除cccf配置/保存到cccf 共用) */
function dbPkgToFile() {
  const sel = document.getElementById('cf-db-pkg'); let pkg = ((sel && sel.value) || '').trim().replace(/\.json$/, '').replace(/\.enc$/, ''); if (!pkg) {
    try { const o = JSON.parse(document.getElementById('cloud-editor').value); pkg = String(o.package_name || ''); } catch (_) {}
  }
  return pkg ? pkg + '.json' : '';
}

window.readCloudFromFile = async function() {
  const ed = document.getElementById('cloud-editor'); const name = dbPkgToFile(); if (!name) { cloudLog('请先选择游戏 (下拉或包名)', 'warning'); return; }
  if (!safeName(name)) { cloudLog('文件名异常: ' + name, 'error'); return; }
  try {
    const content = await execStdout(`cat '${CCCF}/${name}' 2>/dev/null`); if (!content.trim()) throw new Error('cccf 中没有该文件: ' + name); ed.value = content; cloudLog('已从 cccf 加载: ' + name, 'success'); } catch (e) { cloudLog('读取失败: ' + e.message, 'error'); }
}; /* ═══════════ 文本版: 数据库读写 (cosa) ═══════════ */

/* 从 COSA DB 读取 (cosa read; 嵌套 JSON 自动解包为对象) */
window.readCloudFromDB = async function() {
  const sel = document.getElementById('cf-db-pkg'); const ed = document.getElementById('cloud-editor'); const pkg = (sel.value || '').trim(); if (!pkg) { cloudLog('请先在"数据库已建档游戏"下拉中选择游戏', 'warning'); return; }
  if (!safeName(pkg)) { cloudLog('包名异常: ' + pkg, 'error'); return; }
  await withBusy(document.getElementById('cf-pro-read-db'), async () => {
    const r = await cosa('read', pkg); if (r.timeout) { cloudLog('DB 读取超时', 'error'); return; }
    if (!r.ok) { cloudLog('DB 读取失败: ' + (r.out || r.err || ('退出码 ' + r.ec)), 'error'); return; }
    let row; try { row = JSON.parse(r.out); } catch (e) { cloudLog('DB 返回不是合法 JSON: ' + e.message, 'error'); return; }
    if (Array.isArray(row)) row = row[0]; if (!row) { cloudLog('数据库中没有该游戏的行: ' + pkg, 'warning'); return; }
    ed.value = JSON.stringify(unfoldRow(row), null, 2); const fsVal = String(row.from_server); cloudLog('已从数据库读取: ' + pkg + (fsVal === '0' ? ' (本地注入值)' : fsVal === 'null' ? '' : ' (云端下发值)'), 'success'); });
}; /* 注入 = 写入 COSA DB (cosa write: 自动建档 + from_server=0 + 三联保护 + WAL 收尾) */
window.saveCloudToDB = async function() {
  const sel = document.getElementById('cf-db-pkg'); const ed = document.getElementById('cloud-editor'); let obj; try { obj = JSON.parse(ed.value); } catch (e) { cloudLog('JSON 格式错误: ' + e.message, 'error'); return; }
  let pkg = (sel.value || '').trim(); pkg = pkg || String(obj.package_name || ''); if (!pkg) { cloudLog('缺少 package_name', 'error'); return; }
  if (!safeName(pkg)) { cloudLog('包名含非法字符, 已拒绝注入: ' + pkg, 'error'); return; }
  await withBusy(document.getElementById('cloud-save-btn'), async () => {
    const tmp = `/data/local/tmp/turbo_w_${Date.now()}.json`; try {
      /* 写临时 JSON (b64 分块, 免疫转义) → cosa write → 删临时 */
      await writeFileChecked(tmp, JSON.stringify(obj, null, 2)); const r = await cosa('write', pkg, tmp); await execStdout(`rm -f '${tmp}' 2>/dev/null`); if (r.timeout) { cloudLog('注入超时 (可能仍在后台执行, 稍后用"📖 读数据库"确认)', 'error'); return; }
      if (!r.ok) { cloudLog('注入失败: ' + (r.out || r.err || ('退出码 ' + r.ec)), 'error'); return; }
      /* cosa 输出逐行进日志 (含"已忽略未知字段"提示) */
      for (const line of r.out.split('\n').map(s => s.trim()).filter(Boolean)) {
        cloudLog(line, line.includes('忽略') ? 'warning' : 'success'); }
      cloudLog('提示: 重启 COSA 后生效', 'info'); loadDbPackages(); } catch (e) {
      await execStdout(`rm -f '${tmp}' 2>/dev/null`); cloudLog('注入失败: ' + e.message, 'error'); }
  });
}; /* 保存 = 写入本地 cccf */
window.saveCloudToFile = async function() {
  await withBusy(document.getElementById('cloud-save-file-btn'), async () => {
    const ed = document.getElementById('cloud-editor'); const name = dbPkgToFile(); let obj; try { obj = JSON.parse(ed.value); } catch (e) { cloudLog('JSON 格式错误: ' + e.message, 'error'); return; }
    if (!obj.package_name) { cloudLog('缺少 package_name 字段', 'error'); return; }
    const target = name || (String(obj.package_name) + '.json'); if (!safeName(target)) { cloudLog('包名含非法字符, 已拒绝保存: ' + target, 'error'); return; }
    try {
      const j = JSON.stringify(obj, null, 2); await writeFileChecked(`${CCCF}/${target}`, j); cloudLog('已保存到 cccf: ' + target, 'success'); loadCloudFiles(); } catch (e) { cloudLog('保存失败: ' + e.message, 'error'); }
  });
}; /* 导出当前编辑器内容为 cccf 文件 (从 DB 读取后固化) */
window.dbExportToCccf = async function() {
  const sel = document.getElementById('cf-db-pkg'); const ed = document.getElementById('cloud-editor'); let pkg = (sel.value || '').trim(); if (!pkg) { try { pkg = String(JSON.parse(ed.value).package_name || ''); } catch (_) {} }
  if (!pkg) { cloudLog('请先在"数据库已建档游戏"下拉中选择游戏', 'warning'); return; }
  if (!safeName(pkg)) { cloudLog('包名异常: ' + pkg, 'error'); return; }
  await withBusy(document.getElementById('cf-db-export-btn'), async () => {
    try {
      /* 优先用编辑器当前内容 (用户可能刚改过), 否则从 DB 读 */
      let text = (ed.value || '').trim(); if (!text) {
        const r = await cosa('read', pkg); if (!r.ok) { cloudLog('读取失败: ' + (r.out || r.err), 'error'); return; }
        text = r.out; }
      const name = pkg + '.json'; await writeFileChecked(`${CCCF}/${name}`, text); cloudLog('已导出到 cccf: ' + name + ' (UI 版可继续编辑)', 'success'); loadCloudFiles(); } catch (e) { cloudLog('导出失败: ' + e.message, 'error'); }
  });
}; /* 删除 cccf 文件 (二次确认) */
let _delArmed = '';
window.deleteCloudFile = async function() {
  const btn = document.getElementById('cloud-del-btn'); const name = dbPkgToFile(); if (!name) { cloudLog('请先选择文件', 'warning'); return; }
  if (!safeName(name)) { cloudLog('文件名异常, 已拒绝删除: ' + name, 'error'); return; }
  if (_delArmed !== name) {
    _delArmed = name; if (btn) btn.textContent = '确认删除?'; cloudLog('再点一次确认删除 cccf: ' + name, 'warning'); setTimeout(() => { if (btn && _delArmed === name) { _delArmed = ''; btn.textContent = '🗑 删除cccf配置'; } }, 3500); return; }
  _delArmed = ''; if (btn) btn.textContent = '🗑 删除cccf配置'; try {
    await execStdout(`rm -f '${CCCF}/${name}'`); cloudLog('已删除 cccf: ' + name, 'success'); loadCloudFiles(); } catch (e) { cloudLog('删除失败: ' + e.message, 'error'); }
}; /* ═══════════ 云控注入 (cccf → 数据库) ═══════════ */
/* 后台注入: 设备端把匹配+注入放进子 shell 落盘到 log/inject_web.log 并立即返回,
   页面轮询日志追加到操作日志, 期间界面不阻塞 (旧实现 await 最长 150s, 整个页面卡死等它跑完)。
   注意: 尾部 & 只后台化紧邻的命令 —— 必须把整串放进 ( ... ) 子 shell 再 &, 否则 execFull 会等满全程 */
let _injectRunning = false;
window.runCloudInject = async function() {
  const btn = document.getElementById('cloud-inject-btn');
  if (_injectRunning) { cloudLog('注入正在后台执行, 进度见下方日志', 'warning'); return; }
  if (!(await execAlive())) { cloudLog('无法执行 root 命令 (ksu.exec 不可用或超时), 请确认已授权', 'error'); return; }
  _injectRunning = true;
  if (btn) { btn.disabled = true; btn.textContent = '后台注入中...'; }
  cloudLog('匹配已安装游戏 + 后台注入中 (实时进度见下方)...', 'info');
  const LF = `${MODDIR}/log/inject_web.log`;
  const r0 = await execFull(`rm -f ${LF}; mkdir -p ${MODDIR}/log; ( sh ${MODDIR}/scripts/pkg_matcher.sh >> ${LF} 2>&1; sh ${MODDIR}/scripts/cloud_ctrl.sh inject >> ${LF} 2>&1; echo "=== 注入结束 ===" >> ${LF} ) &`, 5000);
  if (r0.timeout) { cloudLog('后台启动异常 (命令未立即返回), 轮询已取消, 请稍后用"📖 读数据库"确认', 'error'); _injectRunning = false; if (btn) { btn.disabled = false; btn.textContent = '⚡ 注入云控配置'; } return; }
  let seen = 0, tries = 0;
  const poll = setInterval(async () => {
    tries++;
    const raw = await execStdout(`cat ${LF} 2>/dev/null`, 8000);
    const lines = (raw || '').split('\n');
    for (; seen < lines.length; seen++) {
      const t = lines[seen].trim(); if (!t) continue;
      let type = 'info';
      if (t.includes('OK:') || t.startsWith('+') || t.includes('成功') || t.includes('注入完成')) type = 'success';
      else if (t.includes('FAIL') || t.includes('错误') || t.startsWith('!')) type = 'error';
      cloudLog(t, type);
    }
    const done = lines.some(l => l.includes('=== 注入结束 ==='));
    if (done || tries > 150) {
      clearInterval(poll);
      if (!done) cloudLog('后台执行超过约 4 分钟未见结束标记, 轮询停止 (可稍后用"📖 读数据库"确认)', 'warning');
      else cloudLog('云控注入流程结束', 'success');
      _injectRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = '⚡ 注入云控配置'; }
      loadCloudFiles(); loadDbPackages();
    }
  }, 1500);
}; /* ═══════════ 应用增强服务 (COSA) 维护 ═══════════ */

/* 清除应用增强服务数据 (为拉取云端做准备): pm clear + 撤保护 (否则云端下发被触发器拦截) */
let _cosaClrArmed = false;
window.clearCosaData = async function() {
  const btn = document.getElementById('cosa-clear-btn'); if (!_cosaClrArmed) {
    _cosaClrArmed = true; if (btn) btn.textContent = '确认清除?'; cloudLog('再点一次确认清除 (将重置数据库并撤掉注入保护)', 'warning'); setTimeout(() => { _cosaClrArmed = false; if (btn) btn.textContent = '🧹 清除服务数据'; }, 3500); return; }
  _cosaClrArmed = false; if (btn) btn.textContent = '🧹 清除服务数据'; await withBusy(btn, async () => {
    const r = await execFull(`pm clear com.oplus.cosa`, 25000); if (r.timeout) { cloudLog('清除超时', 'error'); return; }
    if (!/Success/.test(r.out)) { cloudLog('清除失败: ' + (r.out || r.err || '无输出'), 'error'); return; }
    cloudLog('应用增强服务数据已清除', 'success'); const up = await cosa('unprotect'); if (up.ok) cloudLog('保护触发器已撤掉 — 云端下发不再被拦截', 'success'); else cloudLog('提示: 库已重置, 保护随旧库一并消失', 'info'); loadDbPackages(); cloudLog('接下来: 重新进游戏等云端下发 (可能几分钟) → 选游戏点"☁ 获取云端配置"', 'info'); });
}; /* 重启应用增强服务: 杀进程 + 拉起四件套 */
window.restartCosa = async function() {
  await withBusy(document.getElementById('cosa-restart-btn'), async () => {
    cloudLog('重启应用增强服务...', 'info'); await execFull(
      `setprop persist.sys.oplus.gameswitch.enable 0; sleep 1; ` +
      `killall com.oplus.cosa 2>/dev/null; sleep 2; ` +
      `setprop persist.sys.oplus.gameswitch.enable 1; ` +
      `start gameopt_hal_service-1-0 2>/dev/null; start vendor.urcc-hal-aidl 2>/dev/null; ` +
      `start oiface 2>/dev/null`, 20000); cloudLog('应用增强服务已重启', 'success'); cloudLog('提示: 稍等数秒待服务完全拉起', 'info'); });
}; /* 刷新数据库配置: 把 cccf 当前配置重新注入数据库 (cosa sync) */
window.refreshDbConfig = async function() {
  await withBusy(document.getElementById('cosa-refresh-btn'), async () => {
    cloudLog('刷新数据库配置 (cccf → 数据库)...', 'info'); const r = await cosa('sync'); if (r.timeout) { cloudLog('刷新超时 (可能仍在后台执行)', 'warning'); return; }
    for (const line of r.out.split('\n').map(s => s.trim()).filter(Boolean)) {
      let type = 'info'; if (line.startsWith('OK:')) type = 'success'; else if (line.includes('FAIL') || line.includes('失败')) type = 'error'; cloudLog(line, type); }
    if (!r.ok && !r.out) cloudLog('刷新失败: ' + (r.err || ('退出码 ' + r.ec)), 'error'); loadDbPackages(); });
}; /* ☁ 获取官方下发的云控配置: 只读 from_server != 0 的那一行 → 编辑器; 库里没有才需要"①清除数据"再等下发 */
window.fetchCloudConfig = async function() {
  const sel = document.getElementById('cf-db-pkg'); const ed = document.getElementById('cloud-editor'); let pkg = ((sel && sel.value) || '').trim();
  await withBusy(document.getElementById('cf-cloud-fetch-btn'), async () => {
    try {
      /* 没选游戏: 先刷新一次列表再提示 —— ①清除数据 后下拉是空的, 用户进游戏等下发回来必须能重新选到 */
      if (!pkg) {
        cloudLog('未选择游戏, 先刷新数据库列表...', 'info'); await loadDbPackages(); pkg = ((sel && sel.value) || '').trim();
        if (!pkg) { cloudLog('数据库里还没有任何游戏行: 请先「🧹 清除服务数据」→ 进一次游戏等云端下发 (可能几分钟) → 再点本按钮', 'warning'); return; }
      }
      if (!safeName(pkg)) { cloudLog('包名异常: ' + pkg, 'error'); return; }
      /* 只认官方下发那行: 库里同时有我们注入的本地行时也不会读错 */
      const r = await cosa('read-cloud', pkg); if (r.timeout) { cloudLog('读取超时', 'error'); return; }
      if (!r.ok) {
        cloudLog('该游戏还没有官方下发的配置行: ' + (r.out || r.err || ''), 'warning');
        cloudLog('做法: 点「🧹 清除服务数据」→ 进一次游戏等云端下发 (可能几分钟) → 回来选该游戏再点本按钮', 'info');
        await loadDbPackages(); return; }
      let row; try { row = JSON.parse(r.out); } catch (e) { cloudLog('返回不是合法 JSON: ' + e.message, 'error'); return; }
      if (Array.isArray(row)) row = row[0]; if (!row) { cloudLog('数据库中还没有该游戏的行: ' + pkg, 'warning'); return; }
      ed.value = JSON.stringify(unfoldRow(row), null, 2);
      cloudLog('已读取官方下发配置: ' + pkg + ' (from_server=' + String(row.from_server) + ')', 'success');
      cloudLog('已填入编辑器 —— 要留用就编辑后点「⚡ 注入数据库」(会标成本地配置 from_server=0)', 'info');
      const p = await cosa('protect'); if (p.ok) cloudLog('本地配置保护已确认', 'success'); else cloudLog('警告: 保护重建失败 — ' + (p.out || p.err), 'error'); } catch (e) { cloudLog('拉取失败: ' + e.message, 'error'); }
  });
};
