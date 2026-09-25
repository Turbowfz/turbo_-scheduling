#!/system/bin/sh

MODE="${1:-inject}"
MODPATH="${2:-}"
[ -z "$MODPATH" ] && MODPATH=$(cd "${0%/*}/.." 2>/dev/null && pwd)

CCCF_DIR="$MODPATH/cccf"
ENC_RUN="$MODPATH/encrypted_oplus-config"
INJECT="$MODPATH/bin/inject"
LOG_DIR="$MODPATH/log"
LOG_FILE="$LOG_DIR/cloud.log"

mkdir -p "$LOG_DIR"
. "${0%/*}/common.sh"

inject_configs() {
  log "=== 注入模式开始 ==="
  # 注入失败标记: enc 兜底失败不再直接 return —— json 部分已经写好了, 必须继续走到
  # 收尾 localize 与 COSA 重启 (否则失败的兜底会把已生效的 json 配置一起晾着)
  INJECT_FAILED=0

  # 并发锁 (开机后台与手动注入互斥); 陈旧锁超10分钟接管
  LOCK_DIR="$LOG_DIR/.inject.lock"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
      rm -rf "$LOCK_DIR" 2>/dev/null
      mkdir "$LOCK_DIR" 2>/dev/null
    fi
    if [ ! -d "$LOCK_DIR" ]; then
      echo "  ! 另一个云控注入正在进行, 本次跳过"
      log "并发注入拦截 (锁存在且未过期)"
      return 1
    fi
  fi
  trap 'rm -rf "$LOCK_DIR" 2>/dev/null' EXIT

  rm -rf "$ENC_RUN" 2>/dev/null

  DB=$(find_db)
  [ -z "$DB" ] && { echo "! 未找到数据库"; log "错误: 未找到数据库"; return 1; }
  log "数据库: $DB"

  [ -d "$CCCF_DIR" ] || { echo "! cccf目录缺失"; log "错误: cccf目录缺失"; return 1; }
  # 计数与"装没装"的判断全用 shell 内建: 真机上一个外部进程 11~22ms (ls|wc 就是两个)
  json_count=0
  for _f in "$CCCF_DIR"/*.json; do [ -f "$_f" ] && json_count=$((json_count + 1)); done
  enc_count=0
  for _f in "$CCCF_DIR"/*.enc; do [ -f "$_f" ] && enc_count=$((enc_count + 1)); done
  [ "$json_count" -eq 0 ] && [ "$enc_count" -eq 0 ] && { echo "  ! cccf 为空, 未检测到支持的游戏"; log "cccf目录为空"; return 1; }
  log "待注入: $json_count 个 json + $enc_count 个 enc"

  # enc 组的"已安装"过滤 (json 由 cosa sync 内部过滤): 列表按需取 —— 模块不带 .enc,
  # 平时白付一次 pm list (~100ms); 成员判断用内建 case, 不再每次 echo|grep
  installed_piped=""
  load_installed() {
    [ -n "$installed_piped" ] && return 0
    local lc p
    lc=$(pm list packages -3 2>/dev/null | sed 's/^package://' | tr 'A-Z' 'a-z')
    if [ -z "$lc" ]; then
      log "警告: 无法获取已安装应用列表, enc 组不按已安装性过滤"
      return 0
    fi
    installed_piped="|"
    for p in $lc; do installed_piped="$installed_piped$p|"; done
  }
  pkg_installed() {
    [ -z "$installed_piped" ] && return 0
    local lc_pkg
    lc_pkg=$(echo "$1" | tr 'A-Z' 'a-z')
    case "$installed_piped" in *"|$lc_pkg|"*) return 0 ;; esac
    return 1
  }
  [ "$enc_count" -gt 0 ] && load_installed

  # 注入器执行: 成功=退出码0且无Error; "未获取到第三方应用"重试; 其余错误快速失败。
  # 保护只在真正调注入器的那一瞬间撤掉 (它要插行, 我们的 insert 触发器会拦), 进程一返回立刻重新武装 ——
  # 否则失败重试的 30 秒等待期间库是裸的, 云端可以趁机把服务器行插进来
  run_inject() {
    local tries=0
    local out=""
    local rc=0
    while [ $tries -lt 5 ]; do
      LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" unprotect >/dev/null 2>&1
      out=$(LD_LIBRARY_PATH="$MODPATH/bin" "$INJECT" 2>&1)
      rc=$?
      LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" protect >/dev/null 2>&1
      if [ "$rc" -eq 0 ] && ! echo "$out" | grep -qi "error"; then
        echo "$out"
        return 0
      fi
      if echo "$out" | grep -q "未获取到第三方应用"; then
        echo "$out" | tail -2
        echo "  ! 注入器未就绪 (第三方应用列表为空), 30秒后重试 ($((tries + 1))/5)..."
        log "注入器未就绪, 30秒后重试 ($((tries + 1))/5)"
        tries=$((tries + 1))
        sleep 30
        continue
      fi
      echo "$out"
      log "注入器失败 (rc=$rc): $(echo "$out" | tail -2)"
      return 1
    done
    echo "$out"
    return 1
  }

  # ── 1. .json 组 (优先): 走 cosa 工具 (rusqlite 直连, 自动 from_server=0 + 三联保护 + WAL 收尾) ──
  if [ "$json_count" -gt 0 ]; then
    echo ""
    echo "── 注入 .json ($json_count 个) ──"
    COSA_OUT=$(LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" sync "$CCCF_DIR" 2>&1)
    COSA_RC=$?
    echo "$COSA_OUT"
    if [ "$COSA_RC" -eq 0 ]; then
      log "json 注入完成 ($json_count 个, cosa sync)"
    else
      log "错误: cosa sync 执行失败 (rc=$COSA_RC): $(echo "$COSA_OUT" | tail -2)"
      INJECT_FAILED=1
    fi
  fi

  # ── 2. .enc 组 (兜底, 仅无同名 json 的): bin/inject 解密 (注入器自带解密) ──
  local enc_pick=0
  for enc in "$CCCF_DIR"/*.enc; do
    [ -f "$enc" ] || continue
    pkg="${enc##*/}"; pkg="${pkg%.enc}"
    if [ ! -f "$CCCF_DIR/$pkg.json" ] && pkg_installed "$pkg"; then
      enc_pick=$((enc_pick + 1))
    fi
  done
  if [ "$enc_pick" -gt 0 ]; then
    rm -rf "$ENC_RUN" 2>/dev/null
    mkdir -p "$ENC_RUN"
    for enc in "$CCCF_DIR"/*.enc; do
      [ -f "$enc" ] || continue
      pkg="${enc##*/}"; pkg="${pkg%.enc}"
      if [ ! -f "$CCCF_DIR/$pkg.json" ] && pkg_installed "$pkg"; then
        cp -f "$enc" "$ENC_RUN/" 2>/dev/null
      fi
    done
    echo ""
    echo "── 注入 .enc ($enc_pick 个) ──"
    # 注入器 (第三方闭源) 写的是 from_server=1 的服务器行, 且它自己会装一套旧版弱触发器 →
    # 注入成功后必须立刻 localize: 标回 from_server=0 + 校验落库 + 重装我们的新语义触发器
    if run_inject; then
      LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" localize "$CCCF_DIR" 2>&1 | sed 's/^/  /'
      log "enc 注入完成 ($enc_pick 个, 已标回本地)"
    else
      log "错误: inject (enc) 执行失败"
      INJECT_FAILED=1
    fi
  else
    log "enc: 无兜底 (全部已有 json 覆盖)"
  fi
  echo ""

  rm -rf "$ENC_RUN" 2>/dev/null

  # 收尾: cccf 里所有包的行统一标回 from_server=0 (json 路径本来就是 0, 这里兜注入器写进来的
  # 服务器标记行) + 校验 + 重新武装保护 (幂等, 顺带覆盖注入器装的旧版弱触发器)
  LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" localize "$CCCF_DIR" 2>&1 | sed 's/^/  /'

  # 重启 COSA 强制重读 DB (服务四件套对齐 start_official)
  setprop persist.sys.oplus.gameswitch.enable 0
  sleep 1
  killall com.oplus.cosa 2>/dev/null
  sleep 2
  setprop persist.sys.oplus.gameswitch.enable 1
  start gameopt_hal_service-1-0 2>/dev/null
  start vendor.urcc-hal-aidl 2>/dev/null
  start oiface 2>/dev/null
  start horae 2>/dev/null

  log "=== 注入模式结束 ==="
  return "$INJECT_FAILED"
}

