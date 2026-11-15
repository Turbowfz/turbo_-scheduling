#26.117
- 修复 AsoulOpt 下载"老是网络连接失败": 之前只直连 GitHub, 国内网络间歇性被掐 (API 与 release 资产两条链路都会中招); 现在三级链路兜底 —— GitHub 直连 (优先) → gh-proxy.com 加速镜像 (API+资产, 实测 2.0s/1.2s) → ghproxy.net 镜像 (仅资产) → GitCode 自动镜像 (独立 CDN, 仅资产, 实测 0.65s); 每级带重试; 10 个候选镜像实测仅 2 存活 (ghfast/moeyy/ghps/llkk/ghp.ci 等已死, 不引入白耗等待); 跳过提示改口说明"直连/镜像均已尝试"; curl 加 -f, HTTP 403/502 错误页不再被当成下载结果
