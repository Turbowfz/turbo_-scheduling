#!/system/bin/sh
# ═══════════════════════════════════════════════
#  Turbo调度 · 公共函数库 (被其他脚本 source)
# ═══════════════════════════════════════════════

SCRC_DIR="/data/adb/turbo"
VT_FILES="/data/data/com.omarea.vtools/files"

# 调速器节点: 原来在 source 时就用 ls|head 探一次 (每次 source 白付两个进程 ≈ 22ms,
# 而绝大多数脚本根本不问 是不是风驰内核) → 改成问的时候才找, 且用 shell 通配符不 fork
gov_path() {
  local g
  for g in /sys/devices/system/cpu/cpufreq/policy*/scaling_available_governors; do
    [ -f "$g" ] && { echo "$g"; return 0; }
  done
  return 1
}

log() {
  echo "[$(date '+%m-%d %T')] $1" >> "${LOG_FILE:-/dev/null}"
}

# 开机清空历史日志: 每一次开机的记录独立, 重启后日志从空开始 (顺带清理残留 .tmp)
log_reset() {
  local dir="$1" lf
  [ -d "$dir" ] || return 0
  for lf in "$dir"/*.log; do
    [ -f "$lf" ] || continue
    : > "$lf" 2>/dev/null
  done
  rm -f "$dir"/*.tmp 2>/dev/null
}

# ── Scene 目录等待+解锁 (开机早期目录可能未建, 每轮尝试 mkdir) ──
prepare_scene_dir() {
  local timeout="${1:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    mkdir -p "$VT_FILES" 2>/dev/null
    [ -d "$VT_FILES" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  [ -d "$VT_FILES" ] || { log "等待Scene目录超时 (${timeout}s)"; return 1; }
  chmod 777 "$VT_FILES" 2>/dev/null
  log "Scene目录就绪 (等待${waited}s)"
  return 0
}

# ── Scene 备份还原 (返回0=成功可清理, 1=失败必须保留备份) ──
restore_scene_now() {
  [ -f "$SCRC_DIR/sc_installed" ] || return 0
  log "还原Scene配置 (强制切回软件自带调度)"
  am force-stop com.omarea.vtools 2>/dev/null
  prepare_scene_dir 30 || return 1
  if [ -d "$SCRC_DIR/backup" ]; then
    # cp -af 原样保留备份里的属主/上下文/权限; 全目录 chmod 会摸 ctime 触发热加载
    cp -af "$SCRC_DIR/backup/." "$VT_FILES/" 2>/dev/null
    local bf ok=1
    for bf in "$SCRC_DIR/backup"/*.json; do
      [ -f "$bf" ] || continue
      [ -f "$VT_FILES/${bf##*/}" ] || ok=0
    done
    [ "$ok" = "1" ] || { log "错误: 还原失败 (备份未生效), 已保留备份"; return 1; }
  fi
  start_official
  return 0
}

# ── SoC 机型目录 (8gen3 / 8elite / 8gen5 / 8elitegen5) ──
get_soc_dir() {
  local p=$(getprop ro.board.platform)
  local m=$(getprop ro.soc.model)
  case "$p" in
    sun)        echo "8elite" ;;
    pineapple)  echo "8gen3" ;;
    canoe)      case "$m" in
                  *8850*) echo "8elitegen5" ;;
                  *)      echo "8gen5" ;;
                esac ;;
    *) case "$m" in
         *8750*)   echo "8elite" ;;
         *8850*)   echo "8elitegen5" ;;
         *8845*)   echo "8gen5" ;;
         *)        echo "8gen3" ;;
       esac ;;
  esac
}

# ── 8 Gen5 系列 (SM8845/SM8850/canoe) 判定: oplus版目录暂无其配置, 仅用于提示分支 ──
is_8gen5() {
  local p=$(getprop ro.board.platform)
  local m=$(getprop ro.soc.model)
  case "$p" in
    canoe) return 0 ;;
    *) case "$m" in
         *8845*|*8850*) return 0 ;;
         *) return 1 ;;
       esac ;;
  esac
}

# ── 是否支持风驰 (调速器含 scx/hmbird 即可, 不按 SoC 排除) ──
is_oplus() {
  local gp
  gp=$(gov_path) || return 1
  grep -qEw "scx|hmbird" "$gp"
}

# ── 音量键 ──

get_key() {
  (timeout 3 getevent -lqc 1) 2>/dev/null | grep -E 'KEY_VOLUMEUP.*DOWN|KEY_VOLUMEDOWN.*DOWN' | awk '{print $3}' | head -n1
}

