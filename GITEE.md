# 发布到 Gitee + 开启模块云更新

仓库地址: <https://gitee.com/turbowfz/turbo_-scheduling> (已绑定到 `module.prop` 的 `updateJson`)

## 最快路径

| 步骤 | 做什么 |
|---|---|
| 1 | 装 [Git for Windows](https://git-scm.com/download/win),装完重开终端 |
| 2 | `git config --global user.name "名字"` + `git config --global user.email "邮箱"` |
| 3 | 双击本目录的 **`push-gitee.cmd`**,或命令行跑 `push-gitee.cmd turbowfz turbo_-scheduling` |
| 4 | 手机 KernelSU 管理器下拉刷新 → 看到「可更新」即成功 |

`push-gitee.cmd` 会自动做完:绑定仓库地址 → 打包 + 刷新更新清单 → `git init` + 提交 → 配置远程 → 推送(会要你输 Gitee 用户名 + 密码或私人令牌)。

下面是细节说明与排查。

---

## 工作原理

```
手机管理器
   │  读 module.prop 的 updateJson
   ▼
https://gitee.com/turbowfz/turbo_-scheduling/raw/master/update.json
   │  { version / versionCode / zipUrl / changelog / lastUpdated }
   ▼
versionCode 比已安装的大  →  提示可更新  →  从 zipUrl 下载 zip 安装
```

- `versionCode` 由版本号数字拼成:`v26.104` → `26103`,**必须递增**,否则管理器不会提示
- `zipUrl` 指向仓库根目录里那个 `Turbo调度<版本>.zip`(中文名做 URL 编码)
- `changelog` 指向 `changelog.md`,由 `release.js` 从模块的 `Update.md` 顶部版本块自动生成

## 发新版本 (以后每次都这样)

```bash
# 1) 改版本: 模块目录改名 + module.prop 里 version=(如 v26.104)
# 2) 写日志: 模块/Turbo调度26.104/Update.md 顶部加 #26.104 块
# 3) 打包 + 刷新清单 (versionCode 自动换算, changelog 自动抽取)
node release.js
# 4) 提交推送 (zip 一起提交, 它就是更新下载源)
git add -A && git commit -m "v26.104" && git tag v26.104 && git push --tags
git push
# 5) 手机管理器下拉刷新验证
```

旧版本的 zip 可以在 Gitee 网页上删掉,避免仓库越来越大(历史里仍会留着,但至少文件列表干净)。

## 手动流程 (不想用脚本时)

```bash
cd C:\Users\User\Desktop\Turbo调度项目
node set-gitee.js turbowfz turbo_-scheduling       # 绑定仓库地址
node make-zip.js 模块/Turbo调度26.104 备选.zip     # 打包
node release.js --no-build                          # 刷新 update.json / changelog.md
git init && git add -A && git commit -m "v26.104"
git remote add origin https://gitee.com/turbowfz/turbo_-scheduling.git
git push -u origin master
```

## 排查

| 现象 | 原因 |
|---|---|
| 手机浏览器打不开 updateJson 的地址 | 仓库不是公开的,或分支不是 `master`,或路径写错 |
| 不提示可更新 | `versionCode` 没有比已安装的版本大(模块目录、module.prop、update.json 三处版本要一致) |
| 提示可更新但下载失败 | `zipUrl` 指向的文件不存在(历史上就踩过:先前那份 update.json 指向 `Turbo调度27.0.zip`,但仓库里只有 `26.59.zip`) |
| 改了 update.json 没生效 | raw 直链有缓存,等一两分钟或强刷 |
| 推送被拒 | 先用私人令牌当密码;或仓库里已有提交,先 `git pull --rebase origin master` |

## 备选: zip 放发行版附件

若不想让每个版本的 zip 都进 git 历史:

1. 仓库 → 发行版 → 新建发行版,标签填版本号,上传 zip
2. 复制附件下载链接
3. `node release.js --zip-url "<附件链接>" --no-build` 重新生成 update.json
4. 提交推送
