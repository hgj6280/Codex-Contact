# QQ 聊天记录存储与回复节奏

2026-11-19 本机验收。下文的 `data/` 指 `~/Library/Application Support/CodexRemoteContact/data/`。消息正文、成员标识和凭据均省略。

## 存储切换和回滚

Hub 第一次启动新版时，先把原始 `qq-chat/messages.json` 的完整字节写入同目录的 `messages.before-sqlite-<SHA256>.json`，回读比较摘要，再在临时 SQLite 库中导入。程序逐会话核对所有消息的字段和顺序，再单独比对全局最近 100 条、发送请求、会话名、图片索引及其他元数据。通过 SQLite 完整性检查后才发布数据库。原文件和完整备份的权限均为 `0400`。

运行时，新增消息只写对应的消息行、会话顺序索引、版本计数及本条关联的图片描述。事务还包含该会话超出 300 条显示窗口时的淘汰操作。手动发送的请求编号及发送结果也在 SQLite 中持久化。

需要恢复 JSON 时，在访达双击项目 `scripts/回滚聊天记录存储.command`。该命令优先通过带 key 的本机 Hub 接口切换，和正在入库的消息共用写队列。它包含 SQLite 中已提交的新消息，完整导出、回读核对后才发布 `messages.rollback.json`。后续启动会优先使用这份 JSON。原文件、备份和 SQLite 库均保留。Hub 无法建立连接时，命令支持停止本机 Hub 后离线导出并恢复服务；如果已发布的数据库本身损坏且无法读取，命令会报错，避免以更旧快照覆盖新记录。

## 本次验证

- 线上迁移时为 72 个会话、13,504 条消息和 188,169 条图片描述。新旧消息总数相等，全量内容及顺序一致，另核对最近 100 条。原文件与备份均为 79,372,833 字节，SHA-256 一致。
- 并发发送端使用 8 个模拟群，每群 250 条唯一消息，再重复投递 50 次，共 2,400 次。测试包含跨群重复编号、相同时间戳和乱序时间戳。数据库重开后逐群逐条核对，实际 2,000 条，重复触发观察回调 0 次。
- 从线上 SQLite 做一致性副本，写入新的测试消息并回滚，导出 13,505 条，切换为 JSON 后再写一条并重新打开，两条测试消息都可读。
- 隔离计时使用同一份 79,359,818 字节在线快照。旧实现使用 Git 对象 `583596b:src/qq-chat.mjs`，新版使用当前代码。两边各 30 次单条收件落盘，旧版 P50 / P95 为 531.11 / 995.21 毫秒，新版为 0.114 / 0.378 毫秒。
- 受控收发计时使用同一条短请求、真实预热的本地模型、交错运行，每种存储 5 次。计时从 OneBot 收件进入 `ingest` 到本机 HTTP 发送接收器返回成功回执，旧版 P50 / P95 为 1.586 / 2.414 秒，新版为 0.943 / 1.088 秒。生产环境另有排队、人设和上下文拼接、QQ 网络投递等耗时。
- 同一真实 QQ 私聊前后各发一次完全相同的消息，两次回复均为 16 个字符。QQ 来信时间到提交发送分别约 20.54 秒、12.84 秒，到成功回执对应的出件记录分别约 20.70 秒、12.97 秒；发送账本均为 `sent`。QQ 源时间精度为秒。单对样本包含模型和队列波动。
- Hub 切换时桥接累计失败计数增加 1。交接监听捕获的 6 条消息已全部通过只入库的接口重新核对，重复事件按 ID 合并。已确认记录衔接，单次预判是否错过自动回复无法从计数还原。
- 本项相关测试 27 项全部通过。完整测试共 456 项，通过 449 项；剩余 7 项与上一步已知失败一致，涉及登录页测试、图片生成测试、模型选择器、关键词与用量触发。
- 项目回归命令为 `node --test src/qq-chat-storage.test.mjs src/qq-chat.test.mjs src/qq-chat-preflight.test.mjs src/qq-context-window.test.mjs`。线上只读检查可用 `scripts/qq-admin-fetch.mjs` 的 `adminFetch` 访问 `GET http://127.0.0.1:3789/api/qq/chat/storage`，预期当前模式为 `sqlite`。

## 当前回复长度、气泡和参与频率

