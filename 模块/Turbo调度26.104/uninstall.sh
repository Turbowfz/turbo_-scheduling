#!/system/bin/sh
# Turbo调度 · 模块卸载清理

ulog() {
  echo "$1"
  [ -f "/proc/ksu" ] && log -p i -t "KSuModule" "$1"
  return 0
}

MODPATH="${MODPATH:-/data/adb/modules/Turbo_Scheduling}"

# ── 主动还原 Scene 配置 (子 shell source common.sh, 避免其 log() 遮蔽 /system/bin/log) ──
LOG_FILE="/data/adb/turbo/uninstall.log"
_restore_ok=1
if [ -f "/data/adb/turbo/sc_installed" ] && [ -f "$MODPATH/scripts/common.sh" ]; then
  ulog "- 还原Scene配置 (强制切回软件自带调度)..."
  if ! (. "$MODPATH/scripts/common.sh"; restore_scene_now); then
    _restore_ok=0
  fi
fi
if [ "$_restore_ok" != "1" ]; then
  # 还原失败: 保留 /data/adb/turbo 与开机守护, 下次开机兜底
  ulog "! Scene 配置还原失败, 已保留 /data/adb/turbo 供手动恢复"
  ulog "  (下次开机由 /data/adb/service.d/.turbo_restore.sh 兜底还原)"
else
  if [ -f "/data/adb/turbo/rc_installed" ]; then
    am force-stop com.oplus.cosa 2>/dev/null
    sleep 1
    pm clear com.oplus.cosa 2>/dev/null
  fi
  rm -rf /data/adb/turbo 2>/dev/null
  rm -f /data/adb/service.d/.turbo_restore.sh 2>/dev/null
fi

# ── 旧版破坏神磁贴 APK 残留清理 (v26.103 起模块不再提供; 有则卸掉) ──
_dev_pkg="com.turbosched.devastator"
if pm list packages "$_dev_pkg" 2>/dev/null | grep -q "$_dev_pkg"; then
  ulog "- 清理旧版破坏神残留..."
  rm -rf "$MODPATH/system/app/Devastator" 2>/dev/null
  pm uninstall --user 0 "$_dev_pkg" >/dev/null 2>&1
  command -v ksud >/dev/null 2>&1 && ksud debug set.uninstall "$_dev_pkg" >/dev/null 2>&1
  rm -rf /data/adb/turbo/devastator_on /data/adb/turbo/devastator_restored \
         /data/adb/turbo/devastator_params_backup.json 2>/dev/null
fi
rm -rf /data/adb/scrc 2>/dev/null
