#!/system/bin/sh
# 备份范围的本地演练 (26.116: 只 json/conf, 不含 .sh): 用假目录跑 common.sh 里的 scene_cfg_* 三个函数
# (不依赖真机: 只测文件筛选/相对路径/备份-还原往返/老备份清理/还原校验)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
COMMON="$HERE/../模块/Turbo调度26.116/scripts/common.sh"
[ -f "$COMMON" ] || { echo "找不到 common.sh: $COMMON"; exit 1; }

TMP=$(mktemp -d)
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  OK   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }

# 造一个像 Scene files/ 的目录: 配置类 + 一堆无关数据
SRC="$TMP/files"; mkdir -p "$SRC/sub" "$SRC/cache"
: > "$SRC/profile.json"; : > "$SRC/_Games.json"; : > "$SRC/powercfg.sh"
: > "$SRC/scene.conf"; : > "$SRC/legacy.CONF"
: > "$SRC/cache/blob.bin"; : > "$SRC/database.db"; : > "$SRC/sub/nested.json"
: > "$SRC/sub/notes.txt"; echo x > "$SRC/cache/huge.dat"

# 只抽出 scene_cfg_* 三个函数 (不整份 source: common.sh 里还有依赖设备命令的代码)
eval "$(sed -n '/^# ── Scene 配置备份范围/,/^# ── Scene 备份还原/p' "$COMMON" | sed '$d')"
command -v scene_cfg_copy >/dev/null || { echo "未抽出 scene_cfg_* 函数"; exit 1; }
log() { :; }

# 1) 备份: 只带配置类文件, 且保留子目录结构
BK="$TMP/backup"
scene_cfg_copy "$SRC" "$BK"
got=$(cd "$BK" && find . -type f | sort | tr '\n' ' ')
want="./_Games.json ./legacy.CONF ./powercfg.sh ./profile.json ./scene.conf ./sub/nested.json "
[ "$got" = "$want" ] && ok "备份只含 json/sh/conf (含 .CONF 与子目录)" || bad "备份内容不符: $got"
case "$got" in *powercfg.sh*) ok "powercfg.sh (.sh) 已进备份" ;; *) bad "powercfg.sh 漏备 (还原后 Scene 还在用模块调度)" ;; esac
junk=0
for j in cache/blob.bin database.db sub/notes.txt cache/huge.dat; do [ -f "$BK/$j" ] && junk=1; done
[ "$junk" = "0" ] && ok "无关数据文件 (bin/db/txt/dat) 未进备份" || bad "备份混入了非配置文件"

# 2) 还原: 改动源目录后能原样回来, 且不覆盖无关文件
echo MODIFIED > "$SRC/profile.json"; echo MODIFIED > "$SRC/sub/nested.json"
echo USERDATA > "$SRC/database.db"; rm -f "$SRC/scene.conf"
scene_cfg_copy "$BK" "$SRC"
[ ! -s "$SRC/profile.json" ] && ok "还原: profile.json 回到备份内容" || bad "还原未生效"
[ ! -s "$SRC/sub/nested.json" ] && ok "还原: 子目录 nested.json 回到备份内容" || bad "子目录还原未生效"
[ -f "$SRC/scene.conf" ] && ok "还原: 被删的 scene.conf 恢复" || bad "scene.conf 未恢复"
[ "$(cat "$SRC/database.db")" = "USERDATA" ] && ok "还原: 无关数据文件 (database.db) 未被覆盖" || bad "无关文件被覆盖了!"

# 3) 老备份清理: 模拟旧版本把整个目录备份进来 → prune 后只剩配置类
OLD="$TMP/oldbk"; mkdir -p "$OLD/cache" "$OLD/sub2"
: > "$OLD/profile.json"; : > "$OLD/powercfg.sh"; : > "$OLD/cache/blob.bin"
: > "$OLD/database.db"; : > "$OLD/sub2/nested.CONF"
scene_cfg_prune "$OLD"
left=$(cd "$OLD" && find . -type f | sort | tr '\n' ' ')
[ "$left" = "./powercfg.sh ./profile.json ./sub2/nested.CONF " ] && ok "老备份清理: 只剩 json/sh/conf" || bad "清理结果不符: $left"
[ -d "$OLD/cache" ] && bad "空目录 cache 未清理" || ok "空目录已清理"
[ -d "$OLD/sub2" ] && ok "非空子目录 sub2 保留" || bad "非空子目录被误删"

