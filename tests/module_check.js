/* 模块整体一致性自检 (无需真机): node tests/module_check.js
   覆盖: cosa 子命令调用 / WebUI 事件绑定 id / 内联 onclick 函数 / shell 引用的脚本 /
        module.prop 与 update.json 及 zip 的一致性 / 文本文件换行符 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* 模块目录 = 版本号最大的那个 模块/Turbo调度* */
const MODNAME = fs.readdirSync(path.join(ROOT, '模块'))
  .filter(d => /^Turbo调度\d+/.test(d))
  .sort((a, b) => parseInt(b.replace(/\D/g, ''), 10) - parseInt(a.replace(/\D/g, ''), 10))[0];
const MOD = '模块/' + MODNAME;
const mp = p => path.join(ROOT, MOD, p);
const rel = p => MOD + '/' + p;
console.log('模块目录: ' + MOD);

const jsFiles = fs.readdirSync(mp('webroot')).filter(f => f.endsWith('.js')).map(f => rel('webroot/' + f));
const shFiles = ['service.sh', 'post-fs-data.sh', 'action.sh', 'customize.sh', 'uninstall.sh',
  'scripts/common.sh', 'scripts/pkg_matcher.sh', 'scripts/cloud_ctrl.sh', 'scripts/scene_config.sh'].map(rel);
const html = read(rel('webroot/index.html'));
const allJs = jsFiles.map(f => ({ f, s: read(f) }));
const allSh = shFiles.map(f => ({ f, s: read(f) }));

let bugs = 0;
const bug = m => { console.log('  BUG  ' + m); bugs++; };
const ok = m => console.log('  OK   ' + m);

/* 1) cosa 子命令: 以 main.rs 的 usage 行为准 */
const usage = (read('cosa-rs/src/main.rs').match(/用法: cosa ([^"]+)/) || [])[1] || '';
const supported = new Set(usage.split('|').map(s => s.trim().split(/\s+/)[0]).filter(Boolean));
console.log('支持子命令: ' + [...supported].join(' '));
let n = 0;
for (const { f, s } of [...allJs, ...allSh]) {
  for (const m of s.matchAll(/cosa\(?\s*['"]([a-z][a-z-]+)['"]|bin\/cosa["']?\s+([a-z][a-z-]+)/g)) {
    const sub = m[1] || m[2];
    if (sub && !supported.has(sub)) { bug(`${f} 调用了不存在的子命令: cosa ${sub}`); n++; }
  }
}
if (!n) ok('cosa 子命令调用全部存在');

/* 2) 事件绑定里的 id 是否都在 index.html */
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
n = 0;
for (const { f, s } of allJs) {
  for (const m of s.matchAll(/on\(\s*'([^']+)'\s*,\s*'[a-z]+'/g)) {
    if (!ids.has(m[1])) { bug(`${f} 绑定了 HTML 里不存在的 id: ${m[1]}`); n++; }
  }
}
if (!n) ok('事件绑定 id 都存在');

/* 3) 内联 onclick 引用的函数是否定义为全局 */
const defined = new Set();
for (const { s } of allJs) {
  for (const m of s.matchAll(/window\.([A-Za-z0-9_]+)\s*=/g)) defined.add(m[1]);
  for (const m of s.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)) defined.add(m[1]);
}
n = 0;
for (const m of html.matchAll(/onclick="([A-Za-z0-9_]+)\(/g)) {
  if (!defined.has(m[1])) { bug(`index.html 内联 onclick 的函数未定义: ${m[1]}`); n++; }
}
if (!n) ok('内联 onclick 函数都有定义');

/* 4) shell 引用的同模块脚本是否存在 (跳过 rm -f/-rf 这类"清理可能不存在的东西") */
n = 0;
for (const { f, s } of allSh) {
  for (const line of s.split('\n')) {
    if (/^\s*rm\s+-[rf]/.test(line)) continue;
    for (const m of line.matchAll(/\$\{?SCRIPTS_DIR\}?\/([A-Za-z0-9_.-]+\.sh)|(?:MODPATH|MODDIR)\/(scripts\/[A-Za-z0-9_.-]+\.sh)/g)) {
      const p = m[1] ? 'scripts/' + m[1] : m[2];
      if (!fs.existsSync(mp(p))) { bug(`${f} 引用了不存在的脚本: ${p}`); n++; }
    }
  }
}
if (!n) ok('shell 引用的脚本都存在');

/* 5) module.prop / update.json / zip 三者一致 */
const prop = read(rel('module.prop'));
const ver = (prop.match(/^version=(.*)$/m) || [])[1];
const vcode = (prop.match(/^versionCode=(.*)$/m) || [])[1];
const uj = (prop.match(/^updateJson=(.*)$/m) || [])[1];
const upd = JSON.parse(read('update.json'));
ver === upd.version ? ok(`版本一致 (${ver})`) : bug(`版本不一致: prop=${ver} update.json=${upd.version}`);
String(vcode) === String(upd.versionCode) ? ok(`versionCode 一致 (${vcode})`) : bug(`versionCode 不一致: ${vcode} vs ${upd.versionCode}`);
uj && uj.includes('gitee.com/turbowfz') ? ok('updateJson 已绑定真实仓库') : bug('updateJson 未绑定: ' + uj);
const zipName = decodeURIComponent((upd.zipUrl.split('/').pop() || ''));
fs.existsSync(path.join(ROOT, zipName)) ? ok(`update.json 指向的 zip 存在 (${zipName})`) : bug('zipUrl 指向的文件不存在: ' + zipName);

/* 6) 文本文件换行符 (CRLF 会让管理器/安装器显示异常; Scene 配置的 JSON 可忽略) */
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const crlf = [];
for (const p of walk(path.join(ROOT, MOD))) {
  if (/\.(png|jpe?g|apk|so|zip)$/i.test(p) || /[\\/]bin[\\/](cosa|inject)$/.test(p)) continue;
  const b = fs.readFileSync(p, 'latin1');
  const c = (b.match(/\r\n/g) || []).length;
  if (c > 0) crlf.push(path.relative(ROOT, p) + ' (' + c + ')');
}
crlf.length ? console.log('  注意 CRLF: ' + crlf.join(', ')) : ok('文本文件全部 LF');

/* 7) Android 正则坑: grep/sed 的模式里不要用 \| 交替 (GNU 扩展, toybox/bionic 不支持;
   本地 Git Bash 是 GNU grep 能过, 真机上匹配不上 —— 已在 cloud_ctrl.sh 踩过一次) */
n = 0;
for (const { f, s } of allSh) {
  for (const line of s.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (!/(^|\s|\|)(grep|sed)\s/.test(line)) continue;
    if (!/\\\|/.test(line)) continue;
    if (/grep\s+-[A-Za-z]*E/.test(line)) continue;   /* grep -E 里的 | 是 POSIX 扩展正则, 可以用 */
    bug(`${f} 用了 GNU 专有的 \\| 交替 (Android toybox 不支持): ${line.trim().slice(0, 60)}`);
    n++;
  }
}
if (!n) ok('没有使用 GNU 专有的 grep/sed \\| 交替');

console.log('\n发现问题: ' + bugs);
process.exit(bugs ? 1 : 0);
