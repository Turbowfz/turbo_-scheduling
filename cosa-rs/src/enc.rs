/* ── .enc 云控包解密 (纯 Rust, 不引新依赖) ──
   算法来源: 对闭源 enc 注入器 (感谢名单 @toolfor) 的逆向 + 实机逐字节验证
   (真机上 cosa enc 与闭源工具对同一样本输出一致, tag 校验也逐位一致)。

   文件布局:
     文本内容 → 跳过全部 ≤0x20 的字符 → 标准 base64 解码 → 二进制
     二进制 = [头部 hdr_len 字节][密文][tag 16字节]
     hdr_len = 0x40 | (首字节 & 0x1f)   (即 64~95)
     校验: 总长 ≥ 0x50 且 ≥ hdr_len + 0x50

   密钥派生:
     IV   = SHA256(IV_SALT ‖ 头部) 的前 12 字节
     密钥 = PBKDF2-HMAC-SHA256(口令, KEY_SALT ‖ 头部, 100000 次, 32 字节)
     口令 = pw_derive(): 32 字节, 由三张常量表混淆派生 (逆向实锤, 见下)

   解密: AES-256-GCM
     AAD = 头部 ‖ 包名 (文件名去掉 .enc)
     tag = GHASH(AAD, 密文) ⊕ AES(密钥, IV‖00000001)  —— 标准 GCM
     校验通过后 CTR 解密 (首块计数 = IV‖00000002)

   本模块只做纯函数, 不碰文件系统/数据库, 便于宿主机直接 rustc --test 自测。 */

/* ── 常量 (从闭源注入器二进制 .rodata 提取) ── */
const IV_SALT: [u8; 16] = [
    0x91, 0x2e, 0xd7, 0x4b, 0x63, 0xa8, 0x05, 0xfc, 0x3a, 0x77, 0xb1, 0x49, 0xde, 0x20, 0x86, 0x5d,
];
const KEY_SALT: [u8; 16] = [
    0xc4, 0x38, 0x7a, 0x15, 0xe9, 0x62, 0x0d, 0xb7, 0x51, 0xac, 0x34, 0x8f, 0x06, 0xdd, 0x93, 0x2b,
];
/* 口令派生表: T1/T2 各 32 字节, T3 32 字节 (查表下标 (i*11+7) & 31) */
const T1: [u8; 32] = [
    0x86, 0xad, 0x70, 0x43, 0x87, 0xfb, 0x22, 0x5c, 0x60, 0x9b, 0x1a, 0x36, 0x23, 0xa2, 0x1d, 0x03,
    0x2b, 0x3a, 0x09, 0x70, 0x43, 0xf8, 0x10, 0x64, 0xc1, 0xc7, 0x9a, 0x50, 0x70, 0x90, 0x62, 0xdb,
];
const T2: [u8; 32] = [
    0x3f, 0x83, 0xd1, 0x09, 0x97, 0x32, 0xee, 0x85, 0x6d, 0x2b, 0xf4, 0xe9, 0xe8, 0xf9, 0xd8, 0xf9,
    0x66, 0x11, 0x4f, 0x8a, 0x4b, 0xc0, 0x77, 0x54, 0xab, 0xbc, 0x98, 0x06, 0xf6, 0xb1, 0xc1, 0xb8,
];
const T3: [u8; 32] = [
    0x25, 0x77, 0xdb, 0xb3, 0x1d, 0x8c, 0x39, 0xd3, 0x48, 0x41, 0x32, 0x72, 0x0c, 0x17, 0x1f, 0x39,
    0x4b, 0xad, 0xb5, 0x87, 0x95, 0x8f, 0xdf, 0x04, 0x64, 0x53, 0xcf, 0xa0, 0xd2, 0xb7, 0xb0, 0xf2,
];

const PBKDF2_ITERS: u32 = 100_000;
const TAG_LEN: usize = 16;

/* ── 口令派生: 逆向自 pw 构造例程, 实机断点取 ipad^0x36 逐字节比对一致 ── */
fn rol8(x: u8, n: u32) -> u8 {
    let n = n & 7;
    if n == 0 { return x; }
    let w = x as u16;
    (((w << n) | (w >> (8 - n))) & 0xff) as u8
}

