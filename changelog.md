#26.107

- 修复安装日志: ui_print 改用 /system/bin/log 绝对路径 —— 之前 source 公共库后其同名 log() 函数遮蔽了系统命令, logcat 日志一直没写上