| 功能 | 文件和字段 | 当前生效值 |
|---|---|---|
| 闲聊长度与条数偏好 | `data/qq-personality.json` 的 `enabled`、`text` | 自定义人设开启，通常每条几字到十几字。简单确认 1 条，闲聊 1–2 条，有实质补充才第 3 条。人设把空行作为气泡分隔。 |
| 详细回答与正文上限 | `src/qq-reply-length.mjs` 的 `qqResponseIntent().detailed`、`limitQqReplyText().maxLength`；`src/server.js` 与 `src/qq-autonomy.mjs` 的 `longReplyRequested` | 普通正文上限 6,000 字符，明确详细说明、逐项罗列等请求上限 18,000。 |
| 本地模型输出预算 | `src/server.js` 的 `maxTokens`；`src/qq-local-model.mjs` 的 `max_tokens` | 普通请求 384 token；长答请求传 6,144，网关调用前会限制为最多 1,024 token。 |
| 闲聊拆多条 | `src/qq-natural-replies.mjs` 的 `naturalReplyBubbles`；`event.autonomyExpected` 等运行时条件 | 回复在 1,000 字符以内，按空行可分为 2–3 个完整非空段时才自然拆发。代码块、生成图标记、动作、单独表情段等走整条。每条等上一条发送成功再发，无固定气泡间隔。当前没有单独的气泡数量或拆发开关。 |
| 指令与长文分包 | `src/server.js` 的 `singleBubble`；`src/qq-reply-length.mjs` 的 `splitQqLongReply(reply,maxChars)` | 群命令、搜图结果有单条发送路径。长文按最多 1,800 字符分包，尽量在完整句子处断开，包数随正文长度而变。 |
| 群聊主动插话 | `data/qq-autonomy.json` 的 `config.enabled / contextualReplies / socialPlannerEnabled / dynamicRhythmEnabled / replyCooldownEnabled` | 均为 `true`。根据话题、是否在找它、最近发言与群热度决定是否发言。 |
| 主动频率与引用 | 同文件 `config.minIntervalSeconds / maxPerHour / passiveProbability / topicProbability / quoteProbability / atProbability` | 90 秒、每会话每小时最多 8 次、参与强度 0.03、主动开话题概率 0.05、引用概率 0.10、主动 @ 概率 0。参与强度作用于合格机会，近期已发言会进一步降低机会。 |
| 新话题与连续接话 | `src/qq-autonomy.mjs` 的 `QQ_PARTICIPATION_POLICY` | `newTopicIntervalMs=90000`，`globalEntryIntervalMs=15000`，`continuationWindowMs=300000`，`continuationIntervalMs=3000`。同话题续聊窗口 5 分钟，会话内续聊最短 3 秒。 |
| 自动接图片 | 同一常量的 `automaticImageIntervalMs / imageEntriesPerGroupHour / imageEntriesGlobalHour` | 600,000 毫秒、每群每小时 3 次、全局每小时 8 次。 |
| 短期跟进与安静时段 | `data/qq-companion.sqlite` 的 `settings.data.naturalReplies / routine`；`src/qq-companion.mjs`、`src/qq-social-rhythm.mjs` | 自然跟进开启。备用跟进逻辑允许同一用户在 1.5–45 秒内就相关内容继续提问一次。作息开启，上海时间 00:30–07:00 安静，专注关闭；10 分钟内 6 次主动发言会歇一会儿，话题收尾冷却 20 分钟。 |
| 隔段时间主动找人 | `data/qq-companion.sqlite` 的 `settings.data.diary / idleFollowups`；`src/qq-companion-diary.mjs` 的 `QQ_SOCIAL_POLICY` | 均开启。空闲 30–90 分钟后才有机会；同一私聊每日最多 3 次、间隔 3 小时，同群每日最多 2 次、间隔 2 小时。后台决策全局每日最多 10 次、间隔至少 10 分钟。 |
| 旧版主动逻辑 | `data/settings.json` 的 `qq.proactive.enabled / minIntervalMs` | `true / 180000`。当前基础群模式为 `mention-only`，自主决策启用的群优先使用上面的 90 秒规则。 |
| 整个 QQ 账号发送上限 | `data/qq-send-budget.sqlite` 的 `send_settings.data.dailyLimit / perMinute` | 每日 2,000 条，每分钟 20 条；实际发出的多个气泡分别占用额度。 |
