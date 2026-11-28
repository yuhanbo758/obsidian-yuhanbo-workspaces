# yuhanbo-workspaces

yuhanbo-workspaces is an independently maintained fork of Workspaces Plus by NothingIsLost and Johnny. It provides a Chinese interface for managing saved workspaces, with favorites, recent-use sorting, layout copies, and local configuration backups. Background tabs remain deferred until opened.

[Chinese documentation](https://github.com/yuhanbo758/obsidian-yuhanbo-workspaces/blob/main/README.zh-CN.md)

## Installation

1. Use Obsidian 1.8.7 or later and enable the built-in **Workspaces** feature under **Settings > Core plugins**.
2. Install and enable **yuhanbo-workspaces** under **Settings > Community plugins**. For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub Release](https://github.com/yuhanbo758/obsidian-yuhanbo-workspaces/releases/latest) into your vault's `.obsidian/plugins/yuhanbo-workspaces/` directory. Preserve the existing `data.json` when updating. Reopen the vault and enable the plugin.
3. Disable Workspaces Plus before enabling this fork so the two plugins do not manage the same workspace hooks.

## Usage

Use the workspace switcher on the status bar or open it from the command palette (see the Chinese guide for the command label). On mobile, use the command palette or enable the optional ribbon button. Select a saved layout to switch.

- Favorites stay at the top of the switcher. Sort the remaining layouts by name or recent use.
- The switcher counts tabs and Markdown notes across the saved layout, including floating windows. A layout with at least 30 notes shows a large-layout indicator.
- Duplicate a saved workspace from its settings or with the duplicate command. The copy starts from the saved layout and does not switch the active workspace.
- Configure file overrides per tab by entering a vault-relative Markdown path. On older Obsidian versions, the file suggester shows up to 30 matches once you type. A folder path followed by a slash limits suggestions to that folder and its subfolders.
- Enable automatic saving to capture layout changes as they happen. Startup restoration is off by default. Enable it if you want Obsidian to restore the last workspace from its saved layout when the vault opens.
- Workspace modes are a desktop-only feature for saving and restoring selected Obsidian preferences.

## Local backups and privacy

Use the plugin settings or command palette to create or restore a backup. Backups contain saved workspace configurations and file paths. The plugin stores them in its local `data.json` and does not copy note contents. The default retention is five backups. Before restoring, the plugin asks for confirmation and saves a recovery backup. Restore updates workspaces with matching names, adds missing ones, and keeps other workspaces.

The plugin operates within the current vault. It requires no account, does not contact external services, and does not collect telemetry. During layout restoration, the plugin leaves background tabs deferred until they are opened.

## Build and update

Run the following commands from the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

GitHub Actions tests and builds the plugin before publishing a versioned Release. To roll back a manual installation, disable the plugin and replace the three release files with the previous versions, keeping your existing `data.json`.

## Credits and license

Yuhanbo maintains this fork of [Workspaces Plus](https://github.com/jsmorabito/obsidian-workspaces-plus) by NothingIsLost and Johnny. Johnny granted [public permission](https://github.com/jsmorabito/obsidian-workspaces-plus/issues/150#issuecomment-7229491340) to publish this fork and its updates in the Obsidian community directory. The code is distributed under the [GPL-3.0 license](LICENSE).

<!-- sanrenjz-promotion:start -->
## About the maintainer

**Yuhanbo Yu** develops quantitative trading software and productivity tools.

- **GitHub**: [@yuhanbo758](https://github.com/yuhanbo758)
- **Email**: yuhanbo@sanrenjz.com
- **Website**: [Sanrenjz](https://www.sanrenjz.com)

## Related links

- [Project website](https://www.sanrenjz.com)
- [Online documentation](https://docs.sanrenjz.com) for finance, code, and libraries
- [Plugin store](https://shop.sanrenjz.com) for open-source and proprietary software

## Contact and downloads

- [Contact Sanrenjz and Yuhanbo](https://www.sanrenjz.com/contact_us/)
- [Brokerage account information in Chinese](https://docs.sanrenjz.com/article/%E8%AF%81%E5%88%B8%E5%BC%80%E6%88%B7%E5%85%8D5%20%E4%B8%870.854%EF%BC%8C%E6%97%A0%E9%97%A8%E6%A7%9B%E5%BC%80%E9%87%8F%E5%8C%96QMT%EF%BC%8C%E9%80%81%E6%A1%86%E6%9E%B6%E7%AD%96%E7%95%A5%EF%BC%8C%E6%94%AF%E6%8C%81VIP%E5%BF%AB%E9%80%9F%E9%80%9A%E9%81%93%EF%BC%8C%E4%B9%9F%E5%8F%AF%E5%BC%80Ptrade) (WeChat: yuhanbo758)
- [Download Sanrenjz](https://www.sanrenjz.com/sanrenjz/)
- [Download Codebot](https://www.sanrenjz.com/sanrenjz-codebot/)

![Contact QR codes](https://gdsx.sanrenjz.com/image/sanrenjz_yuhanbolh_yuhanbo758.png?imageSlim&t=1ab9b82c-e220-8022-beff-e265a194292a)

![Donation QR codes](https://gdsx.sanrenjz.com/image/%E6%89%93%E8%B5%8F%E7%A0%81%E5%90%88%E4%B8%80.png?imageSlim)

## Thanks

Thank you to the developers who contributed code and ideas. If this project helps you, consider giving it a star on GitHub.
<!-- sanrenjz-promotion:end -->
