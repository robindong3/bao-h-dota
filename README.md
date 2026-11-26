# 保h大队

Dota 2 群友内战记录站。支持截图粘贴、拍照上传、识别与校对、比赛 ID 去重、玩家认领和个人战绩。仓库以空战绩启动，可通过上传或校对录入自己的比赛。

## 本机运行

安装 Python 3.10 或更新版本，在项目根目录运行 `python server.py`，然后打开 `http://127.0.0.1:19374`。默认可以手动录入。Windows 双击 `启动保h大队.cmd` 可启用本机 Codex 识别，需事先登录 Codex CLI。识别字段定义放在 `.agents/skills/dota-match-extraction/`。更新官方英雄头像需要 Pillow。

## 部署到 Cloudflare

用项目根目录的 `functions/` 和 `dist/` 部署到 Cloudflare Pages。在 Pages 绑定 KV 命名空间为 `SCREENSHOTS`，将识别进程共用的随机密钥配为 `AGENT_KEY`。部署自己的自定义域名时，把 `cloudflare/apex.mjs` 的 Pages 地址、页面备用入口和 Pages Functions 中允许的备用线路来源改为你的域名。

在本机建立 `data/.agent-key`，填入同一个密钥。将 `DOTA_AGENT_URL` 设为 Pages 站点地址，再运行 `python recognition_agent.py`。识别进程主动从 Cloudflare 领取截图。电脑离线时截图会等待处理，队列和识别结果保留一天。

群友上传收到回执后可继续上传。站长从本机管理页 `http://127.0.0.1:19374/#upload` 刷新收件箱、校对、确认，然后发布已确认对局。发布后全群共享对局和排行榜。认领记录仅保存在提交认领的浏览器。

发布需要 Node.js 以及已登录的 Wrangler。默认在项目的 `node_modules` 中查找 Wrangler；可以设定 `DOTA_WRANGLER_DIR` 使用其他安装目录。如需指定 Wrangler 登录配置目录，设定 `DOTA_WRANGLER_CONFIG_HOME`。设定 `DOTA_PAGES_PROJECT` 可发布到自己的 Pages 项目。已确认对局保存在忽略提交的 `data/owner/` 下；发布时会生成 `dist/published-matches.js` 和对应截图，实际数据请留在用于运营的工作副本。

## 验证

运行 `node check.cjs`，用合成数据验证统计、排序、合并和页面路由。部署前再用自己的测试图走一遍上传与识别。
