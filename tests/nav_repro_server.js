/* 滑块复现用本地服务器: 服务模块 webroot, 支持 ?nav=old / ?nav=dbg 换变体。
   - old: 旧版 nav.js (tests/nav_repro/nav_old.js) + 旧版样式表 (glass_old.css), 作对照组
   - dbg: 当前 nav.js + window.__navLog 打点 (tests/nav_repro/nav_debug.js)
   用法: node tests/nav_repro_server.js   → http://127.0.0.1:8791/index.html[?nav=old|dbg] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '模块', 'Turbo调度26.110', 'webroot');
const VARIANTS = {
  old: { nav: path.resolve(__dirname, 'nav_repro', 'nav_old.js'),
         css: path.resolve(__dirname, 'nav_repro', 'glass_old.css') },
  dbg: { nav: path.resolve(__dirname, 'nav_repro', 'nav_debug.js') }
};
const PORT = 8791;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const v = VARIANTS[u.searchParams.get('nav')];

  let fp = null;
  if (v && p === '/nav.js') fp = v.nav;
  else if (v && v.css && p === '/glass-style.css') fp = v.css;
  else {
    fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
  }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('404'); return; }

  let body = fs.readFileSync(fp);
  const ext = path.extname(fp).toLowerCase();
  if (ext === '.html') {
    let html = String(body);
    const variant = u.searchParams.get('nav');
    if (v) {
      html = html.replace(/nav\.js\?v=[\w.-]+/g, 'nav.js?nav=' + variant);
      if (v.css) html = html.replace(/glass-style\.css\?v=[\w.-]+/g, 'glass-style.css?nav=' + variant);
    }
    /* 测试稳定剂: 页面内容(操作日志/卡片)会让滚动条反复出现又消失, 整页横向漂移几像素,
       使"绝对坐标采样"失真 —— 测试期间禁掉根滚动, 布局就固定了 (不影响被测逻辑) */
    html = html.replace('</head>', '<style>html,body{overflow:hidden !important}</style></head>');
    body = Buffer.from(html, 'utf8');
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log('nav repro server: http://127.0.0.1:' + PORT + '/index.html'));
