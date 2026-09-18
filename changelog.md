#26.104
-移除破坏神模式: 删除磁贴 APK 与安装/卸载流程 (安装器不再询问, 开机也不再生成还原副本); 旧版残留 (挂载源/根目录APK/标志文件/package) 在覆盖安装与卸载时自动清理
-模块瘦身: 移除 Devastator.apk 与 scene_config 里为老磁贴保留的 config/ 还原副本, zip 体积 4.65MB → 3.93MB
-新增云更新支持: module.prop 增加 versionCode 与 updateJson, KernelSU/Magisk 管理器内可直接检查并安装新版本 (本版起生效)
