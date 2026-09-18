#!/system/bin/sh

MODE="${1:-install}"
MODPATH="${2:-${0%/*/*}}"
SCRIPTS_DIR="${0%/*}"
CONFIG_DIR="$MODPATH/scene_config"
CCCF_DIR="$MODPATH/cccf"
LOG_DIR="$MODPATH/log"
LOG_FILE="$LOG_DIR/scene.log"

mkdir -p "$LOG_DIR"
. "$SCRIPTS_DIR/common.sh"

deploy_config() {
  local config_type="$1"
  local soc_dir=$(get_soc_dir)
  local src_dir="$MODPATH/$soc_dir/${config_type}_scene_config"

  # 源缺失时直接从安装包 zip 解压 (开机 deploy 时 ZIPFILE 为空, 依赖模块目录残留)
  if [ ! -d "$src_dir" ] || [ -z "$(ls "$src_dir" 2>/dev/null)" ]; then
    echo "  ! 配置源缺失, 尝试从安装包直接解压..."
    log "配置源缺失 $src_dir, 尝试从zip解压"
    mkdir -p "$src_dir"
    if [ -n "$ZIPFILE" ] && [ -f "$ZIPFILE" ]; then
      unzip -jo "$ZIPFILE" "$soc_dir/${config_type}_scene_config/*" -d "$src_dir" >/dev/null 2>&1
    fi
    if [ -z "$(ls "$src_dir" 2>/dev/null)" ]; then
      echo "  ! 解压失败: $src_dir"
      echo "  ! 部署失败, 已清除旧的调度标志, 请重新安装模块"
      rm -f "$SCRC_DIR/sc_installed" "$SCRC_DIR/config_type"
      log "错误: 部署失败, 已清除sc标志"
      return 1
    fi
    echo "  + 配置源已从安装包解压"
    log "配置源已从zip解压: $config_type"
  fi

  rm -rf "$CONFIG_DIR"/*
  mkdir -p "$CONFIG_DIR"
  cp -rf "$src_dir/." "$CONFIG_DIR/"
  rm -rf "$MODPATH/config" 2>/dev/null   # 旧版为破坏神磁贴保留的还原副本, 已随该功能移除
  echo "  + Scene配置已部署 ($config_type)"
  log "Scene配置已部署: $config_type"

  mkdir -p "$SCRC_DIR"
  touch "$SCRC_DIR/sc_installed"
  echo "$config_type" > "$SCRC_DIR/config_type"

  return 0
}

create_backup() {
  local backup_dir="$SCRC_DIR/backup"
  mkdir -p "$backup_dir"
  if [ -z "$(ls "$backup_dir"/*.json 2>/dev/null)" ] && [ -d "$VT_FILES" ]; then
    # 不做 chmod -R: cp -af 原样保留属主/上下文/权限, 还原时一字不差放回
    cp -af "$VT_FILES/." "$backup_dir/" 2>/dev/null
    log "备份Scene原始配置完成"
  fi
}

# 权限仅在不一致时才改 (chmod 同值也更新 ctime, 触发热加载)
perm_is() { [ "$(stat -c %a "$1" 2>/dev/null)" = "$2" ]; }

# 少污染覆盖: cp 到目标同目录临时文件 (新 inode 继承 Scene 目录上下文, app 域必可读)
# → 临时文件上就位权限 → mv 原子替换; 不直写 (半份配置窗口/外来上下文/mtime带偏)
deploy_one() {  # $1=源  $2=同目录临时文件  $3=目标  $4=权限
  cp -f "$1" "$2" 2>/dev/null || return 1
  chmod "$4" "$2" 2>/dev/null
  mv -f "$2" "$3" 2>/dev/null || { rm -f "$2" 2>/dev/null; return 1; }
  return 0
}

copy_to_scene() {
  # $1="force" 强制覆盖 (开机时切回二改调度)
  local force="${1:-}"
  [ -d "$CONFIG_DIR" ] || { log "错误: config目录缺失"; return 1; }

  rm -f "$VT_FILES"/.turbo_tmp_* 2>/dev/null

  local count=0 skip=0
  for file in "$CONFIG_DIR"/*; do
    [ -f "$file" ] || continue
    name=$(basename "$file")

    # powercfg.sh: 仅内容变化时覆盖 (开机重写与 Scene 执行有竞争, 26.83/84 掉帧教训); oplus 版 0 字节=有意清空
    if [ "$name" = "powercfg.sh" ]; then
      if [ -f "$VT_FILES/$name" ] && cmp -s "$file" "$VT_FILES/$name"; then
        skip=$((skip + 1))
      else
        if deploy_one "$file" "$VT_FILES/.turbo_tmp_$name" "$VT_FILES/$name" "555"; then
          count=$((count + 1))
          log "覆盖(仅内容变化时): $name"
        else
          log "覆盖失败: $name"
        fi
      fi
      continue
    fi

    # 内容一致跳过 (避免热加载); force 模式强制覆盖
    if [ "$force" != "force" ] && [ -f "$VT_FILES/$name" ] && cmp -s "$file" "$VT_FILES/$name"; then
      [ "$name" = "categories.json" ] || perm_is "$VT_FILES/$name" "555" || chmod 555 "$VT_FILES/$name" 2>/dev/null
      skip=$((skip + 1))
      continue
    fi
    # categories.json (短视频包名): 模块独占, 全程 555 不允许 Scene 写。
    # 有用户镜像 (WebUI 增删时生成) 且 Scene 侧内容漂移 → 以镜像恢复; 首次种子后不再覆盖
    if [ "$name" = "categories.json" ]; then
      if [ -f "$SCRC_DIR/categories_seeded" ]; then
        if [ -f "$SCRC_DIR/categories_user.json" ]; then
          if [ ! -f "$VT_FILES/$name" ] || ! cmp -s "$SCRC_DIR/categories_user.json" "$VT_FILES/$name"; then
            if deploy_one "$SCRC_DIR/categories_user.json" "$VT_FILES/.turbo_tmp_$name" "$VT_FILES/$name" "555"; then
              count=$((count + 1))
              log "恢复用户短视频包名 (以 categories_user.json 为准)"
            else
              log "恢复失败: $name"
            fi
            continue
          fi
          perm_is "$VT_FILES/$name" "555" || chmod 555 "$VT_FILES/$name" 2>/dev/null
        else
          # 无镜像 (用户从未在 WebUI 增删): 维持可写, 不影响纯 Scene 用户
          perm_is "$VT_FILES/$name" "777" || chmod 777 "$VT_FILES/$name" 2>/dev/null
        fi
        skip=$((skip + 1))
        continue
      fi
      # 首次: 从 CONFIG_DIR 取源强制覆盖, 并写入首次标识 (555: Scene 不可写, root 的 WebUI 不受限)
      mkdir -p "$SCRC_DIR" 2>/dev/null
      if deploy_one "$CONFIG_DIR/$name" "$VT_FILES/.turbo_tmp_$name" "$VT_FILES/$name" "555"; then
        touch "$SCRC_DIR/categories_seeded" 2>/dev/null
        count=$((count + 1))
        log "首次覆盖: $name (已写入首次标识)"
      else
        log "覆盖失败: $name"
      fi
      continue
    fi
    if deploy_one "$file" "$VT_FILES/.turbo_tmp_$name" "$VT_FILES/$name" "555"; then
      count=$((count + 1))
      log "覆盖: $name"
    else
      log "覆盖失败: $name"
    fi
  done

  log "Scene配置覆盖完成 (更新 $count, 跳过 $skip${force:+ [强制]})"
}

wait_scene_dir() {
  local waited=0
  while [ ! -d "$VT_FILES" ]; do
    sleep 2; waited=$((waited + 2))
    [ $waited -ge 60 ] && { log "等待Scene目录超时"; return 1; }
  done
  chmod 777 "$VT_FILES"
  log "Scene目录就绪 (等待${waited}s)"
}

# 单独询问云控注入 (无Scene场景)
ask_cloud_only() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  检测到支持风驰的 oplus 设备"
  echo "  是否单独安装云控配置注入？"
  echo "  (仅注入游戏调度，不使用Scene)"
  echo "  [音量+] 安装  [音量-] 取消"
  echo "  (30秒无操作自动取消)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

  key=$(wait_key 30)
  if [ "$key" = "KEY_VOLUMEUP" ]; then
    sh "$SCRIPTS_DIR/cloud_ctrl.sh" setup "$MODPATH"
  elif [ "$key" = "KEY_VOLUMEDOWN" ]; then
    rm -f "$SCRC_DIR/rc_installed"
    echo "  - 已跳过"
    log "跳过云控注入"
  elif [ -f "$SCRC_DIR/rc_installed" ]; then
    # 超时: 之前已启用则保持启用 (无人值守刷入不静默关闭云控)
    echo "  + 无操作, 沿用已启用的云控注入"
    log "超时沿用云控注入"
  else
    echo "  - 无操作, 云控注入保持关闭"
    log "超时保持云控关闭"
  fi
}

install_mode() {
  # 清空"沿用"标记; 只有用户选择沿用时才会重新写入 (供 customize.sh 判断是否询问 APK)
  rm -f "$SCRC_DIR/sc_kept"

  if [ ! -d "$VT_FILES" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ! 未检测到 Scene 配置目录"
    echo "    请先安装正版 Scene9 并开启 LP 调度"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "Scene目录不存在，跳过Scene调度"

    is_oplus && ask_cloud_only
    return 1
  fi

  # 更新安装: 读取上次的启用状态 (二改调度 / 云控注入; 任一存在即提供"沿用")
  prev_type=""
  [ -f "$SCRC_DIR/sc_installed" ] && prev_type=$(cat "$SCRC_DIR/config_type" 2>/dev/null)
  prev_cloud=0
  [ -f "$SCRC_DIR/rc_installed" ] && prev_cloud=1
  if [ -n "$prev_type" ] || [ "$prev_cloud" = "1" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  检测到已安装 Turbo 调度"
    echo "  之前的选项:"
    if [ -n "$prev_type" ]; then
      echo "    二改调度: ${prev_type}版"
    else
      echo "    二改调度: 未启用"
    fi
    if [ "$prev_cloud" = "1" ]; then
      echo "    云控注入: 已启用"
    else
      echo "    云控注入: 未启用"
    fi
    echo "  是否沿用之前的选项？"
  echo "  [音量+] 沿用 (跳过选择直接部署)"
  echo "  [音量-] 重新选择"
  echo "  (30秒无操作自动沿用)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 超时默认沿用: 无人值守刷入保持上次的配置不变
  key=$(wait_key 30 KEY_VOLUMEUP)
    if [ "$key" = "KEY_VOLUMEUP" ]; then
      echo "  + 沿用之前的选项 (二改调度=${prev_type:-未启用}, 云控注入=$([ "$prev_cloud" = "1" ] && echo 已启用 || echo 未启用))"
      log "沿用之前的选项: 二改调度=${prev_type:-none}, 云控=${prev_cloud}"
      touch "$SCRC_DIR/sc_kept"
      if [ -n "$prev_type" ]; then
        create_backup
        deploy_config "$prev_type" || return 1
      else
        # 之前没开二改: 清掉残留标记, 不部署也不动 Scene 配置
        rm -f "$SCRC_DIR/sc_installed" "$SCRC_DIR/config_type"
      fi
      if [ "$prev_cloud" = "1" ]; then
        echo "  + 云控注入: 沿用已启用"
        log "沿用云控注入"
        sh "$SCRIPTS_DIR/cloud_ctrl.sh" setup "$MODPATH" "${prev_type:-oplus}"
      else
        rm -f "$SCRC_DIR/rc_installed"
      fi
      return 0
    fi
    echo "  - 重新选择"
    log "用户重新选择调度版本"
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  是否启用二改Scene调度？"
  echo "  (通过替换 Scene 调度配置文件实现)"
  echo "  [音量+] 启用  [音量-] 跳过"
  echo "  (30秒无操作自动跳过)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

  key=$(wait_key 30)
  if [ "$key" != "KEY_VOLUMEUP" ]; then
    echo "  - 已跳过二改调度"
    rm -f "$SCRC_DIR/sc_installed" "$SCRC_DIR/config_type"
    log "用户跳过二改调度"
    # 从通用版改回跳过时, 必须把 stop_official 关掉的 persist 属性拉回来:
    # persist.* 跨重启保留, 不还原会让官方风驰/horae 一直停摆且无人恢复
    start_official
    is_oplus && ask_cloud_only
    return 1
  fi

  create_backup

  if is_oplus; then
    # oplus 版配置按机型目录实际存在性判定 (文件夹缺失或为空 = 暂缺), 不按机型硬编码
    soc_dir=$(get_soc_dir)
    oplus_ok=0
    if [ -d "$MODPATH/$soc_dir/oplus_scene_config" ] && [ -n "$(ls "$MODPATH/$soc_dir/oplus_scene_config" 2>/dev/null)" ]; then
      oplus_ok=1
    fi
    if [ "$oplus_ok" != "1" ]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  检测到风驰机型, 但 oplus版配置暂缺 ($soc_dir)"
      echo "  二改调度使用通用版 (不可搭配云控注入)"
      echo "  如需云控注入, 请跳过二改调度后单独开启"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
      rm -f "$SCRC_DIR/rc_installed"
      deploy_config "generic" || return 1
      log "oplus版配置暂缺 ($soc_dir): 自动通用版"
      sh "$SCRIPTS_DIR/asoul_install.sh" "$MODPATH"
      return 0
    fi
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  检测到支持风驰游戏内核的 oplus 设备"
    echo "  请选择调度版本："
    echo "  [音量+] oplus版"
    echo "     仅调整日用调度，游戏使用官方调度"
    echo "     可搭配云控注入使用 ✓"
    echo "  [音量-] 通用版"
    echo "     日用+游戏全部使用二改调度"
    echo "     不可搭配云控注入 ✗"
    echo "  (30秒无操作自动选oplus版)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 超时默认 oplus版: 仅日用调度, 官方游戏调度保留, 最保守
    key=$(wait_key 30 KEY_VOLUMEUP)
    if [ "$key" = "KEY_VOLUMEUP" ]; then
      echo "  + 已选择: oplus版"
      deploy_config "oplus" || return 1

      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  是否启用云控注入？"
      echo "  (将官方游戏调度写入应用增强服务)"
      echo "  ! 需要保证官方调度组件完整"
      echo "  [音量+] 启用  [音量-] 跳过"
      echo "  (30秒无操作自动跳过)"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

      key=$(wait_key 30)
      if [ "$key" = "KEY_VOLUMEUP" ]; then
        sh "$SCRIPTS_DIR/cloud_ctrl.sh" setup "$MODPATH" "oplus"
      elif [ "$key" = "KEY_VOLUMEDOWN" ]; then
        rm -f "$SCRC_DIR/rc_installed"
        echo "  - 已跳过云控注入"
        echo "  ! 注意: 需保证官方调度组件完整方可生效"
        log "oplus版, 用户跳过云控注入"
      elif [ -f "$SCRC_DIR/rc_installed" ]; then
        # 超时: 之前已启用则保持启用 (无人值守刷入不静默关闭云控)
        echo "  + 无操作, 沿用已启用的云控注入"
        log "oplus版, 超时沿用云控注入"
      else
        echo "  - 无操作, 云控注入保持关闭"
        log "oplus版, 超时保持云控关闭"
      fi
    else
      echo "  + 已选择: 通用版"
      rm -f "$SCRC_DIR/rc_installed"
      deploy_config "generic" || return 1
      log "通用版, 询问AsoulOpt"
      sh "$SCRIPTS_DIR/asoul_install.sh" "$MODPATH"
    fi
  else
    echo "  - 当前设备不支持风驰，自动选择通用版"
    rm -f "$SCRC_DIR/rc_installed"
    deploy_config "generic" || return 1
    log "非oplus设备, 自动通用版"
    sh "$SCRIPTS_DIR/asoul_install.sh" "$MODPATH"
  fi

  return 0
}

case "$MODE" in
  install)
    log "=== 安装模式开始 ==="
    install_mode
    log "=== 安装模式结束 ==="
    ;;
  deploy)
    log "=== 部署模式开始 ==="
    wait_scene_dir || { log "部署中止: Scene目录不存在"; exit 1; }
    copy_to_scene force   # 每次开机强制切回二改调度
    log "=== 部署模式结束 ==="
    ;;
  *)
    echo "用法: $0 {install|deploy} [MODPATH]"
    exit 1
    ;;
esac
