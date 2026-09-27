#!/bin/sh
# SoC 门禁桩测试 (无需真机): stub getprop 后加载 common.sh, 验证
# is_supported_soc 对 4 种骁龙放行、天玑/空属性拒绝, get_soc_dir 对未知机型返回空。
# 用法: sh tests/soc_gate_test.sh
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
COMMON="$HERE/../模块/Turbo调度26.107/scripts/common.sh"
[ -f "$COMMON" ] || { echo "找不到 common.sh"; exit 1; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  OK   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1 (得到 $2, 期望 $3)"; }

# run_with <platform> <soc.model> <命令>: 在 stub 过 getprop 的子 shell 里执行命令
run_with() {
  plt="$1" model="$2"
  (
    getprop() {
      case "$1" in
        ro.board.platform) echo "$plt" ;;
        ro.soc.model)      echo "$model" ;;
        *)                 echo "" ;;
      esac
    }
    . "$COMMON"
    eval "$3"
  )
}

echo "=== is_supported_soc: 4 种骁龙机型应放行 ==="
check "pineapple + SM8650"  "$(run_with pineapple SM8650  'is_supported_soc && echo yes || echo no')" "yes"
check "sun + SM8750"        "$(run_with sun      SM8750  'is_supported_soc && echo yes || echo no')" "yes"
check "canoe + SM8845"      "$(run_with canoe    SM8845  'is_supported_soc && echo yes || echo no')" "yes"
check "canoe + SM8850"      "$(run_with canoe    SM8850  'is_supported_soc && echo yes || echo no')" "yes"

echo "=== 天玑 / 未知 / 空属性应拒绝 ==="
check "mt6899 + MT6899 (红米Turbo4)" "$(run_with mt6899 MT6899 'is_supported_soc && echo yes || echo no')" "no"
check "mt6985 + MT6985"              "$(run_with mt6985 MT6985 'is_supported_soc && echo yes || echo no')" "no"
check "空 + 空"                       "$(run_with '' ''         'is_supported_soc && echo yes || echo no')" "no"
check "pineapple + MT6899 (平台优先)"  "$(run_with pineapple MT6899 'is_supported_soc && echo yes || echo no')" "yes"

echo "=== get_soc_dir: 未知机型返回空 (不再默认发 8gen3 模板) ==="
check "mt6899 => 空"   "$(run_with mt6899 MT6899 'get_soc_dir')" ""
check "空 => 空"        "$(run_with '' ''         'get_soc_dir')" ""
check "pineapple => 8gen3"        "$(run_with pineapple SM8650 'get_soc_dir')" "8gen3"
check "sun => 8elite"             "$(run_with sun SM8750 'get_soc_dir')" "8elite"
check "canoe+SM8845 => 8gen5"     "$(run_with canoe SM8845 'get_soc_dir')" "8gen5"
check "canoe+SM8850 => 8elitegen5" "$(run_with canoe SM8850 'get_soc_dir')" "8elitegen5"

echo
echo "结果: 通过 $PASS, 失败 $FAIL"
[ "$FAIL" -eq 0 ]
