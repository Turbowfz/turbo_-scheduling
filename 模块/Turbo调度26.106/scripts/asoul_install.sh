#!/system/bin/sh

MODPATH="$1"
ASOUL_ZIP="$MODPATH/modules/AsoulOpt.zip"
ASOUL_MOD_NAME="asoul_affinity_opt"
ASOUL_MOD_PATH="/data/adb/modules/$ASOUL_MOD_NAME"
ASOUL_PROP_FILE="$ASOUL_MOD_PATH/module.prop"
ASOUL_NEW_VERSION_CODE=282
LOG_DIR="$MODPATH/log"
LOG_FILE="$LOG_DIR/asoul.log"

mkdir -p "$LOG_DIR"
. "${0%/*}/common.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  是否安装 AsoulOpt 线程优化？"
echo "  (只适配游戏线程，非日用)"
echo "  ! 若安装请停用其他游戏线程优化模块"
echo "  [音量+] 安装  [音量-] 跳过"
echo "  (30秒无操作自动跳过)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

key=$(wait_key 30)

if [ "$key" != "KEY_VOLUMEUP" ]; then
  echo "  - 已跳过 AsoulOpt"
  log "用户跳过 AsoulOpt"
  rm -f "$ASOUL_ZIP"
  exit 0
fi

if [ ! -f "$ASOUL_ZIP" ]; then
  echo "  ! 未捆绑 AsoulOpt.zip"
  log "错误: AsoulOpt.zip 不存在"
  exit 1
fi

log "检查已有版本..."
OLD_VERSION_CODE=0
if [ -f "$ASOUL_PROP_FILE" ]; then
  OLD_VERSION_CODE=$(grep '^versionCode=' "$ASOUL_PROP_FILE" 2>/dev/null | cut -d= -f2)
  OLD_VERSION_CODE=${OLD_VERSION_CODE:-0}
fi

if [ -d "$ASOUL_MOD_PATH" ] && [ "$OLD_VERSION_CODE" -ge "$ASOUL_NEW_VERSION_CODE" ] 2>/dev/null; then
  echo "  + AsoulOpt 已是最新版 ($OLD_VERSION_CODE)，跳过"
  log "已是最新版 ($OLD_VERSION_CODE), 跳过"
  rm -f "$ASOUL_ZIP"
  exit 0
fi

if [ -d "$ASOUL_MOD_PATH" ]; then
  echo "  - 检测到旧版 ($OLD_VERSION_CODE)，清理后重装..."
  log "清理旧版 ($OLD_VERSION_CODE)"
  killall -9 AsoulOpt 2>/dev/null
  rm -rf /data/adb/modules*/$ASOUL_MOD_NAME
fi

log "开始安装 AsoulOpt v$ASOUL_NEW_VERSION_CODE"
if magisk --install-module "$ASOUL_ZIP" >>"$LOG_FILE" 2>&1; then
  echo "  + AsoulOpt 安装成功 (magisk)"
  log "安装成功 (magisk)"
elif ksud module install "$ASOUL_ZIP" >>"$LOG_FILE" 2>&1; then
  echo "  + AsoulOpt 安装成功 (ksud)"
  log "安装成功 (ksud)"
elif apd module install "$ASOUL_ZIP" >>"$LOG_FILE" 2>&1; then
  echo "  + AsoulOpt 安装成功 (apd)"
  log "安装成功 (apd)"
else
  # 安装包挪到模块根幸存 (clean_after_install 只清 modules/)
  mv -f "$ASOUL_ZIP" "$MODPATH/AsoulOpt.zip" 2>/dev/null
  echo "  ! 安装失败, 已保留 $MODPATH/AsoulOpt.zip"
  echo "    可重启后手动刷入 (详见 log/asoul.log)"
  log "安装失败 (错误输出见上方)"
  exit 1
fi

rm -f "$ASOUL_ZIP"
log "安装完成"
