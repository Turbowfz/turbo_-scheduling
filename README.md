# Turbo 调度

一加 / OPPO 骁龙机型的内核调度模块 (KernelSU / Magisk),用二改配置替换 Scene 调度,并把官方风驰云控配置注入应用增强服务 (COSA) 数据库。

> 仅供个人玩机使用。刷机有风险,后果自负。

## 功能

- **二改 Scene 调度**(不限品牌):替换 Scene9 的调度配置(oplus 版仅管日用、通用版日用+游戏全接管),重启后自动切回二改配置;机型目录缺少 oplus 配置时自动降级通用版并提示
- **云控注入**(风驰机型):把官方风驰云控配置(按游戏包名)注入应用增强服务 COSA 数据库,支持渠道服自动映射、开机自动匹配注入,**只注入手机上已安装的游戏**;WebUI 可视化编辑五大配置块(cpu_config / gpa_config / game_zone / thermal_frame / fps_stabilizer),注入=写数据库、保存=写模块 cccf;数据库配置可一键导出为 cccf 文件
- **短视频包名**:自定义短视频场景的调度参数,WebUI 内管理
- **WebUI**:KsuWebUI 载入,提供状态页 / 短视频管理 / 云控编辑(UI 版表单 + 文本版 JSON)/ 设置

## 支持机型

骁龙 8Gen3 / 8Elite / 8Gen5 / 8EliteGen5 的一加与 OPPO 机型;云控注入额外要求带风驰内核(调速器含 scx/hmbird)与 COSA,与通用版二改调度互斥。

## 安装

1. 下载发行版 zip (见本仓库 **发行版** 页面)
2. 在 KernelSU / Magisk 管理器中刷入,按音量键选择要启用的功能
3. **覆盖安装时会提示「是否沿用之前的选项」**,按音量+ 即可保持上次配置(30 秒无操作自动沿用)

云控注入的使用流程:开启后在 WebUI 云控页编辑配置 → 注入数据库 → 重启 COSA 生效;想拿云端最新配置,用「①清除增强服务数据 → 进一次游戏等下发 → 读取云端配置」。

## 模块云更新

本模块支持管理器内直接更新 (KernelSU / Magisk 通用的 `updateJson` 机制):

- `模块/Turbo调度<版本>/module.prop` 里的 `updateJson` 指向本仓库的 `update.json`
- `update.json` 提供 `version` / `versionCode` / `zipUrl` / `changelog` 四个字段
- 管理器比对 `versionCode`(由版本号数字拼成,如 v26.104 → 26103),更大即提示可更新
- 更新用的 zip 就是仓库根目录里的 `Turbo调度<版本>.zip`

发布新版本只需一条命令(自动打包 zip、刷新 `changelog.md` 与 `update.json`):

```bash
node release.js
```

然后 `git add -A && git commit -m "vX" && git tag vX && git push --tags && git push` 即可。

首次绑定仓库 (本仓库已完成):

```bash
node set-gitee.js turbowfz turbo_-scheduling
```

详见 [GITEE.md](GITEE.md)。

## 目录结构

```
├── 模块/Turbo调度<版本>/    模块本体 (刷入这个目录打包出的 zip)
│   ├── customize.sh         安装脚本 (功能选择 / 配置部署)
│   ├── service.sh           开机服务 (Scene 部署 / 云控注入 / 描述自愈)
│   ├── action.sh            管理器操作菜单 (注入/修权限/卸载)
│   ├── scripts/             公共函数 / Scene 部署 / 云控注入 / 包名匹配
│   ├── webroot/             WebUI (KsuWebUI 载入)
│   ├── bin/                 cosa (Rust 数据库工具) + inject + libsqlite3.so
│   └── <SoC 目录>/          各平台 Scene 配置与云控模板
├── cosa-rs/                 cosa 源码 (Rust, 读写 COSA 数据库)
├── release.js               发布助手 (打包 + 刷新 update.json/changelog.md)
├── set-gitee.js             绑定 Gitee 仓库
├── make-zip.js              打包脚本
├── update.json              模块更新清单 (updateJson 指向)
└── changelog.md             更新日志 (管理器内展示)
```

## 构建

### 模块 zip

```bash
node make-zip.js 模块/Turbo调度26.104 Turbo调度26.104.zip
```

`make-zip.js` 会写入显式目录条目(否则部分手机的文件管理器/刷入器会把内部路径显示成扁平的文件名)。

### cosa (Rust)

```bash
cd cosa-rs
cp .cargo/config.toml.example .cargo/config.toml   # 改成自己的 NDK 路径
cargo build --release
cp target/aarch64-linux-android/release/cosa ../模块/Turbo调度<版本>/bin/cosa
```

`cosa` 不启用 rusqlite 的 bundled 特性,而是链接模块自带的 `bin/libsqlite3.so`(3.49.1),并把 rpath 烧成 `/data/adb/modules/Turbo_Scheduling/bin` —— 因此二进制只有约 450KB,且不依赖系统 SQLite。构建所需的 `libsqlite3.so` 与 `sqlite3.h` 放在 `cosa-rs/prebuilt/`。

## 致谢

完整名单见 [模块内的 Thanks_list.md](模块/Turbo调度26.104/Thanks_list.md):@安与的安(部分代码/框架/思路)、@喵喵ski(原版 scene 文件)、@星海亦有岸(部分代码和思路)、@toolfor(云控注入工具)、@ox奈睿(8g3 第五人格云控配置)、@巭孬甭莪(部分思路与 API)。

### 第三方组件

| 组件 | 说明 | 源码 |
|---|---|---|
| `模块/<版本>/bin/inject` | 云控注入工具(enc 解密注入),由 @toolfor 提供 | **不在本仓库**(本仓库只含二进制) |
| `模块/<版本>/bin/libsqlite3.so` | SQLite 3.49.1,`cosa` 与 `inject` 共用 | 公开领域 |
| `模块/<版本>/modules/AsoulOpt.zip` | AsoulOpt 子模块 | 上游项目 |
| `KsuWebUI.apk` | WebUI 载体应用([a13e300/KsuWebUI](https://github.com/a13e300/KsuWebUI)) | 第三方,未纳入本仓库(随发行版 zip 提供) |
| `模块/<版本>/<SoC>/` | 各平台 Scene 调度与云控模板 | 基于官方配置整理 |

仓库内**本项目的代码**以 GPL-3.0 发布(见 LICENSE);上表中的第三方组件版权归各自作者,不在 GPL-3.0 覆盖范围内。
