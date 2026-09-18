const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/User/Desktop/Turbo调度项目';
const MOD = path.join(ROOT, '模块/Turbo调度26.104');

/* ── 0) 校验新目录完整性 ── */
let n = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else n++; } })(MOD);
console.log('模块目录文件数: ' + n + ' (改名前为 84)');
for (const f of ['module.prop', 'customize.sh', 'service.sh', 'action.sh', 'uninstall.sh', 'README.md', 'Update.md', 'bin/cosa', 'bin/inject', 'webroot/core.js', 'scripts/scene_config.sh', 'modules/AsoulOpt.zip']) {
  const ok = fs.existsSync(path.join(MOD, f));
  if (!ok) console.log('  ! 缺失: ' + f);
}
console.log('');

/* ── 1) module.prop: 版本 26.103 → 26.104 ── */
const prop = path.join(MOD, 'module.prop');
let t = fs.readFileSync(prop, 'utf8');
t = t.replace(/^version=v26\.103$/m, 'version=v26.104').replace(/^versionCode=26103$/m, 'versionCode=26104');
fs.writeFileSync(prop, t, 'utf8');
console.log('module.prop: ' + (t.match(/^version=.*$/m) || [])[0] + ', ' + (t.match(/^versionCode=.*$/m) || [])[0]);

/* ── 2) Update.md: 顶部版本块 #26.103 → #26.104 ── */
const upd = path.join(MOD, 'Update.md');
let u = fs.readFileSync(upd, 'utf8');
if (u.includes('#26.104')) console.log('Update.md: 已是 #26.104 (跳过)');
else { u = u.replace('#26.103', '#26.104'); fs.writeFileSync(upd, u, 'utf8'); console.log('Update.md: 顶部块改为 #26.104'); }

/* ── 3) README / GITEE 里的 26.103 引用 ── */
for (const f of ['README.md', 'GITEE.md']) {
  const p = path.join(ROOT, f);
  let s = fs.readFileSync(p, 'utf8');
  const before = (s.match(/26\.103/g) || []).length;
  if (before) { s = s.replace(/26\.103/g, '26.104'); fs.writeFileSync(p, s, 'utf8'); }
  console.log(f + ': 替换 ' + before + ' 处 26.103 → 26.104');
}

/* ── 4) 校验残留 ── */
console.log('\n=== 仓库内是否还有 26.103 引用 ===');
for (const f of ['README.md', 'GITEE.md', 'release.js', 'set-gitee.js', 'update.json', 'push-gitee.cmd', 'changelog.md']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');
  if (/26\.103/.test(s)) console.log('  ' + f + ' 仍有 26.103');
}
const propNow = fs.readFileSync(prop, 'utf8');
console.log('  module.prop 版本: ' + (propNow.match(/^version=.*$/m) || [])[0]);
