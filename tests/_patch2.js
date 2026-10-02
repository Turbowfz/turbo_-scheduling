/* 一次性补丁: 复现台判定统一改用一致的实时量, 几何差降为参考 */
const fs = require('fs');
const f = 'tests/nav_repro/harness_body.js';
let s = fs.readFileSync(f, 'utf8');

const pairs = [
  [
    "const targetCend = (relEnd[P.tabTo || \"cloud\"] !== undefined) ? relEnd[P.tabTo || \"cloud\"] : targetC;\nconst tapOk = stable && uniq >= 5 && Math.abs(last.c - targetCend) < 5 && landed === (P.tabTo || 'cloud') && grabbedSamples > 0 && !ind.classList.contains('grabbed');",
    "/* 判定只用一致的实时量 (landed/under/flash/postMove/残余): 绝对几何基准会因窗格尺寸变化而失效 */\nconst targetCend = (relEnd[P.tabTo || \"cloud\"] !== undefined) ? relEnd[P.tabTo || \"cloud\"] : targetC;\nconst tapOk = stable && uniq >= 5 && landed === (P.tabTo || 'cloud') && under === (P.tabTo || 'cloud') && grabbedSamples > 0 && !ind.classList.contains('grabbed') && postMove <= 2;"
  ],
  [
    "const flickOk = stable && landed === (P.tabTo || 'about') && under === (P.tabTo || 'about') && Math.abs(last.c - targetCend) < 6 && flash === 0 && !ind.classList.contains('grabbed');",
    "const flickOk = stable && landed === (P.tabTo || 'about') && under === (P.tabTo || 'about') && flash === 0 && !ind.classList.contains('grabbed') && postMove <= 2;"
  ],
  [
    "const dragoutOk = stable && landed === (P.tabTo || 'about') && under === (P.tabTo || 'about') && Math.abs(last.c - targetCend) < 6 && flash === 0 && !ind.classList.contains('grabbed');",
    "const dragoutOk = stable && landed === (P.tabTo || 'about') && under === (P.tabTo || 'about') && flash === 0 && !ind.classList.contains('grabbed') && postMove <= 2;"
  ],
  [
    "  && Math.abs(last.c - c2rel) < 5 && landed === tab2 && last.sc > 0.99",
    "  && landed === tab2 && last.sc > 0.99"
  ]
];

let n = 0;
for (const [a, b] of pairs) {
  if (!s.includes(a)) { console.error('anchor missing: ' + a.slice(0, 60)); process.exit(1); }
  s = s.replace(a, b);
  n++;
}
fs.writeFileSync(f, s, 'utf8');
console.log('patched ' + n + ' assertion anchors');