# 4) 还原校验逻辑: 逐条比对, 缺一个能检出
list="$TMP/list"; miss=0
scene_cfg_list "$BK" > "$list"
while IFS= read -r bf; do
  [ -n "$bf" ] || continue
  rel="${bf#"$BK"/}"
  [ -f "$SRC/$rel" ] || miss=$((miss+1))
done < "$list"
[ "$miss" = "0" ] && ok "还原校验: 全部到位 (miss=0)" || bad "校验误报缺失 $miss 个"
rm -f "$SRC/profile.json"; miss=0
scene_cfg_list "$BK" > "$list"
while IFS= read -r bf; do
  [ -n "$bf" ] || continue
  rel="${bf#"$BK"/}"
  [ -f "$SRC/$rel" ] || miss=$((miss+1))
done < "$list"
[ "$miss" = "1" ] && ok "还原校验: 缺 1 个文件被检出" || bad "缺失未检出 (miss=$miss)"

# 5) manifest.json 原版判定 (26.116): LP/HP/EP = Scene 原版; Turbo_* = 本模块已改
MF="$TMP/mf"; mkdir -p "$MF"
printf '{\n  "version": "LP",\n  "versionCode": 20261007,\n  "files": ["_apps.json"]\n}\n' > "$MF/manifest.json"
VT_FILES="$MF"
[ "$(scene_manifest_version)" = "LP" ] && ok "manifest: 取到 version=LP" || bad "version 取值失败: $(scene_manifest_version)"
scene_is_original && ok "manifest: LP 判为原版" || bad "LP 未判为原版"
for v in HP EP hp; do
  printf '{"version": "%s"}\n' "$v" > "$MF/manifest.json"
  scene_is_original && ok "manifest: $v 判为原版" || bad "$v 未判为原版"
done
printf '{"version": "Turbo_oplus"}\n' > "$MF/manifest.json"
scene_is_original && bad "Turbo_oplus 被误判为原版" || ok "manifest: Turbo_oplus 判为非原版 (不备份自家配置)"
printf '{"version": "Turbo_generic", "versionCode": 1}\n' > "$MF/manifest.json"
scene_is_original && bad "Turbo_generic 被误判为原版" || ok "manifest: Turbo_generic 判为非原版"
[ "$(scene_manifest_version)" = "Turbo_generic" ] && ok "manifest: versionCode 不会误命中 version" || bad "version 被 versionCode 干扰: $(scene_manifest_version)"
rm -f "$MF/manifest.json"
scene_manifest_version >/dev/null && bad "缺 manifest 时应返回失败" || ok "manifest: 缺失时返回失败 (不备份)"

# 6) drop_scene_backup: 只装云控时把原版还回去并删备份目录
FLAG_DIR="$TMP/flag"; VT_FILES="$TMP/vt"; mkdir -p "$FLAG_DIR/backup" "$VT_FILES"
printf '{"version": "Turbo_oplus"}\n' > "$VT_FILES/manifest.json"
echo OURS > "$VT_FILES/profile.json"; : > "$VT_FILES/powercfg.sh"
printf '{"version": "LP"}\n' > "$FLAG_DIR/backup/manifest.json"
: > "$FLAG_DIR/backup/profile.json"
am() { :; }   # 桩: drop_scene_backup 会 force-stop Scene
drop_scene_backup
[ ! -s "$VT_FILES/profile.json" ] && ok "未启用二改: 原版 profile.json 已还回" || bad "原版未还回"
[ ! -d "$FLAG_DIR/backup" ] && ok "未启用二改: 备份目录已清除 (不留残余)" || bad "备份目录仍在"
# 已是原版时不拿旧快照盖掉用户新改的配置
mkdir -p "$FLAG_DIR/backup"; printf '{"version": "LP"}\n' > "$FLAG_DIR/backup/manifest.json"
: > "$FLAG_DIR/backup/profile.json"; printf '{"version": "HP"}\n' > "$VT_FILES/manifest.json"
echo USERNEW > "$VT_FILES/profile.json"
drop_scene_backup
[ "$(cat "$VT_FILES/profile.json")" = "USERNEW" ] && ok "未启用二改: Scene 已是原版时不覆盖用户设置" || bad "用户设置被旧快照覆盖!"
[ ! -d "$FLAG_DIR/backup" ] && ok "未启用二改: 备份目录照样清掉" || bad "备份目录仍在"

rm -rf "$TMP"
echo ""
echo "结果: 通过 $PASS, 失败 $FAIL"
[ "$FAIL" = "0" ] || exit 1