# wait_key [超时秒] [超时默认值]: 缺省无限等待; 超时默认值供无人值守刷入使用
wait_key() {
  local wk_timeout="${1:-}"
  local wk_default="${2:-}"
  local wk_start=$(date +%s)
  timeout 0.5 getevent >/dev/null 2>/dev/null
  while :; do
    if [ -n "$wk_timeout" ] && [ $(( $(date +%s) - wk_start )) -ge "$wk_timeout" ]; then
      echo "${wk_default:-timeout}"
      return
    fi
    key=$(get_key)
    [ -n "$key" ] && { echo "$key"; return; }
    sleep 0.1
  done
}

wait_key_timeout() {
  local timeout=$1
  local start=$(date +%s)
  timeout 0.5 getevent >/dev/null 2>/dev/null
  while :; do
    [ $(( $(date +%s) - start )) -ge $timeout ] && { echo "timeout"; return; }
    # getevent 必须带 timeout 包裹, 否则无按键时永久阻塞, 超时判断永远轮不到
    event=$(timeout 1 getevent -lqc 1 2>/dev/null | {
      while read -r line; do
        case "$line" in
          *KEY_VOLUMEDOWN*DOWN*) echo "down" && break ;;
          *KEY_VOLUMEUP*DOWN*) echo "up" && break ;;
        esac
      done
    })
    [ -n "$event" ] && { echo "$event"; return; }
  done
}

# ── 官方调度服务 (含 horae; orms 仅停止时管) ──
start_official() {
  log "恢复官方调度服务"
  setprop persist.sys.oiface.enable 1
  setprop persist.sys.oplus.gameswitch.enable 1
  setprop persist.sys.horae.enable 1
  start oiface 2>/dev/null
  start horae 2>/dev/null
  start gameopt_hal_service-1-0 2>/dev/null
  start vendor.urcc-hal-aidl 2>/dev/null
}

stop_official() {
  log "停止官方调度服务"
  setprop persist.sys.oiface.enable 0
  setprop persist.sys.oplus.gameswitch.enable 0
  stop oiface 2>/dev/null
  stop gameopt_hal_service-1-0 2>/dev/null
  stop vendor.urcc-hal-aidl 2>/dev/null
  stop vendor.oplus.ormsHalService-aidl-default 2>/dev/null
}

# 启用应用增强服务组件 (遍历列表, 输出统一吞)
COSA_SERVICES="\
com.oplus.cosa/com.oplus.cosa.gamemanagersdk.CosaHyperBoostService \
com.oplus.cosa/com.oplus.cosa.gpalibrary.service.GPAService \
com.oplus.cosa/com.oplus.cosa.gamemanagersdk.HyperBoostService \
com.oplus.appbooster/com.oplus.appbooster.service.OptimizeService \
com.oplus.appbooster/androidx.room.MultiInstanceInvalidationService \
com.oplus.cosa/com.oplus.cosa.feature.ScreenPerceptionService \
com.oplus.cosa/com.oplus.cosa.gamemanagersdk.CosaGameSdkService \
com.oplus.cosa/com.oplus.cosa.service.COSAService \
com.oplus.cosa/com.oplus.cosa.service.GameDaemonService \
com.oplus.cosa/androidx.room.MultiInstanceInvalidationService \
com.oplus.cosa/androidx.work.impl.foreground.SystemForegroundService \
com.oplus.cosa/androidx.work.impl.background.systemalarm.SystemAlarmService \
com.oplus.cosa/com.oplus.cosa.testlibrary.service.COSATesterService \
com.oplus.cosa/androidx.work.impl.background.systemjob.SystemJobService \
com.oplus.cosa/com.oplus.cosa.gamemanagersdk.CosaAMTService \
com.oplus.cosa/com.oplus.cosa.service.GameEventService"

enable_cosa_services() {
  local svc
  for svc in $COSA_SERVICES; do
    pm enable "$svc" >/dev/null 2>&1
  done
}

# ── 云控数据库 ──
find_db() {
  if [ -f "/data/data/com.oplus.cosa/databases/db_game_database" ]; then
    echo "/data/data/com.oplus.cosa/databases/db_game_database"
  elif [ -f "/data/user_de/0/com.oplus.cosa/databases/db_game_database" ]; then
    echo "/data/user_de/0/com.oplus.cosa/databases/db_game_database"
  fi
}
