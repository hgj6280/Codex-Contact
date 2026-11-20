# QQ 群友的视频总结

这是现有 Agent 内的可选模块：复用当前原生 QQ/OneBot 接入、消息权限、人格、选中的文字模型及聊天发送系统。未新增机器人、虚拟机、OpenClaw 进程或技能依赖。现有 Gemini 路由的配置读取方式原样保留；不启动网页桥接。普通聊天、图片和语音流程保留；视频接收确认与长总结使用文字。

## 使用

所有原本允许 AI 回复的群均可明确请求总结，默认不自动总结分享链接。全局 AI、会话 AI、群白名单、机器人禁言和发送者限制继续有效。

```
@机器人 总结 BV1JqxT6HEkc
@机器人 总结 https://www.bilibili.com/video/BV1bK411W797/?p=2
@机器人 看看这个视频讲了什么 https://youtu.be/jNQXAC9IVRw
@机器人 总结一下 <整段抖音分享文案>
```

引用真实视频分享消息后说“@机器人 总结这个”也可。仅使用适配器实际取到的文字、引用和 JSON/XML 分享字段；没有链接就提示补发。默认只处理一个视频；多个候选请用户指定，不展开合集或播放列表。B站默认第1P，多P会显示当前P/总P数，字幕/音频和来源指向相同分P。弹幕和直播聊天不能充当字幕。

完成后引用对应总结或追问回复继续问“屏幕怎么样？”“第二点是什么意思？”“只讲结论”“列操作步骤”。未引用时使用本账号、本会话近2小时的视频正文；有多个不同视频会先确认。引用已关联的视频回复可使用仍在保留期内的正文。长正文按问题、时间点和邻近段落检索；正文不充分就说明不能确认。正文到期后仍可读历史摘要，但不能假装继续检索。

```
/视频 状态 <任务前8位>
/视频 结果 <任务前8位>
/视频 正文 <任务前8位>
/视频 取消 <任务前8位>
/视频 重试 <任务前8位>
/视频 开启自动总结
/视频 关闭自动总结
```

取消、重试只限提交者；自动总结开关限现有本机控制者/管理员身份，在目标群执行。自动总结关闭时明确请求仍可用。`正文`命令只发标明范围的前段，避免刷屏；完整正文可通过受控工具读取。失败会解释网络、登录/验证、视频不可访问、解析不兼容、下载/时长限制、转写失败等原因，没有真实正文不会调用模型编总结。

## 模块与工具

- `qq-video-input.mjs`：平台链接、裸 BV、分P、复制分享文案、真实引用和触发解析。
- `qq-video-jobs.mjs`：SQLite 持久队列、缓存、上下文、额度、取消/重试、投递状态。
- `qq-video-worker.mjs` / `.py`：受控子进程，成熟下载器取字幕或完整音频，再本地 ASR；无 shell 拼接。
- `qq-video-network.mjs`：固定平台/CDN、每跳代理出口检查、公共 IP 校验与固定 IP 连接；拒绝本机、内网、元数据、非标准端口和任意站点。
- `qq-video-summary.mjs`：全部转录分段总结再合并，追问检索真实正文；清除 CQ/附件指令。
- `qq-video-model.mjs`：Codex 总结路径移除执行、文件/图像工具、应用、浏览器、记忆及多代理，忽略额外配置和规则。Gemini 用现有文字请求，无工具；遇到瞬时 503、超时等可恢复故障时，复用现有线路健康状态，转入同样隔离的 Luna 总结请求，不调用日常聊天的可执行工具路径。安全拒绝、永久权限错误和用户取消不会触发备援，不改变聊天默认模型。
- `qq-video-tools.mjs`：`video_submit`、`video_status`、`video_read`、`video_cancel`、`video_ask`。当前项目用会话命令分发，工具模块接到同一个分发器；没有另建一个通用自主执行 Agent。

账号、群/私聊、发起人、原消息由接收层绑定。工具不接收自填群号、账号、命令、文件路径。读取和追问限制到同一 QQ 账号及同一会话；缓存另外区分平台、输入视频标识、分P、公开/专用凭据范围以及摘要风格/当前模型。不同短链与完整链接可能未命中相同摘要缓存，但不能串群或越权复用。

本机管理接口（既有服务3789端口，不开放远程调用）：

