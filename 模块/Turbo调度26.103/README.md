# Turbo调度

骁龙 8 Gen3 / 8 Elite / 8 Gen5 / 8 Elite Gen5 设备的 Scene 调度模块,**不限品牌**,基于 KernelSU / Magisk / APatch。
云控注入面向所有**带风驰内核**(调速器含 scx/hmbird)的机型,依赖应用增强服务(COSA);云控与通用版二改调度互斥(选通用版即无云控),无风驰的设备自动使用通用版。

## 功能

- **二改 Scene 调度**(不限品牌):替换 Scene9 的调度配置(oplus 版仅管日用、通用版日用+游戏全接管),重启后自动切回二改配置;机型目录缺少 oplus 配置时自动降级通用版并提示
- **云控注入**(风驰机型):把官方风驰云控配置(按游戏包名)注入应用增强服务 COSA 数据库,支持渠道服自动映射、开机自动匹配注入(只注入手机上已安装的游戏);WebUI 可视化编辑五大配置块(cpu_config / gpa_config / game_zone / thermal_frame / fps_stabilizer),注入=写数据库、保存=写模块 cccf;数据库配置可一键导出为 cccf 文件
- **短视频包名**:自定义短视频场景的调度参数,WebUI 内管理

## 安装要求

1. 正版 Scene9 并开启过 LP 调度(二改调度依赖;纯云控注入可不装)
2. KernelSU / Magisk / APatch 任一管理器
3. 支持的 SoC:骁龙 8 Gen3 (SM8650) / 8 Elite (SM8750) / 8 Gen5 (SM8845) / 8 Elite Gen5 (SM8850);品牌不限
4. 云控注入额外要求设备带风驰内核(scx/hmbird)与 COSA;与通用版互斥

安装过程用音量键选择功能组合;所有询问均带超时,adb / OTA 等无人值守刷入不会卡死(超时按提示中的默认项处理)。

## 目录结构

```
├── customize.sh          安装脚本(选功能/部署/清理)
├── service.sh            开机服务(Scene 部署时机 + 云控注入)
├── post-fs-data.sh       早启动(状态目录迁移 + 卸载还原守护)
├── action.sh             管理器操作菜单(注入/修权限/卸载)
├── uninstall.sh          卸载清理(主动还原 Scene 配置)
├── scripts/
│   ├── common.sh         公共函数库(按键/日志/SoC判定/官方调度开关)
│   ├── scene_config.sh   Scene 配置部署与还原
│   ├── cloud_ctrl.sh     云控注入流程(json→cosa sync, enc→inject)
│   ├── pkg_matcher.sh    游戏包名匹配 + 渠道服映射
│   ├── asoul_install.sh  AsoulOpt 子模块安装
│   └── whitelist.conf    渠道服白名单映射(用户可编辑)
├── bin/                  cosa(COSA 数据库工具, Rust) + inject(enc 解密注入) + libsqlite3.so(自带库, cosa/inject 共用)
├── <SoC目录>/             各平台 scene 配置与云控模板(8gen3/8elite/8gen5/8elitegen5)
└── webroot/              WebUI(KsuWebUI)
    ├── core.js           公共层:路径常量 / root exec / 写入校验
    ├── status-page.js    状态页    ├── pkg-page.js  短视频包名页
    ├── cloud-io.js       云控数据IO(读取/注入/备份)
    ├── cloud-form.js     云控基础版表单(渲染/收集)
    ├── cloud-page.js     云控页骨架(日志/绑定)
    ├── settings-page.js  外观设置  ├── nav.js       导航/主题/震动
    └── glass-style.css   液态玻璃样式
```

## WebUI 说明

- **自定义背景**:把任意图片重命名为 `webui.jpg` 替换即可,两种方式任选——
  刷入前:放进模块包的 `webroot/` 文件夹再打包;已刷入:替换设备上的 `/data/adb/modules/Turbo_Scheduling/webroot/webui.jpg`(建议竖屏图,分辨率接近手机屏幕)
  替换后重新打开 WebUI 生效;临时切换可用 WebUI 内"关于 → 外观设置"的"默认壁纸 / 纯色"按钮,背景可见度和玻璃模糊度也在同一页调节
- 云控页"注入"写入 COSA 数据库(重启 COSA 生效),"保存"写入模块 cccf(开机注入用),两者保存前均自动备份(cccf_backup,每文件保留 10 份)
- 基础版表单覆盖五大配置块并带中文参数注释;thermal_frame 统一标准格式,重置按钮一键恢复官方档位

## 致谢

见 [Thanks_list.md](Thanks_list.md)。
