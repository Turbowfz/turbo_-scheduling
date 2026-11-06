#26.115
- 修复配置页添加包名报 "sh: can't create .../categories.json: No such file or directory": 二改调度的部署旗帜还在, 但 Scene 后来被卸载或清了数据, 数据目录一没所有写入就撞裸 sh 错误; 现在写前先探测 Scene 数据目录 —— Scene 没装给出一键照做的提示, 装了但目录缺 (清数据/没打开过) 自动补建并归还属主, 三处入口 (加载/添加/删除) 全部守住, 不再吐天书