| 接口 | 用途 |
|---|---|
| `GET /api/qq/videos/settings` | 配置、revision、排队/运行数量 |
| `POST /api/qq/videos/settings` | 携带最新 revision 更新；参照同目录配置示例 |
| `GET /api/qq/videos/tools` | 工具描述 |
| `GET /api/qq/videos/jobs?conversationId=20011` | 当前绑定账号、指定授权会话的任务 |
| `POST /api/qq/videos/tools` | 本机操作者工具调用；由服务绑定身份并校验会话，submit/ask 会真实发送接收确认或回答 |

例：`{"conversationId":"20011","name":"video_submit","input":{"url":"https://www.bilibili.com/video/BV1JqxT6HEkc/","style":"normal"}}`。不要用本机操作接口伪造“群友真实入站测试”；它有单独的 `local-video-tool-...` 原消息标识。

## 持久化与资源

`~/Library/Application Support/CodexRemoteContact/data/qq-videos/jobs.sqlite` 保存任务、转录、摘要、引用关联、缓存和配置。任务处理状态与 `delivery` 分开；每个已受理消息保存 QQ message ID、回读标记。发送结果未知不会自动重发。重启时未完成计算可恢复，发送中的未知结果只保留待确认状态。QQ 未确认接收确认的任务不开始工作，5分钟后失败，避免永久占队。

默认并发1（可调1–2）、每群同时1个，最长30分钟视频、96MB下载、15分钟任务超时，每人每天5次、每群20次；均可配置。普通聊天不占视频队列。ASR 低优先级、CPU int8单线程，任务结束退出，不常驻加载。独立依赖+基础 ASR 模型本机实测约425MB磁盘；不是零开销，转写时仍会占CPU和内存。

音视频临时目录仅限该模块拥有的 `tmp/video-*`，任务结束即清理，启动还清理超过6小时的残留。缓存24小时；正文默认30天，每小时空闲清理到期正文，保留任务和历史摘要；SQLite空页复用，不在聊天时全库VACUUM。不触碰聊天记录、角色库、素材或生图归档。

## 安装、启动、更新与回滚

在原项目目录运行，使用现有 Node24 与 Homebrew ffmpeg。设置脚本借现有 `voice-runtime/venv/bin/python` 创建**独立**视频 venv，不改语音或系统 Python 依赖。

```sh
node scripts/setup-video-runtime.mjs
node scripts/deploy-local-services.mjs
launchctl kickstart -k gui/501/local.codexremotecontact.chat-hub
```

更新先检查聊天/生图/草稿/语音/视频队列空闲；只重启 Hub，不重启原生 QQ，不需重新扫码。日常仍使用原来的狐宫静 QQ App/桌面开关。模型不另配密钥：沿用当前文字模型选择；视频调用的 token 进入原用量账本。

回滚代码，不移动共享数据：

```sh
node scripts/rollback-local-services.mjs --list
node scripts/rollback-local-services.mjs --release release-AJYHaa
```

`release-AJYHaa` 是本次视频功能之前保留的本机版本。脚本校验发布清单，确认各队列空闲，原子切换服务代码并只重启 Hub；不会删数据库、QQ登录、聊天、素材或角色库。若服务状态不可查询，脚本会拒绝盲目回滚，应先恢复管理连接。发布目录独立于云盘源码，继续保留本地启动机制。

可选 Cookie：默认三个平台都不使用凭据。需要时只由管理员创建 `video-runtime/credentials/<平台>.cookies.txt`（Netscape格式、权限600），再开启对应 `useDedicatedCookies`。不读取日常浏览器、QQ、B站后台的 Cookie；凭据不送模型或群里。不绕过DRM、付费或私人视频权限。

## 验证与限制

见 `qq-video-acceptance-2026-11-01.md`，区分离线测试、真实内容获取、本机操作者通过QQ通道发送，以及真实群友入站。B站已完成真实ASR→总结→原群发送及正文追问；国内抖音、YouTube 的适配已实现并尝试真实获取，但当前环境尚未通过，不能当作三平台均成功上线。

第一阶段没有视频帧分析；回复必须注明仅基于字幕/音频。ASR可能听错人名、品牌、数字；对准确值应回听对应时间点。长视频全文分块，超过正文处理上限会失败，不冒充总结全片。字幕接口失败、无字幕、需登录和字幕不完整分别记录；字幕不可用时才走整段音频转写。

依赖采用 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（含 Bilibili、Douyin、YouTube 适配）和 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)。版本固定在设置脚本：yt-dlp2026.10.26、faster-whisper1.2.1、av16.1.0、undici8.12.3；固定 av 是为避免新版解码接口与该 faster-whisper 不兼容。ASR使用 Systran/faster-whisper-base，首次安装下载，运行时离线使用。
