/* ── 云控页 · 页面骨架层: 日志 / 模式切换 / 事件绑定与初始化 ──
   数据 IO 在 cloud-io.js, 表单渲染收集在 cloud-form.js (经典 script 共享全局作用域, 加载顺序: core → cloud-io → cloud-form → cloud-page; 本文件依赖二者均已加载) */

let _cloudMode = 'basic'; function cloudLog(msg, type) {
  const lc = document.getElementById('cloud-log'); if (!lc) return; const t = new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}); const el = document.createElement('div'); el.className = 'log-item log-' + (type || 'normal'); el.innerHTML = '<span class="log-time">[' + t + ']</span> ' + escapeHTML(msg); lc.prepend(el); while (lc.children.length > 200) lc.removeChild(lc.lastChild);
}

/* ── 模式切换 ── */
window.setCloudMode = function(mode) {
  if (mode !== 'basic' && mode !== 'pro') mode = 'basic'; _cloudMode = mode; try { localStorage.setItem('turbo-cloud-mode', mode); } catch (_) {}
  const basic = document.getElementById('cloud-basic'); const pro = document.getElementById('cloud-pro'); const bBtn = document.getElementById('mode-basic-btn'); const pBtn = document.getElementById('mode-pro-btn'); if (basic) basic.style.display = mode === 'basic' ? '' : 'none'; if (pro) pro.style.display = mode === 'pro' ? '' : 'none'; if (bBtn) bBtn.className = 'cseg-btn' + (mode === 'basic' ? ' active' : ''); if (pBtn) pBtn.className = 'cseg-btn' + (mode === 'pro' ? ' active' : '');
}; /* ── 初始化 ── */
document.addEventListener('DOMContentLoaded', async () => {
  /* 判空绑定: 任一 id 缺失只跳过该绑定, 不中断后续初始化 */
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }; const bSel = document.getElementById('cf-base-file'); if (bSel) {
    bSel.addEventListener('change', onBaseFile); on('cf-base-save', 'click', saveBaseConfig); on('cf-base-paste', 'click', pasteBaseConfig); on('cf-base-paste-load', 'click', loadBaseConfigFromPaste); on('cf-base-paste-cancel', 'click', () => {
    const box = document.getElementById('cf-base-paste-box'); if (box) box.style.display = 'none'; }); }
  /* 参数注释: 点参数名展开/收起说明行 */
  const formEl = document.getElementById('cf-base-form'); if (formEl) {
    formEl.addEventListener('click', e => {
      const fl = e.target.closest('.cf-fl'); if (!fl) return; const row = fl.closest('.cf-field'); if (!row) return; const tip = row.nextElementSibling; if (tip && tip.classList.contains('cf-tiprow')) tip.classList.toggle('open'); }); }
  /* 备份管理: 列表按钮委托 */
  const bkList = document.getElementById('cf-bk-list'); if (bkList) {
    bkList.addEventListener('click', e => {
      const rb = e.target.closest('[data-bkrestore]'); const db = e.target.closest('[data-bkdel]'); if (rb) restoreBackup(rb.getAttribute('data-bkrestore')); else if (db) deleteBackup(db.getAttribute('data-bkdel')); }); }
  const bkRefresh = document.getElementById('cf-bk-refresh'); if (bkRefresh) bkRefresh.addEventListener('click', loadBackupList); /* 文本版按钮绑定 (旧 cloud-file 下拉已删, 这些按钮不再依赖它存在) */
  on('cf-pro-read-file', 'click', readCloudFromFile); on('cf-pro-read-db', 'click', readCloudFromDB); on('cloud-save-btn', 'click', saveCloudToDB); on('cloud-save-file-btn', 'click', saveCloudToFile); on('cloud-del-btn', 'click', deleteCloudFile); const dbSel = document.getElementById('cf-db-pkg'); if (dbSel) {
    dbSel.addEventListener('change', () => { if (dbSel.value) cloudLog('已选择数据库游戏: ' + dbSel.value, 'info'); }); on('cf-db-export-btn', 'click', dbExportToCccf); on('cf-cloud-fetch-btn', 'click', fetchCloudConfig); }
  on('cosa-clear-btn', 'click', clearCosaData); on('cosa-restart-btn', 'click', restartCosa); on('cosa-refresh-btn', 'click', refreshDbConfig); const injBtn = document.getElementById('cloud-inject-btn'); if (injBtn) injBtn.addEventListener('click', runCloudInject); on('clear-cloud-log', 'click', () => { const lc = document.getElementById('cloud-log'); if (lc) lc.innerHTML = ''; });
  /* 切回页面时刷新数据库列表: 「① 清除数据」→ 进游戏等云端下发 → 切回来, 下拉里才有新行可选 */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadDbPackages(); }); /* ── cf-base-form 统一事件委托: thermal_frame 重置 / 添加场景 (展开输入行 + 确认) ──
     重置/添加前先 collectBaseForm 收回未保存编辑, 否则 renderBaseForm 整表重建会静默清空 */
  if (formEl) {
    formEl.addEventListener('click', (ev) => {
      const t = ev.target; if (!t || !t.hasAttribute) return; /* thermal_frame 重置: 全部档位恢复标准格式 (官方默认值), 需再点保存落盘 */
      if (t.hasAttribute('data-tf-reset')) {
        const std = window._tfStd || {}; if (!_baseObj) return; try { collectBaseForm(); }
        catch (e) { cloudLog('存在未保存的非法JSON, 修正后再重置: ' + e.message, 'error'); return; }
        /* 收集表单上当前出现的所有帧率档 (含用户自定义档) */
        const fpsSet = new Set(); document.querySelectorAll('#cf-base-form input[id^="tf."]').forEach(el => {
          const m = el.id.match(/^tf\.([^.]+)\./); if (m) fpsSet.add(m[1]); }); Object.keys(std).forEach(f => fpsSet.add(f)); if (!fpsSet.size) { cloudLog('没有可重置的温控档位', 'warning'); return; }
        /* 重置 = 恢复官方标准档位集: 60/90/120/144 (标准格式, ternary 固定 false) */
        _baseObj.thermal_frame = {}; Object.keys(std).forEach(fps => {
          const d = std[fps]; _baseObj.thermal_frame[fps] = { balance_nl: d.balance_nl, highperf_nl: d.highperf_nl, ternary: false }; }); renderBaseForm(); cloudLog('thermal_frame 已重置为标准格式 (点"保存"写入 cccf)', 'success'); return; }

      /* 添加场景: 展开/收起内联输入行 */
      if (t.hasAttribute('data-cpu-add')) {
        const row = document.getElementById('cpu-add-row'); if (row) {
          const show = row.style.display === 'none'; row.style.display = show ? 'flex' : 'none'; const inp = document.getElementById('cpu-add-name'); if (show && inp) inp.focus(); }
        return; }

      /* 添加场景: 确认 */
      if (t.hasAttribute('data-cpu-add-ok')) {
        if (!_baseObj) return; const inp = document.getElementById('cpu-add-name'); const s = (inp ? inp.value : '').trim(); if (!s) { cloudLog('场景名不能为空', 'warning'); return; }
        if (!/^[A-Za-z0-9_-]+$/.test(s)) { cloudLog('场景名仅允许字母/数字/下划线/连字符', 'warning'); return; }
        try { collectBaseForm(); }
        catch (e) { cloudLog('存在未保存的非法JSON, 修正后再添加: ' + e.message, 'error'); return; }
        if (!_baseObj.cpu_config) _baseObj.cpu_config = {}; if (_baseObj.cpu_config[s]) { cloudLog('场景 ' + s + ' 已存在', 'warning'); return; }
        _baseObj.cpu_config[s] = { time: 0 }; renderBaseForm(); cloudLog('已添加场景 ' + s + ' (填好 boost/time 后点"保存"写入 cccf)', 'success'); return; }

      /* 添加 game_config: 建官方格式骨架 (只可编辑 cht_boost_max/cht_boost_min/ctn) */
      if (t.hasAttribute('data-gc-add')) {
        if (!_baseObj) return; try { collectBaseForm(); }
        catch (e) { cloudLog('存在未保存的非法JSON, 修正后再添加: ' + e.message, 'error'); return; }
        if (_baseObj.game_config && typeof _baseObj.game_config === 'object' && Object.keys(_baseObj.game_config).length) {
          cloudLog('game_config 已存在', 'warning'); return; }
        /* 骨架 (user 指定): 空键也保留 (即使是空的也不删) */
        _baseObj.game_config = {
          ctb: 1, htb: 1, ctep: 80, ctn: '', cht_boost_max: '', cht_boost_min: '', rgr: 1, perfd: { status: true, sde: 0 }, }; renderBaseForm(); cloudLog('已添加 game_config (只可编辑 cht_boost_max/cht_boost_min/ctn/ctep, 点"保存"写入 cccf)', 'success'); return; }

      /* gpa_config 子块添加: 支持没有 es4g/mema 的官方配置 */
      if (t.hasAttribute('data-gpa-add')) {
        if (!_baseObj) return; const kind = t.getAttribute('data-gpa-add'); const fps = t.getAttribute('data-gpa-fps') || '__global__'; if (!_baseObj.gpa_config || typeof _baseObj.gpa_config !== 'object') _baseObj.gpa_config = {}; const g = fps === '__global__' ? _baseObj.gpa_config : (_baseObj.gpa_config[fps] || (_baseObj.gpa_config[fps] = {})); /* 骨架 (user 指定): 空键也保留; mema 带 custom 按簇覆盖默认值 */
        if (kind === 'es4g' && !g.es4g) g.es4g = { isolate: '144,0', state: true, fps: 60, partial: true }; if (kind === 'mema' && !g.mema) g.mema = {
          beta: '45', mode: '0', tl: '0,80,100,85,200,90', custom: { '7': '60,0', '0-1': '60,0', '2-4': '60,0', '5-6': '60,0' }, }; renderBaseForm(); cloudLog('已添加 ' + kind + ' (' + (fps === '__global__' ? '全局' : fps + 'Hz') + ', 点"保存到cccf"写入)', 'success'); return; }

      /* mema.custom 手动添加: custom 需手写内容, 不自动预置 */
      if (t.hasAttribute('data-mema-custom-add')) {
        if (!_baseObj || !_baseObj.gpa_config) return; const fps = t.getAttribute('data-gpa-fps') || '__global__'; const g = fps === '__global__' ? _baseObj.gpa_config : (_baseObj.gpa_config[fps] || null); if (!g || !g.mema) { cloudLog('请先添加 mema', 'warning'); return; }
        try { collectBaseForm(); }
        catch (e) { cloudLog('存在未保存的非法JSON, 修正后再添加: ' + e.message, 'error'); return; }
        if (g.mema.custom === undefined) g.mema.custom = {}; renderBaseForm(); cloudLog('已添加 mema.custom, 请手写 JSON 内容后保存', 'success'); return; }
    }); }

  let saved = 'basic'; try { saved = localStorage.getItem('turbo-cloud-mode') || 'basic'; } catch (_) {}
  setCloudMode(saved); loadCloudFiles(); loadBackupList(); loadDbPackages(); /* 数据库已建档游戏下拉 (独立于本地 cccf) */
});