setup_mode() {
  log "=== 安装模式开始 ==="

  if ! is_oplus; then
    echo "  ! 未检测到 scx/hmbird 调速器"
    echo "    云控注入需要风驰游戏内核或 GKI 内核支持"
    rm -f "$SCRC_DIR/rc_installed"
    log "错误: 缺少 scx/hmbird 调速器, 安装中止"
    return 1
  fi
  log "调速器检查通过 (scx/hmbird)"
  echo ""
  echo "  ┌──────────────────────────────┐"
  echo "  │      风驰游戏内核使用说明     │"
  echo "  ├──────────────────────────────┤"
  echo "  │ 1. 确保 oiface, gameopt,     │"
  echo "  │    urcc 相关组件存活          │"
  echo "  │ 2. 确保风驰存活后刷入        │"
  echo "  │    群文件调度及风驰文件      │"
  echo "  │ 3. 进入游戏打开 Scene 查看   │"
  echo "  │    调速器是否为 scx          │"
  echo "  └──────────────────────────────┘"

  DB=$(find_db)
  if [ -z "$DB" ]; then
    echo "  ! 未找到应用增强服务数据库"
    echo "    请确保:"
    echo "    1. 已启用游戏助手和应用增强服务"
    echo "    2. 至少打开过一次游戏中心"
    rm -f "$SCRC_DIR/rc_installed"
    log "错误: 未找到DB, 安装失败"
    return 1
  fi

  DB_SIZE=$(du -sh "$DB" | awk '{print $1}')
  echo "  + 数据库已就绪 ($DB_SIZE)"
  log "数据库就绪: $DB ($DB_SIZE)"

  mkdir -p "$SCRC_DIR"
  touch "$SCRC_DIR/rc_installed"

  start_official
  enable_cosa_services
  echo "  + 官方调度组件已就绪"

  # 关闭用户体验计划, 防止云控配置被重置
  settings put system oplus_customize_cta_user_experience 0 2>/dev/null
  echo "  + 已关闭用户体验计划"
  log "已关闭用户体验计划 (oplus_customize_cta_user_experience=0)"

  echo "  - 匹配已安装游戏..."
  # cccf 未就位时从机型模板补齐
  soc_dir=$(get_soc_dir)
  if [ -z "$(ls "$CCCF_DIR"/*.json 2>/dev/null)" ] && [ -d "$MODPATH/$soc_dir/oplus_cccf" ]; then
    mkdir -p "$CCCF_DIR"
    cp -af "$MODPATH/$soc_dir/oplus_cccf/." "$CCCF_DIR/" 2>/dev/null
    log "云控模板补齐: $soc_dir/oplus_cccf → cccf"
  fi
  sh "$MODPATH/scripts/pkg_matcher.sh"
  echo "  + 云控注入安装完成，重启后生效"
  log "安装完成"
  log "=== 安装模式结束 ==="
  return 0
}

case "$MODE" in
  setup)
    setup_mode
    ;;
  inject)
    inject_configs
    ;;
  *)
    echo "用法: $0 {setup|inject} [MODPATH]"
    exit 1
    ;;
esac