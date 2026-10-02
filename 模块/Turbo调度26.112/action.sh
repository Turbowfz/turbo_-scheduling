#!/system/bin/sh

MODDIR="${0%/*}"
SCRIPTS_DIR="$MODDIR/scripts"
LOG_DIR="$MODDIR/log"
LOG_FILE="$LOG_DIR/action.log"

mkdir -p "$LOG_DIR"
. "$SCRIPTS_DIR/common.sh"

if [ "$1" = "inject" ]; then
  # 直接注入: 先匹配渠道服, 显示文件格式, 再统一注入
  echo "- 匹配已安装游戏..."
  sh "$SCRIPTS_DIR/pkg_matcher.sh"
  json_n=$(ls "$MODDIR/cccf"/*.json 2>/dev/null | wc -l)
  enc_n=$(ls "$MODDIR/cccf"/*.enc 2>/dev/null | wc -l)
  echo "  待注入: $json_n 个 .json + $enc_n 个 .enc"
  exec sh "$SCRIPTS_DIR/cloud_ctrl.sh" inject
fi

fix_permissions() {
  TARGET_DIR="$VT_FILES"

  echo ""
  echo "=== 修复Scene文件权限 ==="

  [ "$(id -u)" -ne 0 ] && { echo "! 需要ROOT权限"; log "错误: 非root"; return 1; }
  [ ! -d "$TARGET_DIR" ] && { echo "! Scene目录不存在"; log "错误: 目录不存在"; return 1; }

  log "开始修复权限 (全部 777)"
  # 全部 777 (Scene 读写执行无障碍), 仅 chmod 操作
  chmod -R 777 "$TARGET_DIR" 2>/dev/null

  echo "+ Scene目录权限已修复 (全部 777)"
  log "权限修复完成"
  echo "=== 完成 ==="
}

uninstall_module() {
  echo ""
  echo "=== 模块卸载 ==="
  log "=== 卸载开始 ==="

  [ "$(id -u)" -ne 0 ] && { echo "! 需要ROOT权限"; log "错误: 非root"; exit 1; }

  # Scene 备份还原 + 校验 + 恢复官方调度 (逻辑收拢在 common.sh restore_scene_now)
  if [ -f "$FLAG_DIR/sc_installed" ]; then
    echo "- 还原Scene配置 (强制切回软件自带调度)..."
    if ! restore_scene_now; then
      echo "! 还原Scene配置失败 (备份未生效), 已保留 $FLAG_DIR 供手动恢复, 中止卸载"
      log "错误: 还原失败, 已保留备份, 中止卸载"
      exit 1
    fi
  fi

  if [ -f "$FLAG_DIR/rc_installed" ]; then
    echo "- 清理云控数据..."
    log "清理云控数据"
    am force-stop com.oplus.cosa 2>/dev/null
    sleep 1
    pm clear com.oplus.cosa 2>/dev/null
    sleep 2
  fi

  rm -rf "$FLAG_DIR"
  rm -rf /data/adb/scrc 2>/dev/null
  # 旧版破坏神磁贴残留 (v26.104 起模块不再提供): 标志无条件清, 包在的话顺手卸掉
  _dev_pkg="com.turbosched.devastator"
  rm -rf "$MODDIR/system/app/Devastator" 2>/dev/null
  rm -f /data/adb/turbo/devastator_on /data/adb/turbo/devastator_restored \
        /data/adb/turbo/devastator_installed /data/adb/turbo/devastator_params_backup.json 2>/dev/null
  if pm list packages "$_dev_pkg" 2>/dev/null | grep -q "$_dev_pkg"; then
    pm uninstall --user 0 "$_dev_pkg" >/dev/null 2>&1
    command -v ksud >/dev/null 2>&1 && ksud debug set.uninstall "$_dev_pkg" >/dev/null 2>&1
    echo "- 已卸载旧版破坏神磁贴 APK"
  fi
  rm -f /data/adb/service.d/.turbo_restore.sh
  log "清理标志文件完成"

  # 停止 Scene 与云控服务进程, 使其释放旧配置并重载官方调度
  am force-stop com.omarea.vtools 2>/dev/null
  am force-stop com.oplus.cosa 2>/dev/null

  echo "- 删除模块文件..."
  # 全部日志必须在删除前写完 (log 文件就在 $MODDIR/log 下, 删后再写只会报错)
  log "模块文件删除完成"
  log "=== 卸载完成 ==="
  rm -rf "$MODDIR" 2>/dev/null

  echo "+ 卸载完成，建议重启设备"
  exit 0
}

echo ""
echo "+----------------------------------------+"
echo "|        Turbo调度 · 操作菜单            |"
echo "+----------------------------------------+"
echo ""
log "=== 操作菜单启动 ==="

# ── 云控注入 (第一选项) ──
if [ -f "$FLAG_DIR/rc_installed" ]; then
  echo "  [音量+] 注入云控配置"
  echo "  [音量-] 下一选项"
  echo ""
  choice=$(wait_key_timeout 15)
  case "$choice" in
    "up")
      log "用户选择: 注入云控"
      echo ""
      echo "- 匹配已安装游戏..."
      sh "$SCRIPTS_DIR/pkg_matcher.sh"
      # 显示待注入文件格式
      json_n=$(ls "$MODDIR/cccf"/*.json 2>/dev/null | wc -l)
      enc_n=$(ls "$MODDIR/cccf"/*.enc 2>/dev/null | wc -l)
      echo "  待注入: $json_n 个 .json + $enc_n 个 .enc"
      sh "$SCRIPTS_DIR/cloud_ctrl.sh" inject
      echo ""; echo "3秒后退出..."; sleep 3; exit 0 ;;
  esac
fi

echo "  [音量+] 修复Scene权限(777)"
echo "  [音量-] 下一选项"
echo ""
choice=$(wait_key_timeout 15)
case "$choice" in
  "up")
    log "用户选择: 修复权限"
    fix_permissions
    echo ""; echo "3秒后退出..."; sleep 3; exit 0 ;;
esac

echo "  [音量+] 卸载模块（恢复备份 + 清理数据）"
echo "  [音量-] 退出"
echo ""
choice=$(wait_key_timeout 15)
case "$choice" in
  "up")
    log "用户选择: 卸载模块"
    uninstall_module ;;
  *)
    log "用户选择: 退出"
    echo "已退出"; exit 0 ;;
esac
