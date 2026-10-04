#!/usr/bin/env node
/* ── Turbo调度 · 发布助手 ──
   一条命令完成: 打包模块 zip(放仓库根目录) → 刷新 changelog.md → 刷新 update.json → 打印推送步骤

   用法:
     node release.js                     用 模块/Turbo调度<版本>/module.prop 里的当前版本发布
     node release.js --zip-url <url>     自定义 zip 直链 (默认用仓库内 zip 的 raw 直链)
     node release.js --no-build          跳过打包, 只刷新 changelog.md / update.json

   产物:
     Turbo调度<版本>.zip    仓库根目录 (随 git 一起提交, update.json 指向它的 raw 直链)
     changelog.md          更新日志 (管理器内展示)
     update.json           更新清单 (module.prop 的 updateJson 指向它)

   update.json 四个必需字段: version / versionCode / zipUrl / changelog
   (versionCode 由版本号数字拼成, v26.103 → 26103, 必须比旧版大管理器才提示更新) */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const MODULES_DIR = path.join(ROOT, '模块');

/* ── 参数 ── */
const argv = process.argv.slice(2);
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const zipUrlArg = argVal('--zip-url');
const noBuild = argv.includes('--no-build');

/* ── 找模块目录: 模块/ 下版本号最大的 Turbo调度* ── */
function findModuleDir() {
  const dirs = fs.readdirSync(MODULES_DIR)
    .filter(d => /^Turbo调度/.test(d) && fs.statSync(path.join(MODULES_DIR, d)).isDirectory());
  if (!dirs.length) throw new Error('模块/ 下没有 Turbo调度<版本> 目录');
  const num = s => parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
  return path.join(MODULES_DIR, dirs.sort((a, b) => num(b) - num(a))[0]);
}

function readProp(file, key) {
  const m = fs.readFileSync(file, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'));
  return m ? m[1].trim() : null;
}

/* 版本号 → versionCode (v26.103 → 26103) */
function toVersionCode(ver) {
  const n = parseInt(String(ver).replace(/^v/i, '').replace(/\./g, ''), 10);
  if (!Number.isFinite(n)) throw new Error('版本号无法转成 versionCode: ' + ver);
  return n;
}

/* 从 Update.md 取最新版本块作为 changelog */
function latestChangelog(mdPath) {
  /* 按 /\r?\n/ 切行: Update.md 若是 CRLF (Windows 编辑器写的), 按 \n 切会把 \r 留在每行末尾,
     生成的 changelog.md 就带 \r, 管理器渲染时整段粘成一坨 (更新日志看不到换行) */
  const lines = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const isBlock = l => /^#\d/.test(l.trim());
  const start = lines.findIndex(isBlock);
  if (start < 0) return '# 更新日志\n\n(无)\n';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (isBlock(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n').replace(/\s+$/, '') + '\n';
}

/* 从 module.prop 的 updateJson 解析 Gitee owner/repo (占位符视为未绑定) */
function repoFromUpdateJson(moduleProp) {
  const uj = readProp(moduleProp, 'updateJson') || '';
  const m = uj.match(/gitee\.com\/([^/]+)\/([^/]+)/);
  if (!m || /YOUR_GITEE_NAME/.test(m[1])) return null;
  return { owner: m[1], repo: m[2] };
}

/* ── 主流程 ── */
const modDir = findModuleDir();
const propFile = path.join(modDir, 'module.prop');
const id = readProp(propFile, 'id') || 'Turbo_Scheduling';
const name = readProp(propFile, 'name') || 'Turbo调度';
const version = readProp(propFile, 'version');
if (!version) throw new Error('module.prop 里没有 version');
const vcode = toVersionCode(version);

console.log('模块目录 : ' + path.relative(ROOT, modDir));
console.log('模块 ID  : ' + id + '  (' + name + ')');
console.log('版本     : ' + version + '  (versionCode ' + vcode + ')');
console.log('');

/* 1) 打包 → 仓库根目录, 与既有命名一致 (Turbo调度<版本>.zip) */
const zipName = name + version.replace(/^v/i, '') + '.zip';
const zipPath = path.join(ROOT, zipName);
if (!noBuild) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'make-zip.js'), modDir, zipPath], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('打包失败'); process.exit(r.status || 1); }
} else {
  console.log('(跳过打包, 沿用已存在的 ' + zipName + ')');
}

