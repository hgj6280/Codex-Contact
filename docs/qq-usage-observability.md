# QQ 回复用量和耗时

管理端使用项目的 `scripts/qq-admin-fetch.mjs`。两个只读接口和 Hub 共用本机鉴权。

| GET 路径 | 内容 |
|---|---|
| `/api/qq/usage/breakdown` | 上海时区今日及累计的角色统计，仅在打开明细时汇总 |
| `/api/qq/usage/timings` | 最近 100 条实际发送尝试的阶段时间，最新在前 |

单次调用仍保存在本机数据目录的 `qq-token-usage/calls/`，发送回执在同目录的 `reply-timings.sqlite`。用随机的 `replyId` 对齐两者，每次发送用 `sendIndex` 区分。新增统计只保存标签、计数、字节数和时间。测试用户用 10001，测试群用 20001。

## 用量口径

- `context` 表示请求更多上下文或召回的独立模型决策，`vision` 表示读图，`memory` 表示后台记忆提取，`reply` 表示正文回复，`sticker` 表示单独选择表情。情绪与记忆在同一次调用中提取，回复中也可能同时选择表情。主角色记全部上游 token，共用角色记 `sharedCalls`。本机规则挑选表情和 SQL 检索没有模型用量。
- 另有主动社交决策、总结及生图等角色。旧账保留为 `unclassified`。返回有效 usage 的调用使用供应商的输入、输出及缓存计数。无 usage 的调用计入 `unknownUsageCalls`。
- `inputParts` 的人设与规则、历史、其他文字按最终可见提示词的 UTF-8 字节占比分摊，是估算值。模型模板、隐藏工具和供应商用词切分都会影响真实比例。供应商明确返回图片 token 时使用这个数字。含图且上游没有拆分时，单次记录中 `images=null`，这一轮输入计入 `unattributed`。后续内部工具轮没有完整的可见提示词，也列入未分解用量。
- `cachedInputTokens` 和 `retryInputTokens` 是输入的子集。失败后的重新生成、协议修复等有独立调用账单。模型为取得额外上下文而发起的新一轮是正常工具流程。

## 时间口径

`receivedAt` 是本机 OneBot 收到 WebSocket 消息，`queuedAt` 是进入桥接队列，`contextAt` 是开始准备该次处理的会话及引用上下文。`firstOutputAt`、`lastOutputAt` 是模型输出起止，`receiptAt` 是读到 QQ 成功发送回执。时间戳为 Unix 毫秒，`stageMs` 按上述顺序给出五段差值，`totalMs` 从收到消息计到成功回执。需要 HTTP 成功、OneBot 状态成功、返回码 0 且带消息 ID 才会记为成功。

本地 MLX 在既有非流式生成器逐 token 产生输出时计时。Codex CLI 以可观察的正文事件计时，只有整段完成事件时首 token 为空。多轮取同一回复最早可观察的开始和最晚的完成。上游只返回完整结果时结束记录为本机看到结果的时刻。快捷命令、直接发送素材会有空的模型阶段；绕过队列时入队时间为空。排队的视频、群总结独立保留来源；通过 parentId 可与接收确认关联。主动消息和升级前恢复的任务缺少原始入站时刻时留空。

本机 MLX 的适配器由 `scripts/install-qq-mlx-timing.py <LocalChat目录>` 安装，用同一命令加 `--rollback` 可恢复原 worker 启动入口。修改在网关空闲重启后生效。QQ 客户端兼容原网关返回值。

## 长回答的现行上限

| 链路 | 当前值 | 代码位置 |
|---|---|---|
| 本地普通、长答、协议修复请求 | 输出预算分别为 384、6,144、512 token | `src/server.js`、`src/qq-local-model.mjs` |
| 本地实际传输与 worker | QQ 客户端与 LocalChat 网关分别限制到 16–1,024 token。MLX 默认 384，有显式参数时取请求值 | `src/qq-local-model.mjs`、独立 LocalChat 的 `server.py` |
| 本地模型输入 | 最多 20 条消息、合计 24,000 UTF-8 字节，HTTP 请求体最多 65,536 字节 | LocalChat 的 `server.py` |
| 云端 Codex CLI | 此处没有显式输出 token 上限，仍受实际模型和供应商上下文限制。历史 Gemini 路由的显式请求限制为 256–6,144 | `src/server.js`、`src/qq-gemini-router.mjs` |
| 自主协议 JSON | 普通 16,000、长答 36,000 UTF-16 单元，含结构和控制字段 | `src/qq-autonomy.mjs` |
| 回复正文 | 普通 6,000、详细 18,000 个 Unicode 码点。快速读图回复调用默认 6,000 | `src/server.js`、`src/qq-autonomy.mjs`、`src/qq-reply-length.mjs` |
| 自然分气泡 | 全文最多 1,000 码点、按空行恰能分为 2–3 段时才采用；代码、附件等有额外条件 | `src/qq-natural-replies.mjs` |
| QQ 长文发送 | 每包最多 1,800 码点，优先在标点处断开。包数由全文长度决定 | `src/qq-reply-length.mjs` |
| 群聊历史总结 | 分段 220、人物记录 300、最终合并 900 输出 token。合并提示要求最多 500 汉字和 6–8 个要点，结果正文另截到 6,500 UTF-16 单元 | `src/qq-group-digest.mjs` |
| 视频总结 | 本地后台调用申请 2,048 输出 token，仍受 1,024 的网关上限；云端 CLI 未显式传出 token 上限；视频任务结果每包最多 1,350 个 Unicode 码点 | `src/server.js`、`src/qq-video-summary.mjs`、`src/qq-video-jobs.mjs` |
| 手动桌面输入 | 每条最多 2,000 UTF-16 单元 | `src/qq-chat.mjs` |

长答的请求预算是实际本地上限的 6 倍。正文即使还容得下内容，生成也可能已因输出 token 封顶而结束。中文字符、Unicode 码点、UTF-16 单元、UTF-8 字节与模型 token 之间没有固定换算比例。

## 本机实测

2026-11-20 从两条自然产生的本地模型 QQ 回复中，分别关联到了模型调用记录和成功发送回执。以下单位为毫秒。

| 样本 | 收到→入队 | 入队→组上下文 | 开始组装→首 token | 首 token→末输出 | 末输出→回执 | 收到→回执 |
|---|---:|---:|---:|---:|---:|---:|
| 一次回复调用 | 39 | 3 | 9,131 | 5,383 | 873 | 15,429 |
| 含一次协议修正 | 43 | 2 | 10,295 | 17,791 | 1,634 | 29,765 |

第二条的生成区间包含了两次推理之间的时间。两个样本用于确认埋点，不能当作平均速度。批量记忆提取按独立后台调用统计。

上线时一轮健康检查超时触发回退，恢复桥接后完成发布。桥接重启后的失败计数在后续切换期间从 0 增至 14。这个计数包含入站预判失败，无法还原其中多少条本应触发回复。收件补录只核对聊天存储，不会补发自动回复。最终认证检查确认 QQ 在线、存储为 SQLite、统计 API 可读。
