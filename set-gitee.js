#!/usr/bin/env node
/* ── Turbo调度 · 绑定 Gitee 仓库 ──
   把 Gitee 用户名/仓库名写进 module.prop 的 updateJson 与 update.json 的链接里。
   用法:
     node set-gitee.js <Gitee用户名> [仓库名]
     node set-gitee.js myname                 # 仓库名默认 Turbo_Scheduling
     node set-gitee.js myname TurboSched --branch main   # 指定分支 (默认 master)

   跑完再执行一次  node release.js  刷新 update.json。 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const owner = argv[0];
if (!owner) {
  console.error('用法: node set-gitee.js <Gitee用户名> [仓库名] [--branch <分支名>]');
  process.exit(1);
}
const bi = argv.indexOf('--branch');
const branch = bi >= 0 ? argv[bi + 1] : 'master';
const repo = (argv[1] && !argv[1].startsWith('--')) ? argv[1] : 'Turbo_Scheduling';

const ROOT = __dirname;
const MODULES_DIR = path.join(ROOT, '模块');
const modDir = fs.readdirSync(MODULES_DIR)
  .filter(d => /^Turbo调度/.test(d))
  .sort((a, b) => (parseInt(b.replace(/[^\d]/g, ''), 10) || 0) - (parseInt(a.replace(/[^\d]/g, ''), 10) || 0))[0];
const propFile = path.join(MODULES_DIR, modDir, 'module.prop');

const rawBase = `https://gitee.com/${owner}/${repo}/raw/${branch}`;
const updateJsonUrl = `${rawBase}/update.json`;

/* 1) module.prop 写入 updateJson */
let prop = fs.readFileSync(propFile, 'utf8');
if (/^updateJson=/m.test(prop)) prop = prop.replace(/^updateJson=.*$/m, 'updateJson=' + updateJsonUrl);
else prop = prop.replace(/\n*$/, '\n') + 'updateJson=' + updateJsonUrl + '\n';
fs.writeFileSync(propFile, prop, 'utf8');
console.log('module.prop  updateJson = ' + updateJsonUrl);

/* 2) update.json 刷新链接 (版本号字段保持原值, 之后用 release.js 更新) */
const ujPath = path.join(ROOT, 'update.json');
let uj = { version: 'v0.0', versionCode: 1, zipUrl: '', changelog: '' };
if (fs.existsSync(ujPath)) { try { uj = JSON.parse(fs.readFileSync(ujPath, 'utf8')); } catch (_) {} }
uj.changelog = `${rawBase}/changelog.md`;
if (!uj.zipUrl || /YOUR_GITEE_NAME|dist\//.test(uj.zipUrl)) {
  const ver = (prop.match(/^version=(.*)$/m) || [, 'v0.0'])[1].trim().replace(/^v/i, '');
  const name = (prop.match(/^name=(.*)$/m) || [, 'Turbo调度'])[1].trim();
  uj.zipUrl = `${rawBase}/${encodeURIComponent(name + ver + '.zip')}`;
}
fs.writeFileSync(ujPath, JSON.stringify(uj, null, 2) + '\n', 'utf8');
console.log('update.json  changelog = ' + uj.changelog);
console.log('             zipUrl    = ' + uj.zipUrl);
console.log('\n完成。接着跑  node release.js  重新打包并刷新版本号/更新清单。');
