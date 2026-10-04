#!/system/bin/sh
# enc 路径真机实测 (需 root): 借一个已安装游戏的包名放入 .enc, 跑完整注入, 最后自动还原。
# 用法 (设备上): sh enc_live_test.sh <测试用.enc 路径>
#   注入走 cosa enc (自研解密), 不再需要外部注入器二进制。
# 全程自动还原: 备份受影响的行、还原 json、删除测试产生的行。
M=/data/adb/modules/Turbo_Scheduling
T=/data/local/tmp/enc_test
ENC_SRC="$1"
PKG=com.tencent.tmgp.sgame
C() { LD_LIBRARY_PATH=$M/bin "$M/bin/cosa" "$@"; }

[ -f "$ENC_SRC" ] || { echo "用法: $0 <测试用.enc>"; exit 1; }
rm -rf $T; mkdir -p $T
echo "--- 0) 基线 ---"
C list > $T/before.txt 2>&1; echo "  包数: $(wc -l < $T/before.txt)"

echo "--- 1) 备份 $PKG 的行 + 移走同名 json + 放入 .enc ---"
C read $PKG > $T/$PKG.bak.json 2>&1 && echo "  已备份 ($(wc -c < $T/$PKG.bak.json) 字节)"
mv $M/cccf/$PKG.json $T/ && echo "  同名 json 已移走"
cp "$ENC_SRC" $M/cccf/$PKG.enc && echo "  .enc 已放入 ($(stat -c%s $M/cccf/$PKG.enc) 字节)"

echo "--- 2) 跑完整注入 ---"
sh $M/scripts/cloud_ctrl.sh inject 2>&1 | sed -n '/注入 .enc/,/enc 注入完成/p'

echo "--- 3) 结果 ---"
C list > $T/after.txt 2>&1
echo "  新增的包: $(comm -13 $T/before.txt $T/after.txt 2>/dev/null | tr '\n' ' ')"
C diag 2>&1 | tail -3

echo "--- 4) 还原 ---"
rm -f $M/cccf/$PKG.enc; mv $T/$PKG.json $M/cccf/ && echo "  json 已还原"
for p in $(comm -13 $T/before.txt $T/after.txt 2>/dev/null); do
  case "$p" in $PKG) ;; *) C delete "$p" >/dev/null 2>&1 && echo "  已删除测试行: $p" ;; esac
done
C sync $M/cccf >/dev/null 2>&1 && echo "  已重新注入我们的配置"
C read $PKG > $T/now.json 2>&1
if [ -s $T/$PKG.bak.json ] && [ "$(wc -c < $T/$PKG.bak.json)" = "$(wc -c < $T/now.json)" ]; then
  echo "  $PKG 行已恢复到注入前大小 ($(wc -c < $T/now.json) 字节)"
else
  echo "  注意: $PKG 行大小 备份=$(wc -c < $T/$PKG.bak.json) 现在=$(wc -c < $T/now.json)"
fi
echo "--- 5) 最终 ---"
C diag 2>&1 | tail -3
