#!/system/bin/sh
# AsoulOpt 云端安装: 从 nakixii/Magisk_AsoulOpt 最新 release 下载并安装 (包不随本模块分发)。
# 直连 GitHub; 失败不留包; 不清理旧版 (新版由管理器直接覆盖);
# 已安装版本 >= 云端版本时直接跳过 (不询问), 网络不可达时跳过且不阻塞安装流程。

MODPATH="$1"
ASOUL_REPO="nakixii/Magisk_AsoulOpt"
ASOUL_MOD_NAME="asoul_affinity_opt"
ASOUL_MOD_PATH="/data/adb/modules/$ASOUL_MOD_NAME"
ASOUL_PROP_FILE="$ASOUL_MOD_PATH/module.prop"
LOG_DIR="$MODPATH/log"
LOG_FILE="$LOG_DIR/asoul.log"
TMP_ZIP="$LOG_DIR/AsoulOpt_dl.zip"
JSON_TMP="$LOG_DIR/.asoul_api.json"

mkdir -p "$LOG_DIR"
. "${0%/*}/common.sh"

# fetch <url> <输出文件> [超时秒]: curl 优先, wget 兜底
fetch() {
  local url="$1" out="$2" t="${3:-30}"
  rm -f "$out" 2>/dev/null
  if command -v curl >/dev/null 2>&1; then
    curl -L --max-time "$t" -o "$out" "$url" >>"$LOG_FILE" 2>&1 && [ -s "$out" ] && return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -T "$t" -O "$out" "$url" >>"$LOG_FILE" 2>&1 && [ -s "$out" ] && return 0
  fi
  return 1
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AsoulOpt 线程优化 (云端获取最新版)"
echo "  (只适配游戏线程，非日用)"
echo "  ! 若安装请停用其他游戏线程优化模块"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "=== AsoulOpt 云端安装开始 ==="

# ── 1) 取最新 release 的资产地址与 sha256 (GitHub API) ──
rm -f "$JSON_TMP"
fetch "https://api.github.com/repos/$ASOUL_REPO/releases/latest" "$JSON_TMP" 20
ASOUL_DL_URL=$(grep -o '"browser_download_url": *"[^"]*\.zip"' "$JSON_TMP" 2>/dev/null | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
ASOUL_SHA256=$(grep -o '"digest": *"sha256:[0-9a-f]*"' "$JSON_TMP" 2>/dev/null | head -1 | sed 's/.*sha256://;s/"//')
rm -f "$JSON_TMP" 2>/dev/null

if [ -z "$ASOUL_DL_URL" ]; then
  echo "  ! 云端不可达, 跳过 AsoulOpt (不影响本模块其它功能)"
  log "错误: 无法获取 AsoulOpt 最新版地址"
  exit 0
fi
log "资产地址: $ASOUL_DL_URL"
echo "  + 已获取最新版地址"

# ── 2) 下载 + 完整性校验 ──
echo "  - 下载中..."
if ! fetch "$ASOUL_DL_URL" "$TMP_ZIP" 60; then
  echo "  ! 下载失败, 跳过 AsoulOpt (详见 log/asoul.log)"
  log "错误: 下载失败"
  exit 0
fi
if ! unzip -t "$TMP_ZIP" >/dev/null 2>&1; then
  echo "  ! 下载内容不是有效 zip, 跳过"
  log "错误: zip 校验失败"
  rm -f "$TMP_ZIP"
  exit 0
fi
if [ -n "$ASOUL_SHA256" ] && command -v sha256sum >/dev/null 2>&1; then
  GOT=$(sha256sum "$TMP_ZIP" 2>/dev/null | cut -d' ' -f1)
  if [ "$GOT" != "$ASOUL_SHA256" ]; then
    echo "  ! sha256 校验不符, 跳过 (防篡改)"
    log "错误: sha256 不符 (got=$GOT want=$ASOUL_SHA256)"
    rm -f "$TMP_ZIP"
    exit 0
  fi
  log "sha256 校验通过"
fi

# ── 3) 读云端版本号, 与已装版本比对: 已装 >= 云端 直接跳过 (不询问, 不降级) ──
CLOUD_VC=$(unzip -p "$TMP_ZIP" module.prop 2>/dev/null | grep '^versionCode=' | cut -d= -f2 | tr -d ' \r')
CLOUD_VC=${CLOUD_VC:-0}
OLD_VC=0
[ -f "$ASOUL_PROP_FILE" ] && OLD_VC=$(grep '^versionCode=' "$ASOUL_PROP_FILE" 2>/dev/null | cut -d= -f2)
OLD_VC=${OLD_VC:-0}
log "云端 versionCode=$CLOUD_VC, 已装 versionCode=$OLD_VC"

if [ "$OLD_VC" -ge "$CLOUD_VC" ] 2>/dev/null; then
  echo "  + AsoulOpt 已是最新版 (versionCode $OLD_VC), 跳过"
  log "已是最新版 ($OLD_VC >= $CLOUD_VC), 跳过"
  rm -f "$TMP_ZIP"
  exit 0
fi

# ── 4) 询问 (仅在需要安装/升级时) ──
echo "  + 云端最新版 versionCode: $CLOUD_VC$([ "$OLD_VC" != "0" ] && echo " (已装: $OLD_VC)")"
echo "  是否安装 AsoulOpt？"
echo "  [音量+] 安装  [音量-] 跳过"
echo "  (30秒无操作自动跳过)"
key=$(wait_key 30)
if [ "$key" != "KEY_VOLUMEUP" ]; then
  echo "  - 已跳过 AsoulOpt"
  log "用户跳过 AsoulOpt"
  rm -f "$TMP_ZIP"
  exit 0
fi

# ── 5) 安装: 调 root 管理器自带的安装器 (KernelSU=ksud, Magisk=magisk) ──
# 不清理旧版 (管理器覆盖安装), 失败不留包
log "开始安装 AsoulOpt versionCode=$CLOUD_VC (调用 root 管理器安装)"
if command -v ksud >/dev/null 2>&1; then
  if ksud module install "$TMP_ZIP" >>"$LOG_FILE" 2>&1; then
    echo "  + AsoulOpt 安装成功 (KernelSU)"
    log "安装成功 (ksud)"
  else
    echo "  ! 安装失败 (详见 log/asoul.log), 已丢弃安装包"
    log "安装失败 (ksud)"
    rm -f "$TMP_ZIP"
    exit 1
  fi
elif command -v magisk >/dev/null 2>&1; then
  if magisk --install-module "$TMP_ZIP" >>"$LOG_FILE" 2>&1; then
    echo "  + AsoulOpt 安装成功 (Magisk)"
    log "安装成功 (magisk)"
  else
    echo "  ! 安装失败 (详见 log/asoul.log), 已丢弃安装包"
    log "安装失败 (magisk)"
    rm -f "$TMP_ZIP"
    exit 1
  fi
else
  echo "  ! 未找到 root 管理器 (ksud/magisk), 跳过"
  log "错误: 未找到管理器安装器"
  rm -f "$TMP_ZIP"
  exit 1
fi
rm -f "$TMP_ZIP"
echo "  + 安装完成, 重启后生效"
log "安装完成"
exit 0