pub fn pw_derive() -> [u8; 32] {
    let mut pw = [0u8; 32];
    for i in 0..32usize {
        let k = ((i as u32).wrapping_mul(0x1d).wrapping_add(0xa7) & 0xff) as u8;
        let v = rol8(T1[i] ^ k, (i as u32 % 7) + 1);
        let idx = (i.wrapping_mul(0xb).wrapping_add(7)) & 0x1f;
        pw[i] = T2[i] ^ v ^ T3[idx].wrapping_add(0x3d).wrapping_add(i as u8);
    }
    pw
}

/* ── SHA-256 (标准) ── */
const K256: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

pub struct Sha256 {
    h: [u32; 8],
    buf: [u8; 64],
    buf_len: usize,
    total: u64,
}

impl Sha256 {
    pub fn new() -> Self {
        Sha256 {
            h: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
            ],
            buf: [0; 64],
            buf_len: 0,
            total: 0,
        }
    }

    fn compress(&mut self, block: &[u8]) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([block[4 * i], block[4 * i + 1], block[4 * i + 2], block[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut v = self.h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ ((!v[4]) & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K256[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v[7] = v[6];
            v[6] = v[5];
            v[5] = v[4];
            v[4] = v[3].wrapping_add(t1);
            v[3] = v[2];
            v[2] = v[1];
            v[1] = v[0];
            v[0] = t1.wrapping_add(t2);
        }
        for i in 0..8 {
            self.h[i] = self.h[i].wrapping_add(v[i]);
        }
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.total = self.total.wrapping_add(data.len() as u64);
        if self.buf_len > 0 {
            let need = 64 - self.buf_len;
            let take = need.min(data.len());
            self.buf[self.buf_len..self.buf_len + take].copy_from_slice(&data[..take]);
            self.buf_len += take;
            data = &data[take..];
            if self.buf_len == 64 {
                let block = self.buf;
                self.compress(&block);
                self.buf_len = 0;
            }
        }
        while data.len() >= 64 {
            let (blk, rest) = data.split_at(64);
            self.compress(blk);
            data = rest;
        }
        if !data.is_empty() {
            self.buf[..data.len()].copy_from_slice(data);
            self.buf_len = data.len();
        }
    }

    pub fn finalize(mut self) -> [u8; 32] {
        let bit_len = self.total.wrapping_mul(8);
        self.update(&[0x80]);
        while self.buf_len != 56 {
            self.update(&[0]);
        }
        /* 手工补长度, 避免递归统计 total */
        let block = {
            let mut b = self.buf;
            b[56..64].copy_from_slice(&bit_len.to_be_bytes());
            b
        };
        self.compress(&block);
        let mut out = [0u8; 32];
        for i in 0..8 {
            out[4 * i..4 * i + 4].copy_from_slice(&self.h[i].to_be_bytes());
        }
        out
    }
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize()
}

/* ── HMAC-SHA256 / PBKDF2 (标准) ── */
pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&sha256(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let mut ih = Sha256::new();
    ih.update(&ipad);
    ih.update(msg);
    let inner = ih.finalize();
    let mut oh = Sha256::new();
    oh.update(&opad);
    oh.update(&inner);
    oh.finalize()
}

pub fn pbkdf2_hmac_sha256(pw: &[u8], salt: &[u8], iters: u32, dklen: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(dklen);
    let mut block: u32 = 1;
    while out.len() < dklen {
        let mut msg = salt.to_vec();
        msg.extend_from_slice(&block.to_be_bytes());
        let mut u = hmac_sha256(pw, &msg);
        let mut t = u;
        for _ in 1..iters {
            u = hmac_sha256(pw, &u);
            for i in 0..32 {
                t[i] ^= u[i];
            }
        }
        let take = (dklen - out.len()).min(32);
        out.extend_from_slice(&t[..take]);
        block += 1;
    }
    out
}

/* ── base64 (标准字母表; 跳过全部 ≤0x20 字符, 与注入器一致) ── */
pub type EResult<T> = std::result::Result<T, String>;

pub fn b64_decode_skip_ws(text: &[u8]) -> EResult<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut quad = [0i32; 4];
    let mut n = 0usize;
    for &c in text {
        if c <= 0x20 { continue; }
        if c == b'=' { /* 结尾填充: 后续只允许再有 '=' 和空白 */ }
        let v: i32 = match c {
            b'A'..=b'Z' => (c - b'A') as i32,
            b'a'..=b'z' => (c - b'a') as i32 + 26,
            b'0'..=b'9' => (c - b'0') as i32 + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => -1,
            _ => return Err(format!("base64 非法字符: 0x{:02x}", c)),
        };
        if n == 4 {
            emit_quad(&quad, &mut out);
            n = 0;
        }
        quad[n] = v;
        n += 1;
    }
    if n > 0 {
        /* 结尾不足 4 个: '=' 已计为 -1, 不足部分也按 -1 */
        while n < 4 { quad[n] = -1; n += 1; }
        emit_quad(&quad, &mut out);
    }
    Ok(out)
}

fn emit_quad(quad: &[i32; 4], out: &mut Vec<u8>) {
    let vals = [
        if quad[0] < 0 { 0 } else { quad[0] },
        if quad[1] < 0 { 0 } else { quad[1] },
        if quad[2] < 0 { 0 } else { quad[2] },
        if quad[3] < 0 { 0 } else { quad[3] },
    ];
    let n = (quad[0] >= 0) as usize + (quad[1] >= 0) as usize
        + (quad[2] >= 0) as usize + (quad[3] >= 0) as usize;
    let v = ((vals[0] as u32) << 18) | ((vals[1] as u32) << 12)
        | ((vals[2] as u32) << 6) | (vals[3] as u32);
    if n >= 2 { out.push(((v >> 16) & 0xff) as u8); }
    if n >= 3 { out.push(((v >> 8) & 0xff) as u8); }
    if n >= 4 { out.push((v & 0xff) as u8); }
}

/* ── AES-256 (仅加密方向, GCM 用) ── */
const SBOX: [u8; 256] = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
];

