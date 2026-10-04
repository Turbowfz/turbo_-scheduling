/* cloud-form.js 表单逻辑冒烟 (纯 node, 无需真机/浏览器):
   覆盖 26.113b 轮: gpa mtl/sync 可编辑渲染与收集 / core 撤编辑原样保留 /
   game_config ctb·htb 固定 1 (无开关) / fps_stabilizer.temp 载入即归一 500 且只读
   用法: node tests/cloud_form_smoke.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
/* 模块目录 = 版本号最大的那个 模块/Turbo调度* (与 module_check.js 同规则) */
const MODNAME = fs.readdirSync(path.join(ROOT, '模块'))
  .filter(d => /^Turbo调度\d+/.test(d))
  .sort((a, b) => parseInt(b.replace(/\D/g, ''), 10) - parseInt(a.replace(/\D/g, ''), 10))[0];
const src = fs.readFileSync(path.join(ROOT, '模块', MODNAME, 'webroot', 'cloud-form.js'), 'utf8');

let bugs = 0;
const ok = m => console.log('  OK   ' + m);
const bad = m => { console.log('  BUG  ' + m); bugs++; };
const assert = (c, m) => c ? ok(m) : bad(m);

/* 最小浏览器桩: 只够 renderBaseForm/collectBaseForm 跑通 (无 DOM 细节) */
let qsaResult = [];
const fakeForm = { innerHTML: '' };
global.window = global;
global.escapeHTML = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
global.document = {
  getElementById: id => (id === 'cf-base-form' ? fakeForm : null),
  querySelectorAll: sel => (sel.includes('textarea') ? [] : qsaResult),
};
/* eval 内 const 不外泄 → 末尾用表达式把需要的引用带出来 (函数声明会泄漏到本作用域,
   故接收对象须用别的名字, 避免与泄漏的 renderBaseForm 等撞名) */
const api = eval(src + ';({ FI, renderBaseForm, collectBaseForm })');

/* ── 1) 渲染: 分档形态 ── */
window._baseObj = {
  package_name: 'test.pkg',
  gpa_config: {
    60: { cl: 0, ch: 15, mtl: '80,80,80,80', sync: 1, core: '-1,-1,-1,-1,-1,-1,-1,-1', chtb: { enable: true } },
    90: { cl: 0 },
  },
  game_config: { ctb: 1, htb: 1, ctep: 90, ctn: 'GameThread', rgr: 1 },
  fps_stabilizer: { boostStep: '1.1,1.3,1.5', temp: 470 },
};
api.renderBaseForm();
const html = fakeForm.innerHTML;
assert(html.includes('id="gpa.60.mtl"'), '渲染出 mtl 输入行 (60 档)');
assert(html.includes('id="gpa.60.sync"'), '渲染出 sync 开关 (60 档)');
assert(!html.includes('id="gpa.60.core"'), '不再渲染 core 编辑行 (原值保留不展示)');
assert(html.includes('value="80,80,80,80"'), 'mtl 原值回显');
assert(!html.includes('id="game_config.ctb"') && !html.includes('id="game_config.htb"'), 'game_config 不再有 ctb/htb 开关');
assert(html.includes('<span class="cf-key">ctb</span>') && html.includes('<span class="cf-key">htb</span>'), 'ctb/htb 进只读列表 (能看到值)');
assert(html.includes('500 (固定)'), 'fps_stabilizer.temp 只读固定 500 展示');
assert(window._baseObj.fps_stabilizer.temp === 500, '载入即自动把 temp 归一为 500 (原 470)');

/* ── 2) 收集: sync 取消=删键 / mtl 字符串保型 / ctb·htb 强制 1 ── */
qsaResult = [
  { id: 'gpa.60.sync', type: 'checkbox', checked: false, tagName: 'INPUT' },  /* 原 sync:1 → 取消 → 删键 */
  { id: 'gpa.60.mtl', type: 'text', value: '75,75,75,75', tagName: 'INPUT' }, /* 改值 → 字符串保型 */
];
window._boxInit = { 'gpa.60.sync': true, 'gpa.60.mtl': false };
let out = api.collectBaseForm();
assert(!('sync' in out.gpa_config[60]), '取消勾选 sync → 删键 (解析默认无键=关)');
assert(out.gpa_config[60].mtl === '75,75,75,75', 'mtl 修改后按字符串落盘');
assert(out.game_config.ctb === 1 && out.game_config.htb === 1, 'game_config.ctb/htb 收集时固定写 1');
assert(out.fps_stabilizer.temp === 500, 'temp 保持 500 落盘');

/* 勾选原本无 sync 的 90 档 → 写数值 1 (不是布尔) */
qsaResult = [{ id: 'gpa.90.sync', type: 'checkbox', checked: true, tagName: 'INPUT' }];
window._boxInit = { 'gpa.90.sync': false };
out = api.collectBaseForm();
assert(out.gpa_config[90].sync === 1 && typeof out.gpa_config[90].sync === 'number', '勾选 sync → 写数值 1 (内核按 >0 判断)');

/* 没动过的开关不落盘: 60 档原值 sync:2 未动 → 保持 2 */
window._baseObj.gpa_config[60].sync = 2;
qsaResult = [{ id: 'gpa.60.sync', type: 'checkbox', checked: true, tagName: 'INPUT' }];
window._boxInit = { 'gpa.60.sync': true };
out = api.collectBaseForm();
assert(out.gpa_config[60].sync === 2, 'sync 未动 → 原值 2 保留');

/* ── 3) 全局平铺形态: gpa.sync → gpa_config.sync ── */
window._baseObj = { package_name: 'flat.pkg', gpa_config: { cl: 0, mtl: '80,80' } };
api.renderBaseForm();
qsaResult = [{ id: 'gpa.sync', type: 'checkbox', checked: true, tagName: 'INPUT' }];
window._boxInit = { 'gpa.sync': false };
out = api.collectBaseForm();
assert(out.gpa_config.sync === 1, '平铺形态 sync → gpa_config.sync = 1');

/* ── 4) game_config 缺 ctb/htb 时收集补 1; FI 引用清理到位 ── */
window._baseObj = { package_name: 'x.pkg', game_config: { ctep: 80 } };
qsaResult = [];
api.collectBaseForm();
assert(window._baseObj.game_config.ctb === 1 && window._baseObj.game_config.htb === 1, '已有 game_config 缺 ctb/htb → 补 1');
assert(api.FI.mtl && api.FI.gcSync && !api.FI.core && !api.FI.gcCtb && !api.FI.gcHtb, 'FI 表: mtl/gcSync 在, core/gcCtb/gcHtb 已删');

console.log('\n发现问题: ' + bugs);
process.exit(bugs ? 1 : 0);
