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

  # 注入器执行: 成功=退出码0且输出无错误迹象; "未获取到第三方应用"按递进间隔重试 (5/10/20/30/30 秒, 最多 95 秒); 其余错误快速失败。
  # 保护只在真正调注入器那一瞬间撤掉 (它要插行, 会被我们的 insert 触发器拦), 进程一返回立刻重新武装, 不留裸奔窗口
  run_inject() {
    local tries=0
    local out=""
    local rc=0
    local wait_s=0
    while [ $tries -lt 5 ]; do
      LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" unprotect >/dev/null 2>&1
      out=$(LD_LIBRARY_PATH="$MODPATH/bin" "$INJECT" 2>&1)
      rc=$?
      LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" protect >/dev/null 2>&1
      # 成功判定: 退出码 0 且输出里没有错误迹象。真机实测注入器解密失败时**退出码仍是 0**,
      # 只在输出里打印中文"[失败] xxx (解密失败)" → 必须连中文"失败"一起判, 否则会把解密失败
      # 当成功上报 ("enc 注入完成" 但库里其实没有行)。
      # 注意: 两个词分开 grep —— `\|` 交替是 GNU 扩展, Android 的 toybox grep 不支持
      # (本地 Git Bash 能过、真机匹配不上的那种坑)
      if [ "$rc" -eq 0 ] && ! echo "$out" | grep -qi "error" && ! echo "$out" | grep -q "失败"; then
        echo "$out"
        return 0
      fi
      if echo "$out" | grep -q "未获取到第三方应用"; then
        echo "$out" | tail -2
        case $tries in 0) wait_s=5 ;; 1) wait_s=10 ;; 2) wait_s=20 ;; *) wait_s=30 ;; esac
        tries=$((tries + 1))
        echo "  ! 注入器未就绪 (第三方应用列表为空), ${wait_s}秒后重试 ($tries/5)..."
        log "注入器未就绪, ${wait_s}秒后重试 ($tries/5)"
        sleep $wait_s
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
  local enc_pick=0 enc_list=""
  for enc in "$CCCF_DIR"/*.enc; do
    [ -f "$enc" ] || continue
    pkg="${enc##*/}"; pkg="${pkg%.enc}"
    if [ ! -f "$CCCF_DIR/$pkg.json" ] && pkg_installed "$pkg"; then
      enc_pick=$((enc_pick + 1)); enc_list="$enc_list $pkg"
    fi
  done
  if [ "$enc_pick" -gt 0 ]; then
    # 前置检查: 注入器不可用 / 拿不到已安装列表时它必然失败 —— 与其白等最长 95 秒的重试,
    # 不如直接跳过并把原因说清楚 (这两种情况在真机日志里能一眼认出)
    if [ ! -x "$INJECT" ]; then
      echo "  ! 跳过 enc 注入: 注入器不可用 ($INJECT)"
      log "跳过 enc 注入: 注入器不可用"
      INJECT_FAILED=1
    elif [ -z "$installed_piped" ]; then
      echo "  ! 跳过 enc 注入: 拿不到已安装应用列表 (注入器同样会因此失败)"
      log "跳过 enc 注入: 无已安装应用列表"
      INJECT_FAILED=1
    else
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
      echo "── 注入 .enc ($enc_pick 个):$enc_list ──"
      # 跑之前清掉可能卡住的残留注入器 (上次注入中途死掉会留下它)
      pkill -f "$INJECT" 2>/dev/null
      # 注入器写的是服务器标记行且自带一套旧触发器 → 成功后立刻 localize: 标回 from_server=0 + 校验 + 重装触发器
      if run_inject; then
        LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" localize "$CCCF_DIR" 2>&1 | sed 's/^/  /'
        log "enc 注入完成 ($enc_pick 个, 已标回本地)"
      else
        log "错误: inject (enc) 执行失败"
        INJECT_FAILED=1
      fi
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

  log "=== 注入模式结束 ==="
  return "$INJECT_FAILED"
}

setup_mode() {
  log "=== 安装模式开始 ==="

  if ! is_oplus; then
    echo "  ! 未检测到 scx/hmbird 调速器"
    echo "    云控注入需要风驰游戏内核或 GKI 内核支持"
    rm -f "$FLAG_DIR/rc_installed"
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
    rm -f "$FLAG_DIR/rc_installed"
    log "错误: 未找到DB, 安装失败"
    return 1
  fi

  DB_SIZE=$(du -sh "$DB" | awk '{print $1}')
  echo "  + 数据库已就绪 ($DB_SIZE)"
  log "数据库就绪: $DB ($DB_SIZE)"

  mkdir -p "$FLAG_DIR"
  touch "$FLAG_DIR/rc_installed"

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
  if [ -z "$(ls "$CCCF_DIR"/*.json 2>/dev/null)" ] && [ -d "$MODPATH/soc/$soc_dir/oplus_cccf" ]; then
    mkdir -p "$CCCF_DIR"
    cp -af "$MODPATH/soc/$soc_dir/oplus_cccf/." "$CCCF_DIR/" 2>/dev/null
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