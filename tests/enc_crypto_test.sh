#!/bin/sh
# enc 解密自测 (宿主机, 不需要设备): 编译 cosa-rs/src/enc.rs 的 #[cfg(test)] 并跑。
# 覆盖: SHA-256 / HMAC-SHA256 (RFC 4231) / PBKDF2 (RFC 7914) / AES-256 分组 (FIPS-197) /
#       AES-256-GCM (NIST SP 800-38D) / 口令派生已知值 / 真机样本端到端。
# 真机样本 (第三方云控配置) 不入库, 放在 cosa-rs/tests/enc_testdata/ 时自动生效。
set -e
cd "$(dirname "$0")/.." || exit 1
cd cosa-rs || exit 1

OUT="$(mktemp -d 2>/dev/null || echo /tmp)/enc_test_$$"
rustc --test --edition 2021 -O src/enc.rs -o "$OUT" || { echo "编译失败"; exit 1; }
"$OUT" --nocapture
RC=$?
rm -f "$OUT"
exit $RC
