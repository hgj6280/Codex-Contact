# 本机管理接口清单

核查基线为 `cd952b9`。下表列出修改前没有校验请求 key 的已实现入口。“前缀”与每个用空格分开的后缀拼为完整路径；尖括号表示受格式限制的路径参数。部分路由另有本机来源、会话、操作角色、请求方式或资源归属校验。

| 服务与前缀 | 缺少 key 校验的路径后缀 |
|---|---|
| Hub `/api/` | `state maintenance memory memory/clear channel imessage/trusted-handles imessage/reply-handle unified-memory/settings` |
| Hub `/api/qq/` | `event roleplay model expert-model groups memory/clear validation-reports validation-report/<id> memewiki send-budget knowledge group-digest group-digest/run triggers fast-mode image-model conversation-ai personality personality/default` |
| Hub `/api/qq/` | `chats chat/<conversation> chat/sync chat/requests chat/manage chat/group/<id> chat/lookup/<id> chat/desktop-state chat/recover-login chat/conversations chat/stickers chat/sticker/<name> chat/draft chat/draft/<id> chat/restore/<conversation>/<message> chat-media/<hash.ext> chat/image/<hash> chat/send` |
| Hub `/api/qq/` | `autonomy autonomy/test-private autonomy/test-conversation companion/settings companion/memories companion/archive videos/settings videos/jobs videos/tools image-search/settings image-search/history` |
| Hub `/api/qq/` | `roles roles/library roles/builtin/image/<index> roles/image/<id>/<index> roles/export roles/import` |
| Hub `/api/life/` | `avatar state settings live2d live2d/install voice voice/audio/<name> voice/settings voice/speak voice/qq-preview voice/cancel` |
| Hub `/api/life/` | `bili/social bili/read bili/discover bili/reflect bili/draft bili/publish pet/jobs/<id> pet/chat pet/ack pet/ping pet/test` |
| QQ 桥接 `/` | `health get_login_info get_status get_image get_msg get_forward_msg get_group_list send_group_msg send_private_msg` |
| Hub 静态站点 | `/` 与站点提供的全部 HTML、脚本、样式、媒体和桌宠资源 |

原先已有专用 key 检查的入口为 Hub 的 `/api/onebot/check`、`/api/onebot/event`、`/api/qq/chat/incoming`、`/api/life/bili/connect`，以及桥接的 `/desktop/*` 动作。OneBot WebSocket 有独立凭据。当前 Mac 使用 SnowLuma，没有发现 NoneBot 的 8080 监听。

## 本机登录

桌面客户端在 WebKit 收到本机 Hub 的认证挑战时读取已有凭据。普通浏览器打开 http://127.0.0.1:3789/ ，用户名为 `qq`，密码取自 `~/Library/Application Support/CodexRemoteContact/napcat-state/desktop.key`。可以用以下命令复制到本机剪贴板，避免把凭据打印进终端记录。

```sh
pbcopy < "$HOME/Library/Application Support/CodexRemoteContact/napcat-state/desktop.key"
```

服务间请求通过 `x-qq-desktop-key` 传递凭据。Hub 与桥接均绑定 IPv4 回环；各路由原有会话、角色和专用调用方检查继续生效。浏览器凭据仅用于 Hub，不要输入到 SnowLuma、noVNC 或第三方站点。


## 2026-11-20 运行复核

Hub 和旧 NapCat 兼容桥接的鉴权均位于 HTTP 路由分发之前。下表为逐路径检查，动态路径使用虚构参数。前缀及静态资源也作为探针，四列均为实际 HTTP 状态码。携有效凭据的验证只调用只读接口。