/* 1b) 桌面副本 (user 2026-10-05: "以后都要自动打包到桌面, 且只有 1 个文件"):
   打包后把 zip 复制一份到用户桌面, 并清掉桌面上旧的 Turbo调度*.zip —— 桌面永远只留
   最新这一个安装包; 其它项目的 zip (如 Xpan*) 不是本模块的, 一律不动 */
const DESKTOP = path.join(process.env.USERPROFILE || ROOT, 'Desktop');
try {
  if (!fs.existsSync(DESKTOP)) {
    console.log('! 未找到桌面目录, 跳过桌面副本: ' + DESKTOP);
  } else {
    for (const f of fs.readdirSync(DESKTOP)) {
      if (/^Turbo调度.+\.zip$/.test(f) && f !== zipName) {
        try { fs.unlinkSync(path.join(DESKTOP, f)); console.log('已清桌面旧包: ' + f); } catch (_) {}
      }
    }
    fs.copyFileSync(zipPath, path.join(DESKTOP, zipName));
    console.log('已放桌面: ' + path.join(DESKTOP, zipName) + '  (桌面只保留这 1 个)');
  }
} catch (e) {
  console.log('! 桌面副本失败 (不影响发布): ' + e.message);
}

/* 2) changelog.md */
const changelog = latestChangelog(path.join(modDir, 'Update.md'));
fs.writeFileSync(path.join(ROOT, 'changelog.md'), changelog, 'utf8');
console.log('已刷新 changelog.md (' + changelog.split('\n').length + ' 行)');

/* 3) update.json (沿用既有格式: 中文名 zip 的 raw 直链 + lastUpdated) */
const repo = repoFromUpdateJson(propFile);
const rawBase = repo ? `https://gitee.com/${repo.owner}/${repo.repo}/raw/master` : null;
const zipUrl = zipUrlArg
  || (rawBase ? `${rawBase}/${encodeURIComponent(zipName)}` : `https://gitee.com/YOUR_GITEE_NAME/${id}/raw/master/${encodeURIComponent(zipName)}`);
const changelogUrl = rawBase ? `${rawBase}/changelog.md` : `https://gitee.com/YOUR_GITEE_NAME/${id}/raw/master/changelog.md`;
/* 本地日期: toISOString() 取的是 UTC, 在 UTC+8 的晚上会差一天 (如本地 10-03 却写成 10-02) */
const _d = new Date();
const today = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
const updateJson = { version, versionCode: vcode, zipUrl, changelog: changelogUrl, lastUpdated: today };
fs.writeFileSync(path.join(ROOT, 'update.json'), JSON.stringify(updateJson, null, 2) + '\n', 'utf8');
console.log('已刷新 update.json');
console.log(JSON.stringify(updateJson, null, 2));

/* 4) 步骤 */
console.log('\n─── 接下来 ───');
if (!repo) {
  console.log('! 还没绑定 Gitee 仓库: 先跑  node set-gitee.js <你的Gitee用户名> [仓库名]');
  console.log('  绑定后再跑一次本命令, update.json 里的地址才会变成真实地址。');
}
console.log('  1) 提交推送 (zip 也一起提交, 它就是更新下载源):');
console.log('     git add -A && git commit -m "' + version + '"');
console.log('     git tag ' + version + ' && git push && git push --tags');
console.log('  2) 手机 KernelSU 管理器下拉刷新, 应能看到 ' + version + ' 可更新');
console.log('  3) 仓库里旧版本的 zip 可以在 Gitee 网页上删掉, 避免仓库越来越大');
