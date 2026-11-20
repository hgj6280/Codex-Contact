# 第三方声明

本项目软件采用 [MIT 许可证](LICENSE)。第三方软件、词库数据和角色素材的授权范围如下。

## yonagi-speak

群聊节奏和按群检索的设计参考了 yonagi-speak。上游软件采用 MIT 许可证，原版权声明为 `Copyright (c) 2026 BingAlpha`。参见[完整上游许可证](docs/licenses/yonagi-speak-LICENSE.txt)和[本项目的适配说明](docs/yonagi-adaptation.md)。

## dsh-memewiki 与词库数据

dsh-memewiki 的软件采用 MIT 许可证，原版权声明为 `Copyright (c) 2026 dsh-memewiki contributors`。本项目所用版本的上游 NOTICE 记载，该插件移植自 in1t1a1 的 astrbot_plugin_memewiki，原仓库已删除。[上游许可证](vendor/dsh-memewiki/LICENSE) · [上游 NOTICE 原文](vendor/dsh-memewiki/NOTICE)

词库文字数据由 cnmeme.wiki 整理，数据权利归原作者和 cnmeme.wiki。本项目只随源码提供 QQ 查询适配器、版权声明和来源记录。安装词库时，从[来源记录](vendor/dsh-memewiki/provenance.json)指定的上游修订单独下载 `data/memes.db`，核对文件大小和 SHA-256，再放入本机运行数据目录的 `qq-memewiki/memes.db`。聊天时只读本地词库，文件缺失时跳过词库查询。

## Live2D Cubism Core

Cubism Core 是 Live2D Inc. 的专有运行库，由 Live2D 的 SDK 许可约束。启用 Live2D 时，用户须先阅读并接受官方条款，再通过安装入口从官方获取运行库。公开仓库不分发 Core。[Live2D 官方下载与许可条款](https://www.live2d.com/en/sdk/download/web/)

## 角色图片

角色图片另行授权，条款待定，本次发布不含图片。[角色素材授权说明预留文件](assets/qq-character/LICENSE.md)
