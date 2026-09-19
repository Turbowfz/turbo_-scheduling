#!/system/bin/sh

MODDIR="${0%/*}"
SCRIPTS_DIR="$MODDIR/scripts"
LOG_DIR="$MODDIR/log"
LOG_FILE="$LOG_DIR/boot.log"

mkdir -p "$LOG_DIR"
. "$SCRIPTS_DIR/common.sh"

# ── 日志清空: 每次开机重新开始记录 (重启后日志为空) ──
log_reset "$LOG_DIR"

# ── bin 执行位自愈 (个别安装器环境 chmod 不残留, 缺执行位时 root 也无法 exec) ──
chmod 777 "$MODDIR/bin/inject" 2>/dev/null; chmod 755 "$MODDIR/bin/cosa" 2>/dev/null

# ── description 开机自愈: 安装时的 sed 改的是解包临时目录, 会被 KSU 用 zip 原始
#    module.prop 覆盖 (永远显示"重启后生效")。每次开机按标志文件刷新一次 ──
update_description() {
  local desc
  if [ -f "$SCRC_DIR/rc_installed" ] && [ -f "$SCRC_DIR/sc_installed" ]; then
    desc="云控注入 + 二改调度($(cat "$SCRC_DIR/config_type" 2>/dev/null))"
  elif [ -f "$SCRC_DIR/rc_installed" ]; then
    desc="云控注入"
  elif [ -f "$SCRC_DIR/sc_installed" ]; then
    desc="二改调度($(cat "$SCRC_DIR/config_type" 2>/dev/null))"
  else
    desc="无任何功能，建议卸载"
  fi
  sed -i "s/^description=.*/description=$desc/" "$MODDIR/module.prop" 2>/dev/null
}
update_description

# 等待开机完成 + CE 解锁 (数据目录可读)。
# 注意: 手机重启后一直锁屏时 CE 要到首次解锁才就绪 (sys.user.0.ce_available 之前为 false) —
# 上限给到 30 分钟, 否则用户"重启就揣兜里"的场景会直接放弃部署与注入, 且本开机不再重试。
wait_boot_ready() {
  w=0
  while [ "$(getprop sys.boot_completed)" != "1" ] && [ "$w" -lt 600 ]; do sleep 1; w=$((w + 1)); done
  w=0
  while [ "$w" -lt 1800 ]; do
    [ "$(getprop sys.user.0.ce_available)" = "true" ] && return 0
    if [ -d "$VT_FILES" ] || [ -d /data/data/com.oplus.cosa ]; then return 0; fi   # 目录可读 = 已解锁
    sleep 5; w=$((w + 5))
  done
  log "[等待] CE解锁超时 (30分钟), 仍继续尝试"
}

log "========================================="
log "Turbo调度 开机服务启动"

# ── Scene 调度 ──
if [ -f "$SCRC_DIR/sc_installed" ]; then
  config_type=$(cat "$SCRC_DIR/config_type" 2>/dev/null)

  log "[Scene] 等待开机完成... (类型: $config_type)"
  wait_boot_ready
  prepare_scene_dir 60 || log "[Scene] 警告: 目录未就绪, 仍尝试部署"
  sleep 5
  log "[Scene] 目录就绪, 开始部署"
  sh "$SCRIPTS_DIR/scene_config.sh" deploy

  # 等 Scene 进程起来 (最多120s) 再动官方调度, 避免与 Scene 启动交叉; 起来后留 5s 读配置
  _sw=0
  while ! pidof com.omarea.vtools >/dev/null 2>&1 && [ "$_sw" -lt 120 ]; do
    sleep 2; _sw=$((_sw + 2))
  done
  [ "$_sw" -ge 120 ] && log "[Scene] 等待Scene进程超时 (120s), 按原计划继续"
  sleep 5
  if [ "$config_type" = "generic" ]; then
    log "[Scene] 通用版: 停止官方调度服务"
    stop_official
  else
    log "[Scene] oplus版: 保持官方调度服务"
    start_official
  fi

  log "[Scene] 加固 executor 权限"
  sed -i 's/chmod 755 "$script_path"/chmod 777 "$script_path"/g' "$VT_FILES/kr-script/executor.sh" 2>/dev/null
  chmod 555 "$VT_FILES/kr-script/executor.sh" 2>/dev/null
  chmod 777 "$VT_FILES/kr-script/cache" 2>/dev/null
  find "$VT_FILES/kr-script/cache" -type f -exec chmod 777 {} + 2>/dev/null
  find "$VT_FILES/kr-script/cache" -type d -exec chmod 777 {} + 2>/dev/null

  log "[Scene] 初始化完成"
fi

# ── 云控注入 ──
if [ -f "$SCRC_DIR/rc_installed" ]; then
  log "[云控] 后台服务启动"

  {
    echo "[$(date '+%m-%d %T')] 云控服务启动"
    wait_boot_ready
    start_official   # 开机未完成时 start 可能失败, 放在 wait 之后

    # DB 就绪即匹配+注入 (最长等 30 分钟: 手机重启后一直锁屏时数据库要到解锁后才可读,
    # 上限太短会静默放弃本次注入; 轮询 10 秒一次, 每 2 分钟记录一条进度避免刷屏)
    MAX_WAIT=1800
    WAIT_INTERVAL=10
    elapsed=0
    found=0

    while [ $elapsed -lt $MAX_WAIT ]; do
      DB=$(find_db)
      if [ -n "$DB" ]; then
        echo "[$(date '+%m-%d %T')] 数据库就绪: $DB"
        sleep 10
        echo "[$(date '+%m-%d %T')] 执行包名匹配..."
        sh "$SCRIPTS_DIR/pkg_matcher.sh"
        echo "[$(date '+%m-%d %T')] 开始注入..."
        sh "$SCRIPTS_DIR/cloud_ctrl.sh" inject
        echo "[$(date '+%m-%d %T')] 注入完成 (新版工具自带保护触发器, 无需守护)"
        found=1
        break
      fi
      sleep $WAIT_INTERVAL
      elapsed=$((elapsed + WAIT_INTERVAL))
      [ $((elapsed % 120)) -eq 0 ] && echo "[$(date '+%m-%d %T')] 等待数据库 (未解锁时不可读)... ${elapsed}s"
    done

    # 仅在真正超时 (未找到数据库) 时输出错误, 注入成功不再误报
    [ "$found" = "0" ] && echo "[$(date '+%m-%d %T')] 错误: 超时未找到数据库"
  } >> "$LOG_FILE" 2>&1 &
fi

log "========================================="