const RCON: [u8; 7] = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40];

pub struct Aes256 {
    rk: [u32; 60],
}

impl Aes256 {
    pub fn new(key: &[u8; 32]) -> Self {
        let mut rk = [0u32; 60];
        for i in 0..8 {
            rk[i] = u32::from_be_bytes([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
        }
        for i in 8..60 {
            let mut tmp = rk[i - 1];
            if i % 8 == 0 {
                tmp = tmp.rotate_left(8); /* RotWord */
                tmp = ((SBOX[(tmp >> 24) as usize] as u32) << 24)
                    | ((SBOX[((tmp >> 16) & 0xff) as usize] as u32) << 16)
                    | ((SBOX[((tmp >> 8) & 0xff) as usize] as u32) << 8)
                    | (SBOX[(tmp & 0xff) as usize] as u32);
                tmp ^= (RCON[i / 8 - 1] as u32) << 24;
            } else if i % 8 == 4 {
                tmp = ((SBOX[(tmp >> 24) as usize] as u32) << 24)
                    | ((SBOX[((tmp >> 16) & 0xff) as usize] as u32) << 16)
                    | ((SBOX[((tmp >> 8) & 0xff) as usize] as u32) << 8)
                    | (SBOX[(tmp & 0xff) as usize] as u32);
            }
            rk[i] = rk[i - 8] ^ tmp;
        }
        Aes256 { rk }
    }

    pub fn encrypt_block(&self, blk: &mut [u8; 16]) {
        let mut s = *blk;
        add_round_key(&mut s, &self.rk[0..4]);
        for round in 1..14 {
            sub_bytes(&mut s);
            shift_rows(&mut s);
            mix_columns(&mut s);
            add_round_key(&mut s, &self.rk[round * 4..round * 4 + 4]);
        }
        sub_bytes(&mut s);
        shift_rows(&mut s);
        add_round_key(&mut s, &self.rk[56..60]);
        *blk = s;
    }
}

fn add_round_key(s: &mut [u8; 16], rk: &[u32]) {
    for i in 0..4 {
        let w = rk[i].to_be_bytes();
        for j in 0..4 {
            s[4 * i + j] ^= w[j];
        }
    }
}

fn sub_bytes(s: &mut [u8; 16]) {
    for b in s.iter_mut() {
        *b = SBOX[*b as usize];
    }
}

fn shift_rows(s: &mut [u8; 16]) {
    /* 列主序: state[r][c] = s[c*4+r] */
    let t = *s;
    for r in 1..4 {
        for c in 0..4 {
            s[c * 4 + r] = t[((c + r) % 4) * 4 + r];
        }
    }
}

fn xtime(x: u8) -> u8 {
    (x << 1) ^ (((x >> 7) & 1) * 0x1b)
}

fn mix_columns(s: &mut [u8; 16]) {
    for c in 0..4 {
        let a = [s[c * 4], s[c * 4 + 1], s[c * 4 + 2], s[c * 4 + 3]];
        s[c * 4] = xtime(a[0]) ^ (a[1] ^ xtime(a[1])) ^ a[2] ^ a[3];
        s[c * 4 + 1] = a[0] ^ xtime(a[1]) ^ (a[2] ^ xtime(a[2])) ^ a[3];
        s[c * 4 + 2] = a[0] ^ a[1] ^ xtime(a[2]) ^ (a[3] ^ xtime(a[3]));
        s[c * 4 + 3] = (a[0] ^ xtime(a[0])) ^ a[1] ^ a[2] ^ xtime(a[3]);
    }
}

/* ── GHASH (标准 GF(2^128), MSB-first) ── */
fn ghash_mul(x: &[u8; 16], h: &[u8; 16]) -> [u8; 16] {
    const R: u128 = 0xe1000000000000000000000000000000;
    let mut z: u128 = 0;
    let mut v = u128::from_be_bytes(*h);
    let xi = u128::from_be_bytes(*x);
    for i in (0..128).rev() {
        if (xi >> i) & 1 == 1 {
            z ^= v;
        }
        v = if v & 1 == 1 { (v >> 1) ^ R } else { v >> 1 };
    }
    z.to_be_bytes()
}

fn ghash(aad: &[u8], ct: &[u8], h: &[u8; 16]) -> [u8; 16] {
    let mut y = [0u8; 16];
    for buf in [aad, ct] {
        for chunk in buf.chunks(16) {
            let mut blk = [0u8; 16];
            blk[..chunk.len()].copy_from_slice(chunk);
            for i in 0..16 {
                y[i] ^= blk[i];
            }
            y = ghash_mul(&y, h);
        }
    }
    let lb = ((aad.len() as u64) * 8).to_be_bytes();
    let mut blk = [0u8; 16];
    blk[..8].copy_from_slice(&lb);
    blk[8..].copy_from_slice(&((ct.len() as u64) * 8).to_be_bytes());
    for i in 0..16 {
        y[i] ^= blk[i];
    }
    ghash_mul(&y, h)
}

fn inc32(b: &[u8; 16]) -> [u8; 16] {
    let mut o = *b;
    let ctr = u32::from_be_bytes([o[12], o[13], o[14], o[15]]).wrapping_add(1);
    o[12..16].copy_from_slice(&ctr.to_be_bytes());
    o
}

/* ── AES-256-GCM 解密 (标准) ── */
pub fn gcm_decrypt(key: &[u8; 32], iv: &[u8; 12], aad: &[u8], ct: &[u8], tag: &[u8]) -> EResult<Vec<u8>> {
    if tag.len() != TAG_LEN {
        return Err("tag 长度异常".to_string());
    }
    let aes = Aes256::new(key);
    let mut zero = [0u8; 16];
    aes.encrypt_block(&mut zero);
    let j0 = {
        let mut j = [0u8; 16];
        j[..12].copy_from_slice(iv);
        j[15] = 1;
        j
    };
    let s = ghash(aad, ct, &zero);
    let mut ekj0 = j0;
    aes.encrypt_block(&mut ekj0);
    let mut expect = [0u8; 16];
    for i in 0..16 {
        expect[i] = s[i] ^ ekj0[i];
    }
    if expect[..] != tag[..] {
        return Err("tag 校验失败 (解密结果不可信)".to_string());
    }
    let mut out = Vec::with_capacity(ct.len());
    let mut ctr = inc32(&j0);
    for chunk in ct.chunks(16) {
        let mut ks = ctr;
        aes.encrypt_block(&mut ks);
        for (i, b) in chunk.iter().enumerate() {
            out.push(b ^ ks[i]);
        }
        ctr = inc32(&ctr);
    }
    Ok(out)
}

/* ── .enc 配置整体解密管线 ── */
pub struct DecodedConfig {
    pub json: Vec<u8>,
}

pub fn decrypt_enc(text: &[u8], pkg: &str) -> EResult<DecodedConfig> {
    let bin = b64_decode_skip_ws(text)?;
    if bin.len() < 0x50 {
        return Err(format!("解码后过短 ({} 字节)", bin.len()));
    }
    let hdr_len = 0x40usize | (bin[0] & 0x1f) as usize;
    if bin.len() < hdr_len + 0x50 {
        return Err(format!("解码后长度不足 (头 {} + 密文/tag)", hdr_len));
    }
    let header = &bin[..hdr_len];
    let ct = &bin[hdr_len..bin.len() - TAG_LEN];
    let tag = &bin[bin.len() - TAG_LEN..];

    let iv_full = sha256(&iv_salt_with(header));
    let mut iv = [0u8; 12];
    iv.copy_from_slice(&iv_full[..12]);

    let pw = pw_derive();
    let mut salt = KEY_SALT.to_vec();
    salt.extend_from_slice(header);
    let key_raw = pbkdf2_hmac_sha256(&pw, &salt, PBKDF2_ITERS, 32);
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_raw);

    let mut aad = header.to_vec();
    aad.extend_from_slice(pkg.as_bytes());
    let json = gcm_decrypt(&key, &iv, &aad, ct, tag)?;
    Ok(DecodedConfig { json })
}

fn iv_salt_with(header: &[u8]) -> Vec<u8> {
    let mut v = IV_SALT.to_vec();
    v.extend_from_slice(header);
    v
}

/* ── 自测 (NIST 标准向量 + 管线自洽), 宿主机 rustc --test 直跑 ── */
#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn sha256_nist() {
        /* NIST FIPS 180-2 例: "abc" */
        assert_eq!(
            hex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
            sha256(b"abc").to_vec()
        );
        /* 空串 */
        assert_eq!(
            hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
            sha256(b"").to_vec()
        );
        /* 448 位 ("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") */
        assert_eq!(
            hex("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"),
            sha256(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq").to_vec()
        );
    }

