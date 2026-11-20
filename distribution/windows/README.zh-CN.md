# QQ 群友 Windows 安装包 1.1

## 类 QQ 聊天界面

已整合另一会话的类 QQ 网页聊天界面。`Start.cmd` 启动后默认打开聊天页；后台已运行时用 `Chat.cmd` 打开，`ControlPanel.cmd` 打开原控制面板。

地址：http://127.0.0.1:3789/desktop.html 。包含好友/群列表、搜索、文字与图片发送、引用、真正的 @成员、AI 草稿预览、模型设置、夜间模式和群管理。群管理仍须 QQ 实际权限；仅显示服务收集的聊天记录，不导入官方 QQ 全部历史。手动聊天联系人与 AI 自动回复白名单是不同范围，不得因为联系人可见就放开 AI 白名单。

Windows 使用浏览器，不包含 Mac 原生 App。关闭浏览器不会停止后台；停止用 `Stop.cmd`，恢复用 `Start.cmd`，归档在 `runtime/images`。扫码用 `Login.cmd` 查看本机登录凭证；系统入口不会调用 Mac 命令。

适用于 Windows 11 x64 掌机/电脑。这是可解压安装的源码包和一键脚本，不是签名 EXE，不是离线整合包。需要联网下载安装依赖。Node.js 24+、Docker Desktop（Linux containers / WSL2）和 Codex CLI 是运行依赖；首次 WSL2 配置可能需要管理员及重启。Windows ARM 掌机暂不作为已支持目标。

## 安装

1. 解压到 `C:\QQFriend` 或用户本地目录，避开 OneDrive、中文用户名不是禁止项，但路径建议简单。不要直接在 ZIP 中运行。
2. 安装 Node.js 24 LTS 和 Docker Desktop，启动 Docker Desktop，确认 `docker info` 成功。可执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -InstallDependencies` 安装依赖；Docker/WSL2 的首次启动和必要重启由系统引导完成，再运行脚本。
3. 将 `config.example.json` 复制为 `config.local.json`，填写机器人普通 QQ 号、可私聊的 QQ 号、群号。默认白名单为空；不要把管理者 QQ 和机器人 QQ 混为一谈。默认模型 `gpt-5.6-luna`，思考强度 low；实际模型权限以登录账号为准。
4. 在包目录运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -ConfigFile .\config.local.json
   ```

   安装程序输出本机 Codex launcher 路径。按提示运行 `node "实际launcher路径" login`，登录自己的 ChatGPT/Codex 账号。登录由本人完成，agent 不复制他人 auth.json。
5. 双击 `Start.cmd`，保持窗口打开。双击 `Login.cmd`，将该窗口展示的本机 WebUI token 填入 NapCat 管理登录页，随后用机器人 QQ 手机扫码确认。
6. 控制面板地址 http://127.0.0.1:3789 。用授权私聊 QQ 发“测试，请回复 QQ_OK”，再在白名单群 @机器人测试；提到“狐宫静”也可触发。测试一张照片，确认实际图片在 QQ 内出现。

可选：安装时加 `-AutoStart` 创建当前用户登录后的计划任务。仍需 Docker Desktop 随登录启动；电脑休眠、掌机断网时不会持续在线。`Stop.cmd` 停止当前运行实例及本包容器，下次启动会保留会话。

## 功能与限制

保留目前项目的 QQ 控制面板、模型切换、群/私聊白名单、软萌“狐宫静”人设、@发送者、关键词触发、限定群的跑团联动、图片消息和消息记忆。人设在 `app/data/qq-soul.md`，每条新请求读取；跑团默认关闭，在安装配置里显式填写群与参与者后启用，最多 10 条。群白名单从面板保存时同步更新桥接。

带上角色基础参考图和夏日参考图；不带个人聊天记录、账号凭证、联系人、原 Mac 白名单和海量表情包。需要的表情包自行放入 `app/data/qq-stickers`。生成图片依赖目标 Codex CLI 的 imagegen 能力；仅安装 CLI 不等于已有该工具。可选 OCR 需要另行安装 Tesseract 与 chi_sim/eng 语言数据，设置 `QQ_TESSERACT_PATH`。没有这些工具时不要宣称生图/文字校验已经验证。

macOS 的 iMessage、系统操作、VPN、AppleScript 不在本版部署范围。Gemini 浏览器桥接未随包提供。QQ 普通账号仍占用电脑端会话，另一个电脑 QQ 登录同一账号可能挤掉机器人；建议专用小号。不能通过复制此包消除 QQ 服务器的会话限制。

## 配置与升级

配置、QQ 登录数据在 `app/modules/qq-napcat/state`；Hub 配置在 `app/data/settings.json`；运行日志和临时文件在 `runtime`。升级前停止服务并备份这三个目录。初始化不会覆盖已有文件；重新传 `-ConfigFile` 不会覆盖旧白名单和密钥。修改已有私聊白名单须同步修改 bridge.json 与 Hub 的 ownerUserIds；ownerUserIds 是管理员权限，不能随意扩展。面板修改群号会自动同步。

`compose.yaml` 初始使用 upstream latest，首次部署后记录并固定实际镜像 digest；安装脚本不会在每次启动自动拉新镜像。没有启用公网监听。不要将 state、launch.json、日志或自己的 config.local.json 发给别人。此包仅用于私人交付，公开再发布前核对上游代码和角色图授权。

## 故障排查

- 面板打不开：查看 `runtime/logs/hub.log`，确认 3789 未被其他程序使用，Node >=24。
- 桥接：`Invoke-RestMethod http://127.0.0.1:3000/health` 的 connected 仅表示 OneBot 连接，QQ 真在线必须看 `/get_status` 的 data.online。
- QQ 登录失效：打开 `Login.cmd`，刷新 NapCat QR，再扫码。若被另一终端挤下线，关掉同账号电脑 QQ。
- Codex 不支持模型/参数：根据实际 CLI 帮助和账号模型列表调整，先直接做一个 QQ_OK 调用；禁止靠伪造状态通过验收。
- 运行锁残留：任务管理器确认本包 node 实例都已停止，再删除本包 `runtime/run.lock`。不要结束其他 agent 的 node 进程。

## 验证范围

开发机验证：打包清单、隐私排除、JS 语法、Linux/macOS Node 隔离启动及 HTTP 配置接口。没有 Windows 实机或掌机实测，PowerShell、Docker Desktop、计划任务及 Windows 图片压缩需要在目标机器验收。收到 QQ 实际回复和图片之后才能称部署完成。

参考：[NapCat Docker](https://github.com/NapNeko/NapCat-Docker)、[Docker Desktop Windows 安装](https://docs.docker.com/desktop/setup/install/windows-install/)、[Codex CLI](https://github.com/openai/codex)。
