#!/system/bin/sh

MODPATH="${0%/*/*}"
LOG_DIR="$MODPATH/log"
LOG_FILE="$LOG_DIR/pkg.log"

mkdir -p "$LOG_DIR"
. "${0%/*}/common.sh"

SOC_DIR=$(get_soc_dir)
CCCF_DIR="$MODPATH/cccf"
BACK_DIR="$CCCF_DIR"

log "=== 包名匹配开始 ==="
log "模板目录: $BACK_DIR"
log "输出目录: $CCCF_DIR"

mkdir -p "$CCCF_DIR"

# 已安装列表: 与 cosa 共用同一份 120 秒缓存 (pm list 真机约 100ms, 开机时 pkg_matcher 与
# cosa sync/localize 都要问一次; 谁先算谁写, 后到的直接读文件)
PKGS_CACHE="$LOG_DIR/.installed.lst"
installed_pkgs=""
if [ -f "$PKGS_CACHE" ] && [ -z "$(find "$PKGS_CACHE" -mmin +2 2>/dev/null)" ]; then
  installed_pkgs=$(cat "$PKGS_CACHE" 2>/dev/null)
fi
if [ -z "$installed_pkgs" ]; then
  installed_pkgs=$(pm list packages -3 2>/dev/null | grep '^package:' | sed 's/^package://')
  [ -n "$installed_pkgs" ] && printf '%s\n' $installed_pkgs > "$PKGS_CACHE" 2>/dev/null
fi
[ -z "$installed_pkgs" ] && { log "错误: 无法获取已安装包列表"; echo "  ! 无法获取已安装应用列表"; exit 1; }

rule_pkgs=""
rule_count=0
for json_file in "$BACK_DIR"/*.json "$BACK_DIR"/*.enc; do
  # 全部走 shell 内建: 真机实测一次 basename/grep 要 11~22ms, 冷启动路径上省下来的都是秒
  [ -f "$json_file" ] || continue
  b="${json_file##*/}"; rule_pkgs="$rule_pkgs ${b%.*}"; rule_count=$((rule_count + 1))
done
if [ -z "$rule_pkgs" ]; then
  log "错误: 云控模板缺失 ($BACK_DIR), 跳过匹配, 请重新安装模块"
  echo "  ! 云控模板缺失, 请重新安装模块"
  exit 1
fi
# 按长度降序, 优先最长模板 (避免短前缀误配)
rule_pkgs_sorted=$(for t in $rule_pkgs; do echo "$t"; done | awk '{print length, $0}' | sort -rn | sed 's/^[0-9]* //')
log "加载规则模板: $rule_count 个"

# 白名单兜底 (变体匹配未命中时生效): 渠道服包名 → 官服模板, 用户可编辑 scripts/whitelist.conf
WL_CONF="${0%/*}/whitelist.conf"
if [ -f "$WL_CONF" ]; then
  WHITELIST_MAP=$(grep -v '^#' "$WL_CONF" 2>/dev/null | grep -v '^[[:space:]]*$')
fi
# 内置兜底 (whitelist.conf 缺失时使用)
[ -z "$WHITELIST_MAP" ] && WHITELIST_MAP="\
com.miHoYo.yuanshencb:com.miHoYo.Yuanshen \
com.miHoYo.GenshinImpact:com.miHoYo.Yuanshen \
com.miHoYo.ys.bilibili:com.miHoYo.Yuanshen \
com.HoYoverse.hkrpgoversea:com.miHoYo.hkrpg \
com.miHoYo.NapCb:com.miHoYo.Nap \
com.HoYoverse.Nap:com.miHoYo.Nap \
com.garena.game.codm:com.tencent.tmgp.cod \
com.tencent.tmgp.sgamece:com.tencent.tmgp.sgame \
com.levelinfinite.sgameGlobal.midaspay:com.tencent.tmgp.sgame \
com.proximabeta.mf.uamo:com.tencent.mf.uam \
com.tencent.ig:com.pubg.imobile \
com.pubg.krmobile:com.pubg.imobile \
com.vng.pubgmobile:com.pubg.imobile \
com.rekoo.pubgm:com.pubg.imobile \
com.tencent.tmgp.yongyong.mrzh:com.netease.mrzh \
com.garena.game.df:com.tencent.tmgp.dfm \
com.tencent.tmgp.bairimeng.dmmdzz:com.bairimeng.dmmdzz"

