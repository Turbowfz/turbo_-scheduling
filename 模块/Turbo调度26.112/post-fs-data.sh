#!/system/bin/sh

MODDIR="${0%/*}"
# 旧版标志目录迁移: v26.82 前使用 /data/adb/scrc, 一次性迁移到 /data/adb/turbo
# (保留 sc_installed / rc_installed / config_type / backup 等状态)
# turbo 已存在时 (上次迁移中断导致双目录并存) 直接清掉 scrc 残留
if [ -d "/data/adb/scrc" ]; then
  if [ -d "/data/adb/turbo" ]; then
    rm -rf /data/adb/scrc 2>/dev/null
  else
    mv /data/adb/scrc /data/adb/turbo 2>/dev/null
  fi
fi
FLAG_DIR="/data/adb/turbo"
SERVICE_DIR="/data/adb/service.d"
DAEMON_FILE="$SERVICE_DIR/.turbo_restore.sh"

# ── 机型门禁: 非骁龙 8 系不写卸载还原守护 (防手动塞模块+造标志的绕过) ──
. "$MODDIR/scripts/common.sh" 2>/dev/null

if [ -f "$FLAG_DIR/sc_installed" ] && is_supported_soc; then
  # 注意: 备份 Scene 原始配置只在安装时 scene_config.sh create_backup 做 ——
  # post-fs-data 阶段 CE 存储尚未解锁, 在这里 cp /data/data/... 必然失败且被吞
  # (旧版在此的"兜底备份"是假安全感, 已删除)
  if [ ! -f "$DAEMON_FILE" ]; then
    cat > "$DAEMON_FILE" << 'EOF'
#!/system/bin/sh
if [ -d "/data/adb/modules/scrc" ] || [ -d "/data/adb/modules/Turbo_Scheduling" ]; then
  exit 0
fi

while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done

TARGET_DIR="/data/data/com.omarea.vtools/files"
BACKUP_DIR="/data/adb/turbo/backup"
SELF="/data/adb/service.d/.turbo_restore.sh"

WAIT_TIME=0
while [ ! -d "$TARGET_DIR" ] && [ $WAIT_TIME -lt 60 ]; do
  sleep 2; WAIT_TIME=$((WAIT_TIME + 2))
done

sleep 10
mkdir -p "$TARGET_DIR"
am force-stop com.omarea.vtools 2>/dev/null
# cp -af 原样保留备份里的属主/上下文/权限; 全目录 chmod 会摸 ctime 触发热加载
[ -d "$BACKUP_DIR" ] && cp -af "$BACKUP_DIR/." "$TARGET_DIR/" 2>/dev/null

if [ -d "/data/adb/turbo" ]; then
  am force-stop com.oplus.cosa 2>/dev/null
  sleep 1
  pm clear com.oplus.cosa 2>/dev/null
  sleep 2
  rm -rf /data/adb/turbo
fi

# 还原官方调度属性/服务 (与 start_official 对齐)
setprop persist.sys.oiface.enable 1
setprop persist.sys.oplus.gameswitch.enable 1
start vendor.urcc-hal-aidl 2>/dev/null
start gameopt_hal_service-1-0 2>/dev/null
start oiface 2>/dev/null

rm -rf "$BACKUP_DIR"
rm -f "$SELF"
exit 0
EOF
    chmod 777 "$DAEMON_FILE"
  fi
fi
