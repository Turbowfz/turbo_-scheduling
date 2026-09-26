#!/system/bin/sh

SKIPUNZIP=0
[ -z "$MODPATH" ] && MODPATH="$1"
[ -z "$LOG_FILE" ] && LOG_FILE="/data/adb/ksu_install.log"

SKIPMOUNT=false
PROPFILE=true
POSTFSDATA=true
LATESTARTSERVICE=true

SCRIPTS_DIR="$MODPATH/scripts"
# 显式定义: update_description 等不再依赖 common.sh 的 source 顺序
FLAG_DIR="/data/adb/turbo"

ui_print() {
  echo "$1"
  [ -f "/proc/ksu" ] && {
    echo "[$(date "+%m-%d %T")] $1" >> "$LOG_FILE"
    log -p i -t "KSuModule" "$1"
  }
  return 0   # 末尾 [ -f /proc/ksu ] 在 Magisk 环境返回 1, 会污染调用方的 && || 链
}

# 公共库一次性提前加载 (wait_key/get_soc_dir/restore_scene_now 等)
. "$SCRIPTS_DIR/common.sh"

validate_soc() {
  platform=$(getprop ro.board.platform)
  soc_model=$(getprop ro.soc.model)

  if [ "$platform" = "pineapple" ]; then
    ui_print "+ 骁龙8 Gen3 (pineapple)"
    return 0
  fi

  echo "$soc_model" | grep -qi "8650" && {
    ui_print "+ 骁龙8 Gen3 (SM8650)"
    return 0
  }

  if [ "$platform" = "sun" ]; then
    ui_print "+ 骁龙8 Elite (sun)"
    return 0
  fi

  echo "$soc_model" | grep -qi "8750" && {
    ui_print "+ 骁龙8 Elite (SM8750)"
    return 0
  }

  if [ "$platform" = "canoe" ]; then
    ui_print "+ 骁龙8 Gen5 (canoe)"
    return 0
  fi

  echo "$soc_model" | grep -qi "8845" && {
    ui_print "+ 骁龙8 Gen5 (SM8845)"
    return 0
  }

  echo "$soc_model" | grep -qi "8850" && {
    ui_print "+ 骁龙8 Elite Gen5 (SM8850)"
    return 0
  }

  ui_print "! 仅支持骁龙8 Gen3 / 8 Elite / 8 Gen5 / 8 Elite Gen5"
  ui_print "  Platform: ${platform:-未知}"
  ui_print "  SoC: ${soc_model:-未知}"
  return 1
}

update_description() {
  local desc
  if [ -f "$FLAG_DIR/rc_installed" ] && [ -f "$FLAG_DIR/sc_installed" ]; then
    desc="云控注入 + 二改调度($(cat "$FLAG_DIR/config_type" 2>/dev/null))"
  elif [ -f "$FLAG_DIR/rc_installed" ]; then
    desc="云控注入"
  elif [ -f "$FLAG_DIR/sc_installed" ]; then
    desc="二改调度($(cat "$FLAG_DIR/config_type" 2>/dev/null))"
  else
    desc="无任何功能，建议卸载"
  fi
  sed -i "s/^description=.*/description=$desc/" "$MODPATH/module.prop"
}