    #[test]
    fn aes_block_fips() {
        /* FIPS-197 C.3 AES-256 例 */
        let key: [u8; 32] = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f").try_into().unwrap();
        let mut blk: [u8; 16] = hex("00112233445566778899aabbccddeeff").try_into().unwrap();
        Aes256::new(&key).encrypt_block(&mut blk);
        assert_eq!(blk.to_vec(), hex("8ea2b7ca516745bfeafc49904b496089"), "AES-256 block");
        /* 全零 key/块 */
        let mut blk2 = [0u8; 16];
        Aes256::new(&[0u8; 32]).encrypt_block(&mut blk2);
        assert_eq!(blk2.to_vec(), hex("dc95c078a2408989ad48a21492842087"), "AES-256 zero");
    }

    #[test]
    fn hmac_nist() {
        /* RFC 4231 测试用例 1 */
        let k = [0x0bu8; 20];
        assert_eq!(
            hex("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"),
            hmac_sha256(&k, b"Hi There").to_vec()
        );
        /* 测试用例 2 */
        assert_eq!(
            hex("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"),
            hmac_sha256(b"Jefe", b"what do ya want for nothing?").to_vec()
        );
    }

    #[test]
    fn pbkdf2_nist() {
        /* RFC 7914 §12 PD-2 (PBKDF2-HMAC-SHA-256, P="passwd", S="salt", c=1, dkLen=64) 前 32 字节 */
        assert_eq!(
            hex("55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc"),
            pbkdf2_hmac_sha256(b"passwd", b"salt", 1, 32)
        );
        /* RFC 7914 PD-3 (P="Password", S="NaCl", c=2, dkLen=64) 前 32 字节 */
        assert_eq!(
            hex("7897885f70bce63d18e043ad11c3a4b71a326b50c5e183d740d8924f5c3ead46"),
            pbkdf2_hmac_sha256(b"Password", b"NaCl", 2, 32)
        );
    }