| 监听端口 | 路径 | 无 key GET | 无 key POST | 错 key GET | 错 key POST |
|---|---|---:|---:|---:|---:|
| 3789 | `/` | 401 | 401 | 401 | 401 |
| 3789 | `/api/channel` | 401 | 401 | 401 | 401 |
| 3789 | `/api/imessage/reply-handle` | 401 | 401 | 401 | 401 |
| 3789 | `/api/imessage/trusted-handles` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/avatar` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/bili/connect` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/bili/discover` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/bili/draft` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/bili/publish` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/bili/read` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/bili/reflect` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/bili/social` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/live2d` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/live2d/install` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/pet/ack` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/pet/chat` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/pet/jobs/sample` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/pet/ping` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/pet/test` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/settings` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/state` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/voice` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/voice/audio/sample.wav` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/voice/cancel` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/voice/qq-preview` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/voice/settings` | 401 | 401 | 401 | 401 |
| 3789 | `/api/life/voice/speak` | 401 | 401 | 401 | 401 |
| 3789 | `/api/maintenance` | 401 | 401 | 401 | 401 |
| 3789 | `/api/memory` | 401 | 401 | 401 | 401 |
| 3789 | `/api/memory/clear` | 401 | 401 | 401 | 401 |
| 3789 | `/api/onebot/check` | 401 | 401 | 401 | 401 |
| 3789 | `/api/onebot/event` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/autonomy` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/autonomy/test-conversation` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/autonomy/test-private` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat-media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/20001` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/conversations` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/desktop-state` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/draft` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/draft/00000000-0000-4000-8000-000000000000` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/group/20001` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/image/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/incoming` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/lookup/10001` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/manage` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/private:10001` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/recover-login` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/requests` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/restore/20001/1` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/restore/private:10001/1` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/send` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/sticker/test.webp` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/stickers` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/storage` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/storage/rollback` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chat/sync` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/chats` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/companion/archive` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/companion/memories` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/companion/settings` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/conversation-ai` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/event` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/expert-model` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/fast-mode` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/group-digest` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/group-digest/run` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/groups` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/image-model` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/image-search/history` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/image-search/settings` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/knowledge` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/memewiki` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/memory/clear` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/model` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/personality` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/personality/default` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/roleplay` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/roles` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/roles/builtin/image/0` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/roles/export` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/roles/image/00000000-0000-4000-8000-000000000000/0` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/roles/import` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/roles/library` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/send-budget` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/triggers` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/usage/breakdown` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/usage/timings` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/validation-report/00000000-0000-4000-8000-000000000000` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/validation-reports` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/videos` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/videos/jobs` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/videos/settings` | 401 | 401 | 401 | 401 |
| 3789 | `/api/qq/videos/tools` | 401 | 401 | 401 | 401 |
| 3789 | `/api/state` | 401 | 401 | 401 | 401 |
| 3789 | `/api/unified-memory/settings` | 401 | 401 | 401 | 401 |
| 3789 | `/client.js` | 401 | 401 | 401 | 401 |
| 3789 | `/desktop.html` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_friend_list` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_group_info` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_group_list` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_group_member_info` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_group_member_list` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_login_info` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_send_budget` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_status` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/get_stranger_info` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/recover_login` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/send_group_msg` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/send_private_msg` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_friend_add_request` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_group_add_request` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_group_admin` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_group_ban` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_group_card` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_group_kick` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_group_name` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_group_whole_ban` | 401 | 401 | 401 | 401 |
| 3000 | `/desktop/set_send_budget` | 401 | 401 | 401 | 401 |
| 3000 | `/get_forward_msg` | 401 | 401 | 401 | 401 |
| 3000 | `/get_group_list` | 401 | 401 | 401 | 401 |
| 3000 | `/get_image` | 401 | 401 | 401 | 401 |
| 3000 | `/get_login_info` | 401 | 401 | 401 | 401 |
| 3000 | `/get_msg` | 401 | 401 | 401 | 401 |
| 3000 | `/get_status` | 401 | 401 | 401 | 401 |
| 3000 | `/health` | 401 | 401 | 401 | 401 |
| 3000 | `/send_group_msg` | 401 | 401 | 401 | 401 |
| 3000 | `/send_private_msg` | 401 | 401 | 401 | 401 |

其他组件使用独立的认证。SnowLuma 向 Mac 发布 IPv4 回环地址的 3001（OneBot WS）、5099（管理页）和 6081（noVNC）。登录页面可直接加载，进入桌面使用 VNC 凭据，OneBot 使用其单独令牌，管理后台使用自身的密码与登录态。容器内部的 5900 和 3000 没有映射到宿主；这里的容器 3000 与 Mac 上的桥接 3000 是两个监听。Mac 上 8080 与旧登录页 6099 均无监听。

LocalChat 在回环 18083 提供主页、健康检查、模型列表、推理与卸载，均要求独立凭据。QQ 读取本机用户专属的 `~/Library/Application Support/LocalChat/client.key`（0600），以 Bearer 请求固定地址；本机网页使用 Basic 登录，用户名为 `local`。按需启动的回环 18084 只接受网关进程的内部 Bearer，不接受网页密码或客户端 key。旧 Gemini 网页服务（8081）已停用并取消自启。另有其他应用管理的 20128（9Router）及 8787（Codex 代理）。

对 SnowLuma 5099 的实际 GET 验证中，`/api/auth/state`、`/api/status`、`/api/system`、`/api/qq-list`、`/api/system/settings`、`/api/connections`、`/api/logs`、`/api/config/`、`/api/debug/actions`、`/api/processes`、`/api/update/status` 未登录均返回 401。登录界面与公开外观配置 `/api/ui/public` 可直接读取。OneBot 3001 的无凭据连接没有取得登录状态，携有效凭据的桥接读取在线状态成功。此处验证的是发布到 Mac 的服务，未逐个执行第三方修改密码、更新、清理或重启操作。

对两个共用代理的只读抽查：9Router 20128 的 `/api/settings` 未登录返回 401，`/dashboard` 重定向，`/v1/models` 公开返回 200。Codex 代理 8787 的 `/health` 和 `/v1/models` 返回 200。这些端口均只监听 Mac 回环；该抽查未涉及代理的全部第三方接口。