adapt_json() {
  local src_pkg="$1"
  local dst_pkg="$2"
  local src_json="$BACK_DIR/${src_pkg}.json"
  local dst_json="$CCCF_DIR/${dst_pkg}.json"
  local official_json="$CCCF_DIR/${src_pkg}.json"
  [ -f "$src_json" ] || return 1
  local copied=1
  if [ ! -f "$official_json" ]; then
    cp "$src_json" "$official_json" && chmod 777 "$official_json" && { log "官服: $src_pkg"; copied=0; }
  fi
  if [ ! -f "$dst_json" ]; then
    sed "s/\"package_name\": \"$src_pkg\"/\"package_name\": \"$dst_pkg\"/" "$src_json" > "$dst_json" \
      && chmod 777 "$dst_json" && { log "适配: $src_pkg → $dst_pkg"; copied=0; }
  fi
  return $copied   # 0=实际写入 (调用方据此计数)
}

# 成员判断走内建 case (在含首尾分隔符的串里找 "|包名|"): 原来的 echo|grep 每次两个进程,
# 而规则 10 条 + 白名单 17 条就是 54 个进程 ≈ 1 秒 —— 这是这条路径真正的开销
INSTALLED_PIPED="|"
for _ip in $installed_pkgs; do INSTALLED_PIPED="$INSTALLED_PIPED$_ip|"; done
pkg_in_list() { case "$INSTALLED_PIPED" in *"|$1|"*) return 0 ;; esac; return 1; }

match_count=0

# ── 1. 官服精确 + 前缀变体匹配 ──
for rule_pkg in $rule_pkgs_sorted; do
  if pkg_in_list "$rule_pkg"; then
    if [ -f "$BACK_DIR/${rule_pkg}.json" ]; then
      dst_file="$CCCF_DIR/${rule_pkg}.json"
      if [ ! -f "$dst_file" ]; then
        cp "$BACK_DIR/${rule_pkg}.json" "$dst_file"
        chmod 777 "$dst_file"
        match_count=$((match_count + 1))
        log "匹配: $rule_pkg"
      fi
    elif [ -f "$BACK_DIR/${rule_pkg}.enc" ]; then
      dst_file="$CCCF_DIR/${rule_pkg}.enc"
      if [ ! -f "$dst_file" ]; then
        cp "$BACK_DIR/${rule_pkg}.enc" "$dst_file"
        chmod 777 "$dst_file"
        match_count=$((match_count + 1))
        log "匹配(enc): $rule_pkg"
      fi
    fi
  fi
  # 变体匹配: 仅 json 模板 (enc 无法改写包名)
  [ -f "$BACK_DIR/${rule_pkg}.json" ] || continue
  for pkg in $installed_pkgs; do
    [ -z "$pkg" ] && continue
    [ "$pkg" = "$rule_pkg" ] && continue
    case "$pkg" in
      "${rule_pkg}"*)
        if adapt_json "$rule_pkg" "$pkg"; then
          match_count=$((match_count + 1))
          log "变体匹配: $rule_pkg → $pkg"
        fi ;;
    esac
  done
done

# ── 2. 白名单兜底 ──
for entry in $WHITELIST_MAP; do
  channel="${entry%%:*}"
  official="${entry#*:}"
  pkg_in_list "$channel" && [ ! -f "$CCCF_DIR/${channel}.json" ] && {
    if adapt_json "$official" "$channel"; then
      match_count=$((match_count + 1))
      log "白名单兜底: $official → $channel"
    fi
  }
done

log "匹配完成: 新增 $match_count"
total_json=0
for _f in "$CCCF_DIR"/*.json; do [ -f "$_f" ] && total_json=$((total_json + 1)); done
log "cccf目录共 $total_json 个配置文件"
if [ "$total_json" -eq 0 ]; then
  echo "  ! 未检测到已安装的受支持游戏"
fi
log "=== 包名匹配结束 ==="