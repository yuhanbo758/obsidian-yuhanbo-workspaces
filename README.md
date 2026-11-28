# yuhanbo-workspaces

用于管理 Obsidian 工作区的中文插件。由余汉波独立维护，基于 [Workspaces Plus](https://github.com/jsmorabito/obsidian-workspaces-plus)（上游基线 `b272d95f64ab1e8d2ef1ad12d0c330152a89b51f`）。原作者为 NothingIsLost 和 Johnny（`jsmorabito`）。本衍生版按 [GPL-3.0](LICENSE) 分发，其维护和问题支持由本仓库负责。

插件 ID 为 `yuhanbo-workspaces`，最低支持 Obsidian 1.8.7。当前通过 [GitHub Releases](https://github.com/yuhanbo758/obsidian-yuhanbo-workspaces/releases) 分发。手动安装或更新时，将 Release 的 `main.js`、`manifest.json`、`styles.css` 放入目标库的 `.obsidian/plugins/yuhanbo-workspaces/`，保留已有的 `data.json`。然后重新打开 Obsidian 库。

## 使用方式

1. 在「设置 → 核心插件」启用「工作区」。
2. 禁用原版 Workspaces Plus，避免两个插件同时包装核心工作区功能。
3. 在「设置 → 第三方插件」启用「yuhanbo-workspaces」。
4. 使用状态栏或命令「打开工作区切换器」选择工作区。移动端可使用命令，或开启侧边工具栏按钮。
5. 在插件设置中展开工作区，编辑名称、说明、图标、收藏或文件覆盖。

## 新增的个人管理功能

| 功能 | 使用方式 |
|---|---|
| 收藏置顶 | 在每个工作区设置中开启「收藏此工作区」，切换列表显示星标。 |
| 最近使用排序 | 「个人工作区管理 → 工作区排序」选择最近使用或名称；收藏始终置顶。最近记录最多 20 项。 |
| 布局规模提示 | 切换列表显示所有布局树中的标签页和 Markdown 笔记数量，包括浮动窗口。30 个及以上笔记提示「大型布局」，不读取正文、不初始化后台视图。 |
| 复制已保存布局 | 在工作区设置点击「复制已保存布局」，或执行「复制当前已保存的工作区」。副本有独立布局和配置，不切换当前屏幕；当前未保存变化不包含在副本中。 |
| 本地备份与恢复 | 使用设置中的按钮或「备份工作区配置」「恢复工作区配置备份」命令。默认保留最新 5 份，可选 1、5、10、20 份。 |

备份保存于本插件的本地 `data.json`，内容为**已保存的工作区配置**，不包含笔记正文，也不替代整个库的备份。恢复前需确认，并成功保存一份恢复前备份；恢复覆盖同名工作区、补回缺失工作区，保留其他工作区，不自动切换当前布局。恢复后的配置通过切换列表加载。复制、备份都会保留上游模式配置，但模式的复制入口只面向普通工作区。

## 配置说明

- **布局改变时自动保存当前工作区**：适合希望记住随时变化的布局；需要固定布局时关闭。
- **记住并恢复打开的文件**：保存工作区时记录标签页文件路径，切回时恢复。
- **切换时保留左右侧栏布局 / 侧边工具栏图标**：切换主工作区时沿用当前侧栏或工具栏。
- **启动时恢复上次工作区的已保存布局**：默认关闭。开启会舍弃上次未保存的布局变化。
- **工作区模式（测试功能）**：仅桌面端，保存并切换编辑器、外观等核心设置。可选择跟随系统深色模式、实时预览改变时重载应用。
- **标签页文件覆盖**：按叶节点配置要打开的文件，支持上游日期模板变量；覆盖优先于普通文件跟踪。
- **键盘操作**：Enter 加载，Ctrl+Enter 重命名，Shift+Delete 删除，Shift+Enter 保存，Alt+Enter 保存并切换，Ctrl+, 打开设置。数字标记开启且搜索为空时，可按 1–9 快速切换。

界面使用中文；原有命令 ID 稳定，静态与动态命令均使用 `obsidian-yuhanbo-` 前缀。完整注册 ID 会带上 `yuhanbo-workspaces:`。上游快捷键需手动迁移到本插件命令。

## 多屏性能与修复

- 工作区恢复保留后台标签页延迟加载，用户激活时由 Obsidian 初始化视图；不会批量调用 `loadIfDeferred`。
- 快速切换或卸载后旧恢复任务失效；已交给核心 `changeLayout` 的操作无法外部中断。
- 自动保存等待实际布局恢复结束，不再固定只暂停两秒。尚未执行的自动保存也会再次检查加载状态。
- 修复删除快捷键误传键盘事件、空列表选择、含引号的工作区名称匹配和重复渲染标记。
- 状态栏样式已匹配本插件 ID。

## 开发与验证

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

使用上游 Rollup，不新增运行时依赖。TypeScript 的 `skipLibCheck` 只跳过上游依赖声明冲突，项目源码仍检查。测试包含延迟加载、快速切换、模式切换、重命名、收藏排序、副本独立性、备份深拷贝、恢复确认及失败保护。

请使用独立测试库验证修改。真实多屏切换、移动端真机和长期稳定性仍需客户端验收。

## 隐私与数据

插件在本地运行，无账号、付费依赖、广告、遥测或网络请求。工作区配置及备份保存在当前库内，不会上传，也不会读取库外文件。GitHub Actions 负责构建和发布，插件自身不下载更新。

## 发布与更新

向 GitHub 默认分支 `main` 推送源码、样式、依赖或发布配置的变化，会启动自动发布。流程检查类型、运行测试并构建。若当前版本已经使用，会递增补丁号并同步版本文件，再发布同名标签和三个带构建证明的附件。只改 README 不会触发发布。也可从 Actions 页面手动启动工作流。

Workspaces Plus 的维护者 Johnny 已公开授权本衍生版本提交至 Obsidian 官方社区目录并发布后续更新。 [上游授权原文](https://github.com/jsmorabito/obsidian-workspaces-plus/issues/150#issuecomment-7229491340)

## 回滚

更新前请备份当前安装目录。回滚时禁用插件并恢复旧的 `main.js`、`manifest.json` 和 `styles.css`，保留原有 `data.json`。

## 官方参考

- [上游项目](https://github.com/jsmorabito/obsidian-workspaces-plus)
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [Obsidian 开发文档](https://docs.obsidian.md/Home)

## English overview

yuhanbo-workspaces is an independently maintained fork of Workspaces Plus by NothingIsLost and Johnny. It provides a Chinese interface for managing saved workspaces, with favorites, recent-use sorting, layout copies, and local configuration backups. Background tabs remain deferred until opened.

### Installation

1. Use Obsidian 1.8.7 or later and enable the built-in **Workspaces** feature under **Settings → Core plugins**.
2. Install and enable **yuhanbo-workspaces** under **Settings → Community plugins** when available. For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub Release](https://github.com/yuhanbo758/obsidian-yuhanbo-workspaces/releases/latest) into your vault's `.obsidian/plugins/yuhanbo-workspaces/` directory. Reopen the vault and enable the plugin.
3. Disable Workspaces Plus before enabling this fork so the two plugins do not manage the same workspace hooks.

### Usage

Use the workspace switcher on the status bar or open it from the command palette (search for `打开工作区切换器`). Select a saved layout to switch. Use the plugin settings to favorite, copy, back up, or restore saved workspaces. File and folder suggestions search names and paths within the current vault when you configure file overrides. Workspace data stays in the vault. The plugin makes no network requests and requires no account.

<!-- sanrenjz-promotion:start -->
## 👨‍💻 作者信息

**余汉波** - 编程爱好者-量化交易和效率工具开发

- **GitHub**: [@yuhanbo758](https://github.com/yuhanbo758)

- **Email**: yuhanbo@sanrenjz.com

- **Website**: [三人聚智](https://www.sanrenjz.com)

## 🌐 相关链接

- 🏠 [项目主页](https://www.sanrenjz.com)

- 📚 [在线文档](https://docs.sanrenjz.com)（财经、代码和库文档等）

- 🛒 [插件商店](https://shop.sanrenjz.com)（所有程序，包括开源和不开源）


## 联系我们

[联系我们 - 三人聚智-余汉波](https://www.sanrenjz.com/contact_us/)

证券开户（+V：yuhanbo758）：[证券开户免5万0.854，无门槛开量化QMT，送框架策略，支持VIP快速通道，也可开Ptrade | 余汉波 文档](https://docs.sanrenjz.com/article/%E8%AF%81%E5%88%B8%E5%BC%80%E6%88%B7%E5%85%8D5%20%E4%B8%870.854%EF%BC%8C%E6%97%A0%E9%97%A8%E6%A7%9B%E5%BC%80%E9%87%8F%E5%8C%96QMT%EF%BC%8C%E9%80%81%E6%A1%86%E6%9E%B6%E7%AD%96%E7%95%A5%EF%BC%8C%E6%94%AF%E6%8C%81VIP%E5%BF%AB%E9%80%9F%E9%80%9A%E9%81%93%EF%BC%8C%E4%B9%9F%E5%8F%AF%E5%BC%80Ptrade)

三人聚智下载：[sanrenjz - 三人聚智](https://www.sanrenjz.com/sanrenjz/)

codebot 下载：[sanrenjz-codebot - 三人聚智-余汉波](https://www.sanrenjz.com/sanrenjz-codebot/)

![三码合一](https://gdsx.sanrenjz.com/image/sanrenjz_yuhanbolh_yuhanbo758.png?imageSlim&t=1ab9b82c-e220-8022-beff-e265a194292a)

![余汉波打赏码](https://gdsx.sanrenjz.com/image/%E6%89%93%E8%B5%8F%E7%A0%81%E5%90%88%E4%B8%80.png?imageSlim)

## 🙏 致谢

感谢所有为本项目贡献代码和想法的开发者们！

---
**⭐ 如果这个项目对您有帮助，请给它一个 Star！**
<!-- sanrenjz-promotion:end -->