    #[test]
    fn aes256_gcm_nist() {
        /* NIST SP 800-38D GCM Test Case 13 (AES-256, 全零 key/iv, 空明文无 AAD) */
        let key: [u8; 32] = hex("0000000000000000000000000000000000000000000000000000000000000000")
            .try_into().unwrap();
        let iv: [u8; 12] = hex("000000000000000000000000").try_into().unwrap();
        let out = gcm_decrypt(&key, &iv, b"", b"", &hex("530f8afbc74536b9a963b4f1c4cb738b")).unwrap();
        assert!(out.is_empty());
        /* TC14: 16 字节零明文 (密文 cea7403d..., tag d0d1c8a7...) */
        let out = gcm_decrypt(
            &key, &iv, b"",
            &hex("cea7403d4d606b6e074ec5d3baf39d18"),
            &hex("d0d1c8a799996bf0265b98b5d48ab919"),
        ).unwrap();
        assert_eq!(out, vec![0u8; 16]);
        /* 64 字节明文 + AAD, iv=cafebabefacedbaddecaf888 (NIST TC16 同参数) */
        let key2: [u8; 32] = hex("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308")
            .try_into().unwrap();
        let iv2: [u8; 12] = hex("cafebabefacedbaddecaf888").try_into().unwrap();
        let aad = hex("feedfacedeadbeeffeedfacedeadbeefabaddad2");
        let pt = hex("d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255");
        let ct = hex("522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad");
        let out = gcm_decrypt(&key2, &iv2, &aad, &ct, &hex("2df7cd675b4f09163b41ebf980a7f638")).unwrap();
        assert_eq!(out, pt);
    }

