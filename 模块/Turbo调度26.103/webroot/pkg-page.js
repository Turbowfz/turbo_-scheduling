/* ── 配置页 (短视频包名管理) ── */
let _packages = [];

function pkgLog(msg, type) {
  const lc = document.getElementById('log-content');
  if (!lc) return;
  const t = new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const el = document.createElement('div');
  el.className = 'log-item log-' + (type || 'normal');
  el.innerHTML = '<span class="log-time">[' + t + ']</span> ' + escapeHTML(msg);
  lc.prepend(el);
  while (lc.children.length > 100) lc.removeChild(lc.lastChild);
}

/* 读 json 文件: 空输出/解析失败返回 null (不再抛 Unexpected end of JSON input) */
async function readJsonFile(path) {
  const raw = await execStdout(`cat '${path}' 2>/dev/null`);
  if (!raw || !raw.trim()) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

/* 用户包名镜像: 存放在 /data/adb/turbo (root 专属目录, Scene 不可及)。
   Scene 侧 categories.json 被覆盖/内容漂移时, 开机部署以镜像为准恢复 —— 添加的包名不丢 */
const PKG_MIRROR = SCRC + '/categories_user.json';

/* 原子写入: 分块base64 → 解码到同目录临时文件 → 校验标记 → mv 原子替换 (中断不损坏原文件)
   withMirror=true (用户实际的增/删操作): 写入后锁 555 + 同步镜像 ——
     555 = Scene 以自身 uid 打开写入被拒 (不允许 Scene 改此文件); WebUI 走 root 不受限制;
     镜像 = Scene 走"临时文件+改名"绕过权限时的开机恢复依据
   withMirror=false (自动建档): 仅锁 555, 不生成镜像 (未用过该功能的用户不受开机恢复逻辑影响) */
async function saveJsonFile(path, obj, withMirror) {
  const j = JSON.stringify(obj, null, 4);
  await writeFileChecked(path, j + '\n');
  if (withMirror) {
    await execStdout(`chmod 555 '${path}' 2>/dev/null; mkdir -p '${SCRC}' && cp -f '${path}' '${PKG_MIRROR}' 2>/dev/null`);
  } else {
    await execStdout(`chmod 555 '${path}' 2>/dev/null`);
  }
}

window.renderPackageList = function(pkgs) {
  const lc = document.getElementById('package-list');
  const count = document.getElementById('package-count');
  if (!pkgs || !pkgs.length) {
    lc.innerHTML = '<div class="empty-tip">列表为空，请添加短视频包名</div>';
    if (count) count.textContent = '0个包名';
    return;
  }
  lc.innerHTML = pkgs.map(p =>
    `<div class="list-item"><div class="pkg-name">${escapeHTML(p)}</div><button class="delete-btn" data-pkg="${escapeHTML(p)}" title="删除"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button></div>`
  ).join('');
  if (count) count.textContent = pkgs.length + '个包名';
};

/* 从配置对象提取 ShortVideo 列表; 配置缺失时自动创建默认分类 */
async function loadOrCreateConfig() {
  let c = await readJsonFile(PKG_CFG);
  if (!Array.isArray(c)) {
    /* 活动文件缺失/为空/损坏 → 有用户镜像先恢复 (Scene 覆盖后打开 WebUI 即可找回), 否则备份后重建默认 */
    const mirror = await execStdout(`[ -f '${PKG_MIRROR}' ] && echo 1 || true`);
    if (mirror.includes('1')) {
      await execStdout(`cp -f '${PKG_MIRROR}' '${PKG_CFG}' && chmod 555 '${PKG_CFG}' 2>/dev/null`);
      c = await readJsonFile(PKG_CFG);
      if (Array.isArray(c)) pkgLog('活动配置异常, 已从用户镜像恢复包名列表', 'warning');
    }
  }
  if (!Array.isArray(c)) {
    /* 无镜像或镜像也损坏: 先备份原文件再重建默认结构 */
    await execStdout(`[ -f '${PKG_CFG}' ] && cp -f '${PKG_CFG}' '${PKG_CFG}.bak' 2>/dev/null`);
    c = [{ category: 'ShortVideo', packages: [] }];
    try {
      await saveJsonFile(PKG_CFG, c);
      pkgLog('配置文件为空, 已创建默认ShortVideo分类', 'warning');
    } catch (e) {
      pkgLog('配置文件不可写: ' + e.message, 'error');
    }
  }
  return c;
}

window.loadPackages = async function() {
  try {
    /* 未启用二改调度: categories.json 由 Scene 调度部署, 此时不读不写 (避免凭空创建文件), 仅提示 */
    const scOn = await execStdout(`[ -f '${SCRC}/sc_installed' ] && echo 1 || true`);
    if (!scOn.includes('1')) {
      document.getElementById('package-list').innerHTML = '<div class="empty-tip">未启用二改Scene调度, 本页不可用</div>';
      const cnt = document.getElementById('package-count');
      if (cnt) cnt.textContent = '—';
      return;
    }
    document.getElementById('package-list').innerHTML = '<div class="empty-tip"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>正在加载包名列表...</div>';
    const c = await loadOrCreateConfig();
    const t = c.find(x => x.category === 'ShortVideo');
    if (t && Array.isArray(t.packages)) {
      _packages = t.packages;
      renderPackageList(_packages);
      pkgLog('包名列表加载成功', 'success');
    } else {
      /* 分类缺失 → 补建 */
      c.push({ category: 'ShortVideo', packages: [] });
      try { await saveJsonFile(PKG_CFG, c); } catch (e) { pkgLog('补建ShortVideo分类写盘失败: ' + e.message, 'warning'); }
      _packages = [];
      renderPackageList(_packages);
      pkgLog('未找到ShortVideo分类, 已补建', 'warning');
    }
  } catch (e) {
    document.getElementById('package-list').innerHTML = '<div class="empty-tip">加载失败，请检查配置文件路径和权限</div>';
    pkgLog('加载配置文件失败: ' + e.message, 'error');
  }
};

let _adding = false;   /* 防重入: Enter+点击并发会让重复包名同时通过 includes 检查 */
window.addPackage = async function() {
  if (_adding) return;
  const inp = document.getElementById('pkg-input');
  const pkg = inp.value.trim();
  if (!pkg) { pkgLog('请输入有效的包名', 'error'); inp.focus(); return; }
  if (!/^([a-zA-Z][a-zA-Z0-9_]*\.)+[a-zA-Z][a-zA-Z0-9_]*$/.test(pkg)) { pkgLog('包名格式无效: ' + pkg, 'error'); return; }
  if (_packages.includes(pkg)) { pkgLog('包名已存在: ' + pkg, 'warning'); inp.value = ''; inp.focus(); return; }
  /* 未启用二改调度时不允许写 categories.json */
  const scOn = await execStdout(`[ -f '${SCRC}/sc_installed' ] && echo 1 || true`);
  if (!scOn.includes('1')) { pkgLog('未启用二改Scene调度, 无法编辑', 'error'); return; }
  _adding = true;
  try {
    const c = await loadOrCreateConfig();
    let t = c.find(x => x.category === 'ShortVideo');
    if (!t) { t = { category: 'ShortVideo', packages: [] }; c.push(t); }
    if (t.packages.includes(pkg)) { pkgLog('包名已存在: ' + pkg, 'warning'); inp.value = ''; inp.focus(); return; }
    /* 先写盘成功再同步内存: 写入失败时 UI 与文件保持一致, 不回滚内存 */
    t.packages.push(pkg);
    await saveJsonFile(PKG_CFG, c, true);   /* 用户实际增改: 锁555 + 同步镜像 */
    _packages = t.packages;
    renderPackageList(_packages);
    inp.value = ''; inp.focus();
    pkgLog('成功添加: ' + pkg, 'success');
  } catch (e) { pkgLog('添加失败: ' + e.message, 'error'); }
  finally { _adding = false; }
};

let _deleting = false;   /* 防重入: 与 addPackage 同款 */
window.deletePackage = async function(pkg) {
  if (_deleting) return;
  const scOn = await execStdout(`[ -f '${SCRC}/sc_installed' ] && echo 1 || true`);
  if (!scOn.includes('1')) { pkgLog('未启用二改Scene调度, 无法编辑', 'error'); return; }
  _deleting = true;
  try {
    const c = await loadOrCreateConfig();
    const t = c.find(x => x.category === 'ShortVideo');
    if (!t) { pkgLog('配置中无ShortVideo分类: ' + pkg, 'warning'); return; }
    const i = t.packages.indexOf(pkg);
    if (i === -1) { pkgLog('包名 ' + pkg + ' 不在列表中', 'warning'); return; }
    /* 先写盘成功再同步内存 (与 addPackage 一致): 写入失败时 UI 与文件保持一致 */
    t.packages.splice(i, 1);
    await saveJsonFile(PKG_CFG, c, true);   /* 用户实际删除: 锁555 + 同步镜像 */
    _packages = t.packages;
    renderPackageList(_packages);
    pkgLog('已删除包名: ' + pkg, 'success');
  } catch (e) { pkgLog('删除包名失败: ' + e.message, 'error'); }
  finally { _deleting = false; }
};
