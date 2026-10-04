#!/system/bin/sh
# ═══════════════════════════════════════════════
#  Turbo调度 · 公共函数库 (被其他脚本 source)
# ═══════════════════════════════════════════════

FLAG_DIR="/data/adb/turbo"
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

# ── Scene 配置备份范围: 只碰配置文件 ──
# 只处理 json / sh / conf (扩展名不分大小写, 覆盖 .conf 与 .CONF)。
# Scene 目录下的其它数据文件 (缓存/数据库/素材/日志等) 与本模块无关 ——
# 备份它们既臃肿, 还原时还可能把用户数据覆盖回去, 所以一律不碰。
# 用 find 递归: files/ 下的子目录同样按扩展名筛选, 相对路径原样保留。
scene_cfg_list() {   # $1=目录; 输出匹配文件的完整路径
  [ -d "$1" ] || return 0
  find "$1" -type f \( -iname '*.json' -o -iname '*.sh' -o -iname '*.conf' \) 2>/dev/null
}

scene_cfg_copy() {   # $1=源目录 $2=目标目录 (cp -af 原样保留属主/上下文/权限, 还原时一字不差)
  local src="$1" dst="$2" f rel
  [ -d "$src" ] || return 0
  mkdir -p "$dst" 2>/dev/null
  scene_cfg_list "$src" | while IFS= read -r f; do
    rel="${f#"$src"/}"
    case "$rel" in */*) mkdir -p "$dst/${rel%/*}" 2>/dev/null ;; esac
    cp -af "$f" "$dst/$rel" 2>/dev/null
  done
}

scene_cfg_prune() {  # $1=备份目录; 删掉备份里不属于配置类的文件 (老版本备份了整个目录, 迁移用)
  local dir="$1" before after f d
  [ -d "$dir" ] || return 0
  before=$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')
  find "$dir" -type f ! \( -iname '*.json' -o -iname '*.sh' -o -iname '*.conf' \) 2>/dev/null | while IFS= read -r f; do
    rm -f "$f" 2>/dev/null
  done
  # 清掉因此变空的子目录 (-depth: 先深后浅, 嵌套空目录也能清干净)
  find "$dir" -mindepth 1 -depth -type d 2>/dev/null | while IFS= read -r d; do rmdir "$d" 2>/dev/null; done
  after=$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')
  [ "${before:-0}" -gt "${after:-0}" ] && log "已清理备份中非配置文件 $((before - after)) 个 (只保留 json/sh/conf)"
  return 0
}

# ── Scene 备份还原 (返回0=成功可清理, 1=失败必须保留备份) ──
restore_scene_now() {
  [ -f "$FLAG_DIR/sc_installed" ] || return 0
  log "还原Scene配置 (强制切回软件自带调度)"
  am force-stop com.omarea.vtools 2>/dev/null
  prepare_scene_dir 30 || return 1
  if [ -d "$FLAG_DIR/backup" ]; then
    # 只还原配置类文件 (json/sh/conf): 备份里没有的东西一律不动 (不覆盖用户数据)
    scene_cfg_copy "$FLAG_DIR/backup" "$VT_FILES"
    # 校验: 备份里的每个配置文件都要回到目标目录 (逐条比对, 不看总数 —— 目标目录本来就有别的文件)
    local bf rel miss=0 list="$FLAG_DIR/.restore_list"
    scene_cfg_list "$FLAG_DIR/backup" > "$list" 2>/dev/null
    while IFS= read -r bf; do
      [ -n "$bf" ] || continue
      rel="${bf#"$FLAG_DIR/backup"/}"
      [ -f "$VT_FILES/$rel" ] || miss=$((miss + 1))
    done < "$list"
    rm -f "$list" 2>/dev/null
    [ "$miss" = "0" ] || { log "错误: 还原失败 (备份未生效, 缺 $miss 个文件), 已保留备份"; return 1; }
  fi
  start_official
  return 0
}

# ── 支持的 SoC (骁龙 8 Gen3 / 8 Elite / 8 Gen5 / 8 Elite Gen5) ──
# 全模块唯一的机型匹配清单: 安装器 validate_soc 的兜底裁决、开机门禁都用它。
# 新增支持机型时只改这里 (platform 三选一, 或 soc.model 含对应数字段)。
is_supported_soc() {
  local p=$(getprop ro.board.platform)
  local m=$(getprop ro.soc.model)
  case "$p" in
    pineapple|sun|canoe) return 0 ;;
  esac
  case "$m" in
    *8650*|*8750*|*8845*|*8850*) return 0 ;;
  esac
  return 1
}

# ── SoC 机型目录 (8gen3 / 8elite / 8gen5 / 8elitegen5) ──
# 未知机型返回空串: 调用方按空处理 (不部署模板), 不再默认发 8gen3
get_soc_dir() {
  is_supported_soc || return 0
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

# ── 官方调度服务 (orms 仅停止时管) ──
start_official() {
  log "恢复官方调度服务"
  setprop persist.sys.oiface.enable 1
  setprop persist.sys.oplus.gameswitch.enable 1
  start oiface 2>/dev/null
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