    /* 真机样本端到端: tests/enc_testdata/<包名>.enc + 同名 .json(期望明文)。
       样本属第三方云控配置, 不入库 (见 cosa-rs/.gitignore), 无样本时自动跳过。 */
    #[test]
    fn real_sample_e2e() {
        let dir = std::path::Path::new("tests/enc_testdata");
        if !dir.is_dir() {
            eprintln!("(无本地样本目录, 跳过真机向量)");
            return;
        }
        let mut checked = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()) != Some("enc") { continue; }
            let pkg = path.file_stem().unwrap().to_string_lossy().to_string();
            let expect_path = dir.join(format!("{}.json", pkg));
            if !expect_path.exists() { continue; }
            let text = std::fs::read(&path).unwrap();
            let expect = std::fs::read(&expect_path).unwrap();
            let cfg = decrypt_enc(&text, &pkg).expect("解密失败");
            /* 先比逐字节; 不一致则退到"去空白后比较"(排版差异不算错) */
            if cfg.json == expect {
                eprintln!("{}: 明文逐字节一致 ({} 字节)", pkg, cfg.json.len());
            } else {
                let strip = |v: &[u8]| -> Vec<u8> {
                    v.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect()
                };
                assert_eq!(strip(&cfg.json), strip(&expect), "{} 明文不一致", pkg);
                eprintln!("{}: 明文去空白后一致 ({} 字节)", pkg, cfg.json.len());
            }
            checked += 1;
        }
        if checked == 0 { eprintln!("(样本目录为空, 跳过真机向量)"); }
    }

    #[test]
    fn b64_pipeline() {
        /* 管线自洽: base64 跳空白 */
        let raw = b" aGVs\nbG8g\nd29ybGQh\t";  /* "hello world!" */
        let dec = b64_decode_skip_ws(raw).unwrap();
        assert_eq!(dec, b"hello world!");
    }

    #[test]
    fn pw_derive_stable() {
        /* 派生口令的已知值 (逆向+实机断点双重确认) */
        let pw = pw_derive();
        assert_eq!(
            hex("6dd5ab5acc30d100e5ea1f9e5b915ac4d5d23e911b500514cceebbd648a3b289"),
            pw.to_vec()
        );
    }
}