clean_after_install() {
  if [ -f "$FLAG_DIR/rc_installed" ]; then
    # 仅部署本机型模板 (旧版全机型混拷会互相覆盖); 现有 cccf 先备份 (每文件保留10份)
    if [ -d "$MODPATH/cccf" ] && [ -n "$(ls "$MODPATH/cccf"/*.json 2>/dev/null)" ]; then
      ts=$(date +%Y%m%d_%H%M%S)
      mkdir -p "$MODPATH/cccf_backup"
      for f in "$MODPATH/cccf"/*.json; do
        n=$(basename "$f")
        cp -f "$f" "$MODPATH/cccf_backup/${n}.bak_pre_${ts}" 2>/dev/null
        ls -t "$MODPATH/cccf_backup/${n}.bak_pre_"* 2>/dev/null | tail -n +11 | xargs -r rm -f
      done
      ui_print "  + 旧云控配置已备份 (cccf_backup)"
    fi
    rm -rf "$MODPATH/cccf" 2>/dev/null
    mkdir -p "$MODPATH/cccf" 2>/dev/null
    soc_dir=$(. "$SCRIPTS_DIR/common.sh"; get_soc_dir)
    if [ -n "$soc_dir" ] && [ -d "$MODPATH/soc/$soc_dir/oplus_cccf" ]; then
      cp -af "$MODPATH/soc/$soc_dir/oplus_cccf/." "$MODPATH/cccf/" 2>/dev/null
      ui_print "  + 云控模板已部署 ($soc_dir)"
    else
      ui_print "  ! 未找到本机型云控模板 ($soc_dir)"
    fi
    # cccf 为空提示: 无模板机型可在 WebUI 把数据库配置导出到 cccf 建档
    cccf_n=$(find "$MODPATH/cccf" -maxdepth 1 \( -name '*.json' -o -name '*.enc' \) 2>/dev/null | wc -l)
    if [ "$cccf_n" -eq 0 ]; then
      ui_print "  ! cccf 内没有配置文件, 云控注入将没有可注入内容"
      ui_print "    可在 WebUI 云控页把数据库配置导出到 cccf 后再注入"
    fi
    for soc in 8gen3 8elite 8gen5 8elitegen5; do
      rm -rf "$MODPATH/$soc" 2>/dev/null
    done
    rm -rf "$MODPATH/soc" 2>/dev/null
  else
    # 未启用云控: 删除 cccf 与残留的云控模板
    rm -rf "$MODPATH/cccf" 2>/dev/null
    for soc in 8gen3 8elite 8gen5 8elitegen5; do
      rm -rf "$MODPATH/$soc" 2>/dev/null
    done
    rm -rf "$MODPATH/soc" 2>/dev/null
  fi
  # AsoulOpt.zip 已作为子模块刷入, 源文件不再需要
  rm -rf "$MODPATH/modules" 2>/dev/null
  # 清理旧版破坏神残留 (v26.104 起模块不再提供磁贴 APK): 磁贴挂载源 + 根目录 APK + 旧脚本
  # 标志文件无条件清 (磁贴包可能早就被卸载, 只按"包装没装"判断会漏掉 /data/adb/turbo 下的残留标志)
  rm -rf "$MODPATH/devastator" "$MODPATH/system/app/Devastator" 2>/dev/null
  rm -f "$MODPATH/scripts/devastator.sh" "$MODPATH/webroot/devastator-page.js" "$MODPATH/Devastator.apk" 2>/dev/null
  # v26.102 起数据库操作全走 cosa, bin/sqlite3 (1.36MB) 已不再提供 —— 覆盖安装时若模块目录
  # 不是整目录替换, 这个死文件会一直留着, 顺手清掉
  rm -f "$MODPATH/bin/sqlite3" 2>/dev/null
  rm -f "$FLAG_DIR/devastator_on" "$FLAG_DIR/devastator_restored" \
        "$FLAG_DIR/devastator_installed" "$FLAG_DIR/devastator_params_backup.json" 2>/dev/null
  rmdir "$MODPATH/system/app" "$MODPATH/system" 2>/dev/null
}

# 展示 Update.md 最新版本块
show_update_log() {
  local md="$MODPATH/Update.md"
  [ -f "$md" ] || { ui_print "  ! Update.md 缺失"; return 1; }

  local latest
  latest=$(awk '/^#[0-9]/{n++} n==1{print} n==2{exit}' "$md")

  ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ui_print "  当前版本更新内容:"
  if [ -n "$latest" ]; then
    echo "$latest" | while IFS= read -r line; do
      ui_print "    $line"
    done
  else
    ui_print "    (无更新日志)"
  fi
  ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
  return 0
}

set_permissions() {
  set_perm_recursive "$MODPATH" 0 0 0755 0644
  [ -f "$MODPATH/service.sh" ]      && set_perm "$MODPATH/service.sh" 0 0 0755
  [ -f "$MODPATH/post-fs-data.sh" ] && set_perm "$MODPATH/post-fs-data.sh" 0 0 0755
  [ -f "$MODPATH/action.sh" ]       && set_perm "$MODPATH/action.sh" 0 0 0755
  [ -d "$MODPATH/scripts" ] && {
    set_perm_recursive "$MODPATH/scripts" 0 0 0755 0755
  }
  [ -f "$MODPATH/bin/inject" ] && chmod 777 "$MODPATH/bin/inject" 2>/dev/null
  # cosa: COSA 数据库工具 (Rust 二进制), WebUI/脚本读写数据库的唯一通道
  [ -f "$MODPATH/bin/cosa" ] && chmod 755 "$MODPATH/bin/cosa" 2>/dev/null
}

# cosa 需要 SQLite 库: 模块不自带 (省 850KB 设备空间 / 465KB 包体), 用系统的 /system/lib64/libsqlite.so。
# 这里建 libsqlite3.so 符号链接让 cosa 的 DT_NEEDED 能解析到它, 并当场自检一次。
link_system_sqlite() {
  local sys_lib="/system/lib64/libsqlite.so"
  [ -f "$sys_lib" ] || {
    ui_print "  ! 未找到系统 SQLite 库 ($sys_lib)"
    ui_print "    云控注入将不可用 (二改调度不受影响)"
    return 1
  }
  ln -sf "$sys_lib" "$MODPATH/bin/libsqlite3.so" 2>/dev/null || { ui_print "  ! 无法创建 SQLite 符号链接"; return 1; }
  # cosa version 不碰数据库, 但动态链接器启动时就要加载 libsqlite3.so → 能跑通即说明库可用
  if LD_LIBRARY_PATH="$MODPATH/bin" "$MODPATH/bin/cosa" version >/dev/null 2>&1; then
    ui_print "  + SQLite: 使用系统库 (libsqlite.so)"
    return 0
  fi
  ui_print "  ! 系统 SQLite 库无法被 cosa 加载, 云控注入将不可用"
  return 1
}

ui_print "+-----------------------------------------+"
ui_print "|  Turbo-Scheduling · 安装启动     |"
ui_print "+-----------------------------------------+"

timeout 0.5 getevent >/dev/null 2>/dev/null
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print "! 刷入须知"
ui_print "  . 调度默认 Scene9 正版"
ui_print "    Scene9 以下版本请尽快升级"
ui_print "    破解版请使用正版"
ui_print "  . 需正版 Scene9 开启 LP 调度"
ui_print "  . 二改调度与云控注入可独立选择"
ui_print "  . 通用版不可搭配云控注入"
ui_print "  . oplus版仅日用调度，可搭配云控"
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print "  [音量+] 同意并继续"
ui_print "  [音量-] 取消"
ui_print "  (60秒无操作自动继续)"
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 超时默认继续: 无人值守刷入 (adb/脚本/OTA) 不再永久挂死在按键等待
key=$(wait_key 60 KEY_VOLUMEUP)
[ "$key" = "KEY_VOLUMEDOWN" ] && exit 1

validate_soc || {
  ui_print "! 设备验证未通过，终止安装"
  exit 1
}

# 动态展示 Update.md 最新版本日志
show_update_log

ui_print ""
ui_print "━━━ 二改调度 & 云控配置 ━━━"
ui_print ""
sh "$SCRIPTS_DIR/scene_config.sh" install "$MODPATH"

# 首次安装才询问酷安主页与交流群; 更新/重刷时直接跳过
if [ ! -d "/data/adb/modules/Turbo_Scheduling" ]; then
ui_print ""
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print "  是否查看 Turbo 的酷安主页？"
  ui_print "  [音量+] 打开  [音量-] 跳过"
  ui_print "  (15秒无操作自动跳过)"
  ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"

key=$(wait_key 15)
[ "$key" = "KEY_VOLUMEUP" ] && {
  am start -a android.intent.action.VIEW -d "https://www.coolapk.com/u/36667900" >/dev/null 2>&1 &
  ui_print "  + 已打开"
} || ui_print "  - 已跳过"

ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print "  是否加入 Turbo 交流群？"
ui_print "  [音量+] 加入QQ群  [音量-] 跳过"
ui_print "  (15秒无操作自动跳过)"
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"

key=$(wait_key 15)
[ "$key" = "KEY_VOLUMEUP" ] && {
  am start -a android.intent.action.VIEW -d "https://qun.qq.com/universal-share/share?ac=1&authKey=fbBTMojWZqU6dl9ZgzxJuVMbDpz7i5vglP525ADa9G0QD68Y4msUVZeQ2VIpUkjY&busi_data=eyJncm91cENvZGUiOiI3NjQ1NzAyOTciLCJ0b2tlbiI6ImZWQ3ZRdUlQd2pWQjRyTHJQYk5qMFZnN3NJc09FRXBSYjUxQTZCY0Nac25idHJjMUpheWZFRXBHbHBTOWhqd2siLCJ1aW4iOiIzOTgzMjE1MTQ1In0%3D&data=iI8p004GAXEMHzYscGhAcch1NckHBkb1T0_eWZWK6YCvyCaJw2cZNDXRZ1N146nKYrcaPYfstgLIZEvBMGwC4g&svctype=4&tempid=h5_group_info" >/dev/null 2>&1 &
  ui_print "  + 已打开"
} || ui_print "  - 已跳过"
else
  ui_print ""
  ui_print "  - 检测到已安装模块, 跳过酷安/交流群询问"
fi

ui_print ""

clean_after_install

update_description

set_permissions

link_system_sqlite

ui_print ""
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print "  + Turbo-Scheduling · 安装完成"
ui_print "    好了，重启吧"
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━"
