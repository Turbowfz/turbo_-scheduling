#26.109

- 撤销"覆盖安装时自动卸载设备上的 AsoulOpt (asoul_affinity_opt)"的逻辑: 无法区分该模块是早年随本模块捆绑安装还是用户独立安装, 导致独立安装了 AsoulOpt 的用户升级时被误删 —— 现在起本模块不自动卸载用户已安装的任何其它模块; 被误删的用户请从 AsoulOpt 原发布页重新安装
- AsoulOpt 安装选项回归 (选择二改调度通用版后询问): 不再随包捆绑, 改为直连 GitHub 从 nakixii/Magisk_AsoulOpt 最新 release 下载后调用 root 管理器安装 (KernelSU=ksud / Magisk=magisk, 自动适配); 带 sha256 完整性校验, 失败不保留安装包, 不清理旧版 (由管理器覆盖安装); 设备上已安装同版本或更新版本时自动跳过询问 (不降级), 云端不可达时跳过且不阻塞安装流程
