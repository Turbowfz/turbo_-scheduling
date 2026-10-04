#!/system/bin/sh
# 备份范围收窄的本地演练: 用假目录跑 common.sh 里的 scene_cfg_* 三个函数
# (不依赖真机: 只测文件筛选/相对路径/备份-还原往返/老备份清理/还原校验)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
COMMON="$HERE/../模块/Turbo调度26.113/scripts/common.sh"
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
[ "$left" = "./powercfg.sh ./profile.json ./sub2/nested.CONF " ] && ok "老备份清理: 只剩配置类文件" || bad "清理结果不符: $left"
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

rm -rf "$TMP"
echo ""
echo "结果: 通过 $PASS, 失败 $FAIL"
[ "$FAIL" = "0" ] || exit 1
