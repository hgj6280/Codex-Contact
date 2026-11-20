# 给 Codex 胡总 / 其他 agent 的部署任务

1.1 版包含类 QQ 聊天界面。Start.cmd 默认打开 desktop.html，Chat.cmd 和 ControlPanel.cmd 分别打开聊天/控制面板。验收列表加载、会话切换、图片展示、授权会话手动文字/图片发送与 @成员；发送必须拿到真实消息编号并在 QQ 确认。关闭浏览器应保留后台。不要将手动聊天范围扩大为 AI 自动回复范围。Mac 原生壳不在 Windows 包内。

请在这台 Windows 11 x64 掌机部署当前解压目录的 QQ 群友安装包。完整阅读 README.zh-CN.md、setup.ps1、initialize.mjs 和 config.example.json 后执行。不要安装到 OneDrive 同步目录。核对 MANIFEST.json 哈希；安装脚本可传 -ConfigFile，实现无人值守配置。

部署前从用户获得：机器人 QQ 号、管理者/私聊白名单 QQ、群号及可用模型。缺少账号选择时保持白名单为空，不沿用其他机器的数字。用户 QQ 登录、ChatGPT 登录及 Windows 管理员/重启弹窗需本人完成；其余安装配置、启动、故障检查由你继续执行。不要把登录 token 或凭据输出到聊天，Login.cmd 仅给本地人看。

执行顺序：
1. 校验 Windows 架构、Node >=24、WSL2 / Docker Desktop Linux 后端、3789/3000/3001/6099 端口占用。不杀无关进程。需要依赖时运行 setup.ps1 -InstallDependencies；首次 Docker/WSL 初始化完成再重跑。
2. 用用户参数创建 config.local.json。运行 setup.ps1 -ConfigFile .\config.local.json。对现有安装先备份，仅首次生成配置；已存在配置需最小修改，并同步 bridge.json 的 allowedUsers/allowedGroups 与 Hub settings.json 的 ownerUserIds/allowedGroups。
3. 使用 npm 安装的 Codex launcher 执行 login，等待用户完成登录。阅读实际 `node "launcher路径" exec --help`；若安装的发行版不支持包里的 --ignore-user-config / --ignore-rules 等参数，在 app/src/server.js 中仅删不支持的选项，保留 read-only 沙箱与授权限制，做直接模型 smoke test。
4. Start.cmd 后打开 Login.cmd，让用户扫码 QQ。不要公开密钥。`/get_status` 必须 data.online=true；仅容器 up、health.connected 或页面 HTTP200 不算 QQ 恢复。
5. 让用户用白名单私聊发 QQ_OK、群里 @和关键词各发一次，检查真实回复。再请求发送已有图片，检查图片真实送达。确保其他群和未授权私聊不触发；不通过测试向无关群发消息。
6. 验证面板保存模型和群白名单、重启保留数据；跑团若启用验证目标 @、10条限制、停止。收集依赖版本及 NapCat image digest，固定 compose 镜像。可选配置 -AutoStart，验证任务只启动本包并且睡眠唤醒后可重新连接。
7. 输出安装路径、版本、监听地址、已验证结果与尚未验证项。不得把 Windows 端未测试的功能说成成功。不要修改原 Mac 服务，不要拷贝源 Mac 的 state、数据库、auth.json、cookies、会话日志。

本包是当前项目的 Windows 适配快照，包含源码便于你修复目标机器差异。保留 Node shell 参数数组，禁止改成把用户消息拼进 shell 命令。保持本机绑定、白名单和图片目录限制。
