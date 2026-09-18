/* make-zip: create module zip with FORWARD-SLASH entry paths (KSU/Magisk/Info-ZIP compatible)
   目录条目显式写入 (name 以 / 结尾, MS-DOS 目录属性 0x10):
   手机解压预览工具在没有目录占位时会把 "webroot/cloud-io.js" 整条当平面文件名显示 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node make-zip.js <srcDir> <outZip>'); process.exit(1); }

/* zip local file header layout */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* collect files + directories (stable sort for reproducibility) */
function walk(dir, base, out, dirs) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) {
      dirs.add(rel + '/');
      walk(full, rel, out, dirs);
    }
    else out.push({ full, rel });
  }
  return out;
}
const dirs = new Set();
const files = walk(SRC, '', [], dirs);

/* 目录条目排在最前 (父目录在前), 保证预览工具先见目录再见文件 */
const dirEntries = [...dirs].sort((a, b) => a.split('/').length - b.split('\/').length || a.localeCompare(b));

/* Use Node zlib deflateRaw per file and hand-build the zip (STORED for already-compressed). */
const zlib = require('zlib');
const chunks = [];
const central = [];
let offset = 0;

const dosTime = (() => {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
})();

function pushEntry(nameBuf, crc, payloadLen, rawLen, method, isDir) {
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);          /* version needed */
  lh.writeUInt16LE(0, 6);           /* flags: no UTF8 flag needed for ASCII names (all ours are ASCII) */
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(dosTime.time, 10);
  lh.writeUInt16LE(dosTime.date, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(payloadLen, 18);
  lh.writeUInt32LE(rawLen, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);          /* extra len */
  chunks.push(lh, nameBuf, payloadLen ? payloadBuf : null);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);          /* version made by */
  ch.writeUInt16LE(20, 6);          /* version needed */
  ch.writeUInt16LE(0, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(dosTime.time, 12);
  ch.writeUInt16LE(dosTime.date, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(payloadLen, 20);
  ch.writeUInt32LE(rawLen, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(0, 38);          /* external attrs */
  if (isDir) ch.writeUInt8(0x10, 38);   /* MS-DOS 目录属性 */
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + (payloadLen ? payloadBuf.length : 0);
}

let payloadBuf = Buffer.alloc(0);
/* 1. 目录条目 (STORED, 0 字节) */
for (const d of dirEntries) {
  payloadBuf = Buffer.alloc(0);
  pushEntry(Buffer.from(d, 'utf8'), 0, 0, 0, 0, true);
}
/* 2. 文件条目 */
for (const f of files) {
  const data = fs.readFileSync(f.full);
  const crc = crc32(data);
  /* deflate raw */
  const def = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = def.length < data.length;
  payloadBuf = useDeflate ? def : data;
  const method = useDeflate ? 8 : 0;

  pushEntry(Buffer.from(f.rel, 'utf8'), crc, payloadBuf.length, data.length, method, false);
}

const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(dirEntries.length + files.length, 8);
eocd.writeUInt16LE(dirEntries.length + files.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...chunks.filter(Boolean), cdBuf, eocd]);
fs.writeFileSync(OUT, zip);
console.log(`ok: ${OUT}  dirs=${dirEntries.length} files=${files.length}  bytes=${zip.length}`);
