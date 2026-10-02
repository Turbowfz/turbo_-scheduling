#!/bin/sh
# enc 注入路径桩测试 (无需真机): 从 cloud_ctrl.sh 抽出真实的 run_inject + .enc 分支代码,
# 用桩 cosa / inject / pkg_installed 跑, 验证前置检查、递进重试间隔与撤保护次数。
# 用法: sh tests/enc_path_test.sh
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/../模块/Turbo调度26.112/scripts/cloud_ctrl.sh"
[ -f "$SRC" ] || { echo "找不到 cloud_ctrl.sh"; exit 1; }

# 抽出真实代码 (不复制, 避免与源码漂移): run_inject 与 .enc 分支
RUN_INJECT=$(sed -n '/^  run_inject() {/,/^  }$/p' "$SRC")
ENC_BRANCH=$(sed -n '/# ── 2\. \.enc 组/,/# 收尾:/p' "$SRC" | sed '$d')
[ -n "$RUN_INJECT" ] || { echo "抽取 run_inject 失败"; exit 1; }
[ -n "$ENC_BRANCH" ] || { echo "抽取 enc 分支失败"; exit 1; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  OK   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1 (得到 $2, 期望 $3)"; }

BASE="$HERE/.tmp_enc_test"

setup() {   # $1 = inject 桩行为: retry_then_ok | always_retry | hard_fail | missing
  rm -rf "$BASE"; mkdir -p "$BASE/bin" "$BASE/log" "$BASE/cccf"
  MODPATH="$BASE"; LOG_DIR="$BASE/log"; CCCF_DIR="$BASE/cccf"
  ENC_RUN="$BASE/encrypted_oplus-config"
  INJECT="$BASE/bin/inject"
  CALLS="$BASE/calls.txt"; : > "$CALLS"
  N="$BASE/n"; rm -f "$N"
  # cosa 桩 (路径写死, 不依赖环境变量)
  cat > "$BASE/bin/cosa" <<EOF
#!/bin/sh
echo "cosa \$*" >> "$CALLS"
exit 0
EOF
  chmod 755 "$BASE/bin/cosa"
  # inject 桩
  if [ "$1" != "missing" ]; then
    cat > "$INJECT" <<EOF
#!/bin/sh
n=\$(cat "$N" 2>/dev/null || echo 0); n=\$((n+1)); echo \$n > "$N"
echo "inject-run-\$n" >> "$CALLS"
case "$1" in
  retry_then_ok) [ "\$n" -lt 3 ] && { echo "未获取到第三方应用"; exit 1; }; echo "注入成功"; exit 0 ;;
  always_retry)  echo "未获取到第三方应用"; exit 1 ;;
  hard_fail)     echo "Error: database locked"; exit 1 ;;
esac
EOF
    chmod 755 "$INJECT"
  fi
  # 与 cloud_ctrl.sh 里的真实实现同语义: 列表为空时 fail-open (放行), 不是拒绝
  installed_piped="|com.foo|com.bar|"
  pkg_installed() { [ -z "$installed_piped" ] && return 0; case "$installed_piped" in *"|$1|"*) return 0 ;; esac; return 1; }
  log() { echo "LOG $*" >> "$CALLS"; }
  sleep() { echo "sleep $1" >> "$CALLS"; }     # 不真睡, 只记录
  # cp 也记一笔: 抽取的代码段末尾带 `rm -rf $ENC_RUN` 清理, 事后看目录会看不到拷贝结果
  cp() { echo "cp $*" >> "$CALLS"; command cp "$@"; }
  enc_count=3
}

run_branch() {   # 在桩环境里跑真实代码 (run_inject 的定义也要 eval, 否则函数不存在)
  INJECT_FAILED=0
  enc_test() { eval "$RUN_INJECT"; eval "$ENC_BRANCH"; }
  enc_test
}

echo "=== 用例 1: 前两次报未获取到第三方应用, 第三次成功 → 递进等待 5s/10s, 每次尝试撤/武装各一次 ==="
setup retry_then_ok
printf 'x' > "$CCCF_DIR/com.foo.enc"; printf 'x' > "$CCCF_DIR/com.bar.enc"
printf 'x' > "$CCCF_DIR/com.baz.enc"           # 未安装 → 不该被注入
run_branch >/dev/null 2>&1
check "撤保护次数 (unprotect)" "$(grep -c 'cosa unprotect' "$CALLS")" "3"
check "重新武装次数 (protect)"  "$(grep -c 'cosa protect' "$CALLS")" "3"
check "重试等待序列"            "$(grep '^sleep' "$CALLS" | tr '\n' ' ')" "sleep 5 sleep 10 "
check "只拷已安装的 enc (2 个)"  "$(grep -c '^cp ' "$CALLS")" "2"
check "未拷未安装的 com.baz"    "$(grep -c 'com.baz.enc' "$CALLS")" "0"
check "退出标记"                "$INJECT_FAILED" "0"

echo "=== 用例 2: 注入器缺失 → 前置检查直接跳过, 不跑注入器 ==="
setup missing
printf 'x' > "$CCCF_DIR/com.foo.enc"
run_branch >/dev/null 2>&1
check "未调用 cosa unprotect" "$(grep -c 'cosa unprotect' "$CALLS")" "0"
check "退出标记"              "$INJECT_FAILED" "1"

echo "=== 用例 3: 拿不到已安装列表 → 跳过 (不白等重试) ==="
setup retry_then_ok
printf 'x' > "$CCCF_DIR/com.foo.enc"
installed_piped=""
run_branch >/dev/null 2>&1
check "未调用注入器" "$(grep -c '^inject-run' "$CALLS")" "0"
check "退出标记"     "$INJECT_FAILED" "1"

echo "=== 用例 4: 一直未就绪 → 5 次尝试后放弃, 等待合计 95 秒 (旧版固定 30s 是 150 秒) ==="
setup always_retry
printf 'x' > "$CCCF_DIR/com.foo.enc"
run_branch >/dev/null 2>&1
check "尝试次数" "$(grep -c '^inject-run' "$CALLS")" "5"
check "等待合计" "$(grep '^sleep' "$CALLS" | awk '{s+=$2} END{print s}' | tr -d ' ')" "95"
check "退出标记" "$INJECT_FAILED" "1"

echo "=== 用例 5: 硬错误 (非未就绪) → 快速失败, 不重试 ==="
setup hard_fail
printf 'x' > "$CCCF_DIR/com.foo.enc"
run_branch >/dev/null 2>&1
check "尝试次数" "$(grep -c '^inject-run' "$CALLS")" "1"
check "退出标记" "$INJECT_FAILED" "1"

echo "=== 用例 6: 有同名 json 的 enc → 不注入 (json 优先) ==="
setup retry_then_ok
printf 'x' > "$CCCF_DIR/com.foo.enc"; printf '{}' > "$CCCF_DIR/com.foo.json"
run_branch >/dev/null 2>&1
check "未调用注入器" "$(grep -c '^inject-run' "$CALLS")" "0"
check "退出标记"     "$INJECT_FAILED" "0"

rm -rf "$BASE"
echo
echo "结果: 通过 $PASS, 失败 $FAIL"
[ "$FAIL" -eq 0 ]
