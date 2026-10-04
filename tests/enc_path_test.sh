#!/bin/sh
# enc 注入路径桩测试 (无需真机): 从 cloud_ctrl.sh 抽出真实的 .enc 分支 + 收尾 localize 代码,
# 用桩 cosa 跑, 验证: 调不调 cosa enc / 参数对不对 / 退出码怎么传导 / 收尾是否仍在 / 是否残留旧绕行。
# 用法: sh tests/enc_path_test.sh
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/../模块/Turbo调度26.113/scripts/cloud_ctrl.sh"
[ -f "$SRC" ] || { echo "找不到 cloud_ctrl.sh"; exit 1; }

# 抽真实代码 (不复制, 避免与源码漂移): .enc 分支 + 收尾 localize
ENC_BRANCH=$(sed -n '/# ── 2\. \.enc 组/,/localize "\$CCCF_DIR"/p' "$SRC")
[ -n "$ENC_BRANCH" ] || { echo "抽取 enc 分支失败"; exit 1; }
echo "$ENC_BRANCH" | grep -q 'cosa" enc' || { echo "抽取到的分支里没有 cosa enc 调用"; exit 1; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  OK   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1 (得到 $2, 期望 $3)"; }

BASE="$HERE/.tmp_enc_test"

setup() {   # $1 = cosa enc 的退出码
  rm -rf "$BASE"; mkdir -p "$BASE/bin" "$BASE/log" "$BASE/cccf"
  MODPATH="$BASE"; LOG_DIR="$BASE/log"; CCCF_DIR="$BASE/cccf"
  CALLS="$BASE/calls.txt"; : > "$CALLS"
  cat > "$BASE/bin/cosa" <<EOF
#!/bin/sh
echo "cosa \$*" >> "$CALLS"
case "\$1" in
  enc) echo "OK: stub-pkg (enc 解密注入)"; exit $1 ;;
  *)   exit 0 ;;
esac
EOF
  chmod 755 "$BASE/bin/cosa"
  log() { echo "LOG $*" >> "$CALLS"; }
}

run_branch() { INJECT_FAILED=0; eval "$ENC_BRANCH" >/dev/null 2>&1; }

echo "=== 用例 1: 有 .enc 且 cosa enc 成功 → 调一次 cosa enc <cccf>, 失败标记 0 ==="
setup 0
printf 'x' > "$CCCF_DIR/com.foo.enc"; printf 'x' > "$CCCF_DIR/com.bar.enc"
enc_count=2
run_branch
check "cosa enc 调用次数" "$(grep -c '^cosa enc ' "$CALLS")" "1"
check "enc 参数是 cccf 目录" "$(grep -c "^cosa enc $CCCF_DIR\$" "$CALLS")" "1"
check "收尾 localize 仍执行" "$(grep -c '^cosa localize ' "$CALLS")" "1"
check "成功日志" "$(grep -c 'enc 注入完成' "$CALLS")" "1"
check "退出标记" "$INJECT_FAILED" "0"

echo "=== 用例 2: cosa enc 失败 (rc=1) → 失败标记 1, 但收尾 localize 仍要跑 ==="
setup 1
printf 'x' > "$CCCF_DIR/com.foo.enc"
enc_count=1
run_branch
check "cosa enc 调用次数" "$(grep -c '^cosa enc ' "$CALLS")" "1"
check "收尾 localize 仍执行" "$(grep -c '^cosa localize ' "$CALLS")" "1"
check "错误日志" "$(grep -c 'cosa enc 执行失败' "$CALLS")" "1"
check "退出标记" "$INJECT_FAILED" "1"

echo "=== 用例 3: 无 .enc → 不调 cosa enc, 只走收尾 ==="
setup 0
enc_count=0
run_branch
check "cosa enc 调用次数" "$(grep -c '^cosa enc ' "$CALLS")" "0"
check "无兜底日志" "$(grep -c 'enc: 无兜底' "$CALLS")" "1"
check "收尾 localize 仍执行" "$(grep -c '^cosa localize ' "$CALLS")" "1"
check "退出标记" "$INJECT_FAILED" "0"

echo "=== 用例 4: 回归保护 —— 新流程不得再撤保护/事后标回 (直接写 from_server=0) ==="
setup 0
printf 'x' > "$CCCF_DIR/com.foo.enc"
enc_count=1
run_branch
check "未调用 cosa unprotect" "$(grep -c 'cosa unprotect' "$CALLS")" "0"
check "未调用 cosa protect"   "$(grep -c 'cosa protect' "$CALLS")" "0"

echo "=== 用例 5: 源码里不再引用已删除的注入器与旧临时目录 ==="
check "cloud_ctrl.sh 无 bin/inject 引用" "$(grep -c 'bin/inject' "$SRC")" "0"
check "cloud_ctrl.sh 无 run_inject 函数" "$(grep -c 'run_inject' "$SRC")" "0"
check "cloud_ctrl.sh 无 encrypted_oplus-config 拷贝" "$(grep -c 'ENC_RUN=' "$SRC")" "0"
check "cloud_ctrl.sh 无 pkg_installed 过滤" "$(grep -c 'pkg_installed' "$SRC")" "0"

rm -rf "$BASE"
echo
echo "结果: 通过 $PASS, 失败 $FAIL"
[ "$FAIL" -eq 0 ]
