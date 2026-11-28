import WorkspacesPlus from "./main";
import {
  App,
  ColorComponent,
  Notice,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  setIcon,
  WorkspaceCustomSettings,
  WorkspaceLayoutNode,
  SettingDefinitionItem,
} from "obsidian";
import { FileSuggest } from "./suggesters/fileSuggest";
import { IconSuggest } from "./suggesters/iconSuggest";
import { createConfirmationDialog } from "./confirm";
import { PERSONAL_DEFAULTS, summarizeLayout } from "./personalWorkspaces";
import type { PersonalWorkspaceSettings } from "./personalWorkspaces";
import { buildPersonalSettings, buildFavoriteSetting, buildDuplicateSetting } from "./personalWorkspaceUI";
import {
  getSettingDefinitions as declarativeGetSettingDefinitions,
  getControlValue as declarativeGetControlValue,
  setControlValue as declarativeSetControlValue,
} from "./settingsDeclarative";

interface ToggleText {
  name?: string;
  desc?: string;
}

// What to display next to each workspace in the quick switcher: its assigned custom hotkey
// (addresses issue #116) or a Linear-style position number (1-9) that can be pressed to jump
// straight to that workspace. Kept mutually exclusive -- rendering both at once would make it
// unclear whether a badge indicates the workspace's real hotkey or just its list position, and a
// custom hotkey (e.g. Alt+1) has no relationship to the position-based number a user might expect
// to press for that same row.
export type WorkspaceBadgeMode = "hotkey" | "number";

export const WORKSPACE_BADGE_OPTIONS: Record<WorkspaceBadgeMode, string> = {
  hotkey: "自定义快捷键",
  number: "数字键（1–9）",
};

export const WORKSPACE_BADGES_TEXT: ToggleText = {
  name: "切换列表的快捷键标记",
  desc: "显示已绑定的快捷键，或显示可直接按下的数字键（1–9）。",
};

// Falls back to this plugin's own existing default workspace icon (used for the status bar
// segment in main.ts) when a workspace has no custom icon set, so an unconfigured workspace looks
// the same in the switcher as it always has elsewhere in the plugin.
export const DEFAULT_WORKSPACE_ICON = "pane-layout";

// Purely the color swatch shown before a workspace has a custom icon color -- never written to a
// workspace's settings on its own; only picking a color (or resetting away from one) does that.
export const DEFAULT_ICON_COLOR_SWATCH = "#888888";

// Builds the "工作区图标" control (a text field with icon-name autocomplete, plus a live
// preview) shared between display() (pre-1.13.0) and getSettingDefinitions()'s render callback
// (1.13.0+), so the two can't drift the way two independently hand-rolled UIs would.
export function buildWorkspaceIconSetting(
  setting: Setting,
  app: App,
  workspaceSettings: WorkspaceCustomSettings,
  onSave: () => void
): void {
  const previewEl = createSpan({ cls: "workspace-icon-preview" });
  setIcon(previewEl, workspaceSettings.icon || DEFAULT_WORKSPACE_ICON);
  setting.controlEl.prepend(previewEl);
  setting.addText(text => {
    text.inputEl.type = "text";
    text.setPlaceholder(DEFAULT_WORKSPACE_ICON);
    text.setValue(workspaceSettings.icon ?? "");
    new IconSuggest(app, text.inputEl);
    text.onChange(value => {
      const iconId = value.trim();
      if (iconId) workspaceSettings.icon = iconId;
      else delete workspaceSettings.icon;
      onSave();
      setIcon(previewEl, iconId || DEFAULT_WORKSPACE_ICON);
    });
  });
}

// Same sharing rationale as buildWorkspaceIconSetting() above. The color picker itself has no
// "unset" state (it's a native color input, always showing some color), so a reset button is
// needed to actually clear iconColor back to "use the app's default" rather than just setting it
// to this swatch's own value.
export function buildWorkspaceIconColorSetting(setting: Setting, workspaceSettings: WorkspaceCustomSettings, onSave: () => void): void {
  let colorPicker: ColorComponent;
  setting
    .addColorPicker(picker => {
      colorPicker = picker;
      picker.setValue(workspaceSettings.iconColor || DEFAULT_ICON_COLOR_SWATCH).onChange(value => {
        workspaceSettings.iconColor = value;
        onSave();
      });
    })
    .addExtraButton(button => {
      button
        .setIcon("rotate-ccw")
        .setTooltip("恢复默认颜色")
        .onClick(() => {
          delete workspaceSettings.iconColor;
          onSave();
          colorPicker.setValue(DEFAULT_ICON_COLOR_SWATCH);
        });
    });
}

// Shared between display() and getSettingDefinitions()'s render callback, same rationale as the
// icon settings above. Commits on blur/Enter rather than on every keystroke (unlike the other
// per-workspace text fields) because a successful rename changes the workspace's key -- every
// other control on this page (file overrides, the other two icon settings) is keyed by the old
// name and needs a full refresh (onRenamed) once it changes, which isn't something you want
// firing after every character typed.
export function buildWorkspaceRenameSetting(
  setting: Setting,
  plugin: WorkspacesPlus,
  workspaceName: string,
  onRenamed: () => void
): void {
  setting.addText(text => {
    text.setValue(workspaceName);
    const commit = () => {
      const newName = text.inputEl.value;
      if (newName.trim() === workspaceName) {
        text.setValue(workspaceName);
        return;
      }
      const result = plugin.utils.renameWorkspace(workspaceName, newName);
      if (result.success) {
        new Notice(`工作区已重命名为「${newName.trim()}」。`);
        onRenamed();
      } else {
        if (result.reason) new Notice(result.reason);
        text.setValue(workspaceName);
      }
    };
    text.inputEl.addEventListener("blur", commit);
    text.inputEl.addEventListener("keydown", evt => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        text.inputEl.blur();
      }
    });
  });
}

// Same sharing rationale as the icon/rename settings above. Always confirms (unlike the quick
// switcher's own delete, which skips the prompt when showDeletePrompt is off) since this is a
// deliberate settings-page action rather than a quick inline one, and warns specifically about
// the active workspace since deleting it means Utils.deleteWorkspace() switches you to a
// different one out from under you rather than leaving you on a now-nonexistent workspace.
export function buildWorkspaceDeleteSetting(
  setting: Setting,
  plugin: WorkspacesPlus,
  workspaceName: string,
  onDeleted: () => void
): void {
  const isActive = plugin.utils.activeWorkspace === workspaceName;
  setting
    .setDesc(
      isActive
        ? "删除后无法撤销；删除当前工作区会切换到其他工作区。"
        : "删除后无法撤销，建议先创建配置备份。"
    )
    .addButton(button => {
      button.setButtonText("删除");
      if (requireApiVersion("1.13.0")) {
        button.setDestructive();
      } else {
        button.setClass("mod-warning");
      }
      button.onClick(() => {
        createConfirmationDialog(plugin.app, {
          cta: "删除",
          title: "删除工作区",
          text: isActive
            ? `确定删除当前工作区「${workspaceName}」？删除后会切换到其他工作区。`
            : `确定删除工作区「${workspaceName}」？此操作无法撤销。`,
          onAccept: async () => {
            plugin.utils.deleteWorkspace(workspaceName);
            onDeleted();
          },
        });
      });
    });
}

// Shared name/desc text for the plugin's toggle settings, consumed by both display() (the
// pre-1.13.0 fallback) and getSettingDefinitions() (the 1.13.0+ declarative UI) so the two
// separately-structured implementations can't silently drift apart on wording. Keyed by the
// WorkspacesPlusSettings property each toggle controls; "workspaceSettings" is the one
// exception -- it only holds desc text here since display() renders its name with an extra
// "测试功能" flair badge that has no equivalent in the declarative API's string-only name field.
export const TOGGLE_TEXT: Record<string, ToggleText> = {
  showInstructions: {
    name: "显示键盘操作提示",
    desc: "在工作区切换窗口底部显示可用的键盘操作。",
  },
  showDeletePrompt: {
    name: "删除工作区前确认",
    desc: "删除工作区时先显示确认提示。",
  },
  showWorkspaceDescriptions: {
    name: "在切换列表显示工作区说明",
    desc: "在工作区名称下显示说明，可在下方的工作区设置中编辑。",
  },
  showWorkspaceIconInSwitcher: {
    name: "在切换列表显示工作区图标",
    desc: "在工作区名称旁显示图标，可在下方的工作区设置中选择。",
  },
  showWorkspaceIconInStatusBar: {
    name: "在状态栏显示工作区图标",
    desc: "状态栏使用当前工作区设置的图标。",
  },
  workspaceSwitcherRibbon: { name: "显示工作区侧边工具栏按钮" },
  replaceNativeRibbon: { name: "隐藏核心工作区工具栏按钮" },
  modeSwitcherRibbon: { name: "显示模式侧边工具栏按钮" },
  workspaceSettings: {
    // name intentionally omitted -- display() renders its own name via createFragment (see
    // below) to add the "测试功能" flair badge, and getSettingDefinitions() uses its own literal
    // "工作区模式（测试功能）" string since the declarative API's name field is string-only.
    desc:
      "模式可保存 Obsidian 编辑器、文件与链接、" +
      "外观等核心设置。启用后会在状态栏添加模式切换器，可" +
      "保存、应用、重命名和切换模式（仅桌面端）。",
  },
  saveOnChange: {
    name: "布局改变时自动保存当前工作区",
    desc:
      "移动分栏、开关标签页或调整窗口时自动保存当前工作区。" +
      "如需保留固定布局、手动保存，请关闭此项。",
  },
  preserveRibbon: {
    name: "切换时保留侧边工具栏图标",
    desc: "切换工作区时保留当前侧边工具栏图标及顺序。",
  },
  preserveSidebarLayout: {
    name: "切换时保留左右侧栏布局",
    desc: "切换工作区时保留当前左右侧栏的分栏、排列和视图状态。",
  },
  trackOpenFiles: {
    name: "记住并恢复打开的文件",
    desc:
      "保存工作区时记住各标签页的文件，切回时恢复。" +
      "后台标签页继续按需加载，不会一次性初始化全部笔记。",
  },
  systemDarkMode: {
    name: "跟随系统深色模式",
    desc: "切换模式时跟随系统浅色或深色设置；需要先启用工作区模式。",
  },
  reloadLivePreview: {
    name: "实时预览设置改变时自动重载 Obsidian",
    desc:
      "切换模式导致实时预览设置改变时，重载 Obsidian 以使设置" +
      "生效。启用后可能在切换时直接重载，请谨慎开启。",
  },
  restoreLayoutOnStartup: {
    name: "启动时恢复上次工作区的已保存布局",
    desc:
      "每次启动 Obsidian 或重新启用本插件时，重新应用上次工作区的已保存布局。" +
      "这会让工作区名称与布局一致，但会放弃" +
      "上次未保存的布局变化。关闭后使用" +
      "Obsidian 自身的会话恢复，保留未保存的布局变化。",
  },
};

export class WorkspacesPlusSettings implements PersonalWorkspaceSettings {
  favoriteWorkspaces: PersonalWorkspaceSettings["favoriteWorkspaces"];
  recentWorkspaces: PersonalWorkspaceSettings["recentWorkspaces"];
  workspaceSort: PersonalWorkspaceSettings["workspaceSort"];
  showLayoutSummary: boolean;
  backupLimit: number;
  workspaceBackups: PersonalWorkspaceSettings["workspaceBackups"];
  showInstructions: boolean;
  showDeletePrompt: boolean;
  showWorkspaceDescriptions: boolean;
  showWorkspaceIconInSwitcher: boolean;
  showWorkspaceIconInStatusBar: boolean;
  workspaceBadges: WorkspaceBadgeMode;
  saveOnSwitch: boolean;
  saveOnChange: boolean;
  workspaceSettings: boolean;
  systemDarkMode: boolean;
  globalSettings: Record<string, unknown>;
  activeWorkspaceDesktop: string;
  activeWorkspaceMobile: string;
  reloadLivePreview: boolean;
  workspaceSwitcherRibbon: boolean;
  modeSwitcherRibbon: boolean;
  replaceNativeRibbon: boolean;
  trackOpenFiles: boolean;
  preserveRibbon: boolean;
  preserveSidebarLayout: boolean;
  restoreLayoutOnStartup: boolean;
}

export const DEFAULT_SETTINGS: WorkspacesPlusSettings = {
  ...PERSONAL_DEFAULTS,
  showInstructions: true,
  showDeletePrompt: true,
  showWorkspaceDescriptions: false,
  showWorkspaceIconInSwitcher: false,
  showWorkspaceIconInStatusBar: false,
  workspaceBadges: "hotkey",
  saveOnSwitch: false,
  saveOnChange: false,
  workspaceSettings: false,
  systemDarkMode: false,
  globalSettings: {},
  activeWorkspaceDesktop: "",
  activeWorkspaceMobile: "",
  reloadLivePreview: false,
  workspaceSwitcherRibbon: false,
  modeSwitcherRibbon: false,
  replaceNativeRibbon: false,
  trackOpenFiles: true,
  preserveRibbon: false,
  preserveSidebarLayout: false,
  restoreLayoutOnStartup: false,
};

interface ChildLeafSummary {
  id?: string;
  file?: string | null;
  mode?: unknown;
}

export function getChildIds (split: WorkspaceLayoutNode, leafs: ChildLeafSummary[] = []): ChildLeafSummary[] {
  if (split.type === "leaf") {
    leafs.push({ id: split.id, file: split.state?.state?.file, mode: split.state?.state?.mode });
  } else if (split.type === "split" || split.type === "tabs") {
    split.children?.forEach(child => {
      getChildIds(child, leafs);
    });
  }
  return leafs;
}

export class WorkspacesPlusSettingsTab extends PluginSettingTab {
  plugin: WorkspacesPlus;

  constructor (app: App, plugin: WorkspacesPlus) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Thin wrapper so internal refreshes (e.g. after a rename, see buildWorkspaceRenameSetting's
  // onRenamed below) can call renderSettings() directly instead of this deprecated override --
  // this project's lint config forbids suppressing that warning, and re-running Obsidian's own
  // display() lifecycle method isn't otherwise necessary for a plain internal re-render.
  display (): void {
    this.renderSettings();
  }

  renderSettings (): void {
    const { containerEl } = this;
    containerEl.empty();

    if (!this.plugin.utils.isNativePluginEnabled) {
      new Setting(containerEl)
        .setName("请先在「设置 → 核心插件」中启用「工作区」。")
        .setHeading();
      return;
    }
    buildPersonalSettings(containerEl, this.plugin);
    new Setting(containerEl).setName("快速切换").setHeading();
    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showInstructions.name)
      .setDesc(TOGGLE_TEXT.showInstructions.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showInstructions).onChange(value => {
          this.plugin.settings.showInstructions = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showDeletePrompt.name)
      .setDesc(TOGGLE_TEXT.showDeletePrompt.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showDeletePrompt).onChange(value => {
          this.plugin.settings.showDeletePrompt = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showWorkspaceDescriptions.name)
      .setDesc(TOGGLE_TEXT.showWorkspaceDescriptions.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showWorkspaceDescriptions).onChange(value => {
          this.plugin.settings.showWorkspaceDescriptions = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showWorkspaceIconInSwitcher.name)
      .setDesc(TOGGLE_TEXT.showWorkspaceIconInSwitcher.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showWorkspaceIconInSwitcher).onChange(value => {
          this.plugin.settings.showWorkspaceIconInSwitcher = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showWorkspaceIconInStatusBar.name)
      .setDesc(TOGGLE_TEXT.showWorkspaceIconInStatusBar.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showWorkspaceIconInStatusBar).onChange(value => {
          this.plugin.settings.showWorkspaceIconInStatusBar = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.updateStatusBarIcon();
        })
      );

    new Setting(containerEl)
      .setName(WORKSPACE_BADGES_TEXT.name)
      .setDesc(WORKSPACE_BADGES_TEXT.desc)
      .addDropdown(dropdown =>
        dropdown
          .addOptions(WORKSPACE_BADGE_OPTIONS)
          .setValue(this.plugin.settings.workspaceBadges)
          .onChange(value => {
            this.plugin.settings.workspaceBadges = value as WorkspaceBadgeMode;
            void this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.workspaceSwitcherRibbon.name)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.workspaceSwitcherRibbon).onChange(value => {
          this.plugin.settings.workspaceSwitcherRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleWorkspaceRibbonButton();
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.replaceNativeRibbon.name)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.replaceNativeRibbon).onChange(value => {
          this.plugin.settings.replaceNativeRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleNativeWorkspaceRibbon();
        })
      );

    if (!this.plugin.app.isMobile) {
      new Setting(containerEl)
        .setName(TOGGLE_TEXT.modeSwitcherRibbon.name)
        .addToggle(toggle =>
          toggle.setValue(this.plugin.settings.modeSwitcherRibbon).onChange(value => {
            this.plugin.settings.modeSwitcherRibbon = value;
            void this.plugin.saveData(this.plugin.settings);
            this.plugin.toggleModeRibbonButton();
          })
        );
    }

    new Setting(containerEl).setName("工作区增强").setHeading();

    new Setting(containerEl)
      .setName(
        createFragment(function (e) {
          e.appendText("工作区模式");
          e.createSpan({
            cls: "flair mod-pop",
            text: "测试功能",
          });
        })
      )
      .setDesc(
        this.plugin.app.isMobile
          ? "模式仅支持桌面端，因为它会保存和恢复核心设置，可能覆盖移动端专属设置。移动端仍可正常切换普通工作区。"
          : TOGGLE_TEXT.workspaceSettings.desc
      )
      .then(setting => {
        setting.settingEl.addClass("workspace-modes");
        if (this.plugin.settings.workspaceSettings && !this.plugin.app.isMobile) setting.settingEl.addClass("is-enabled");
        else setting.settingEl.removeClass("is-enabled");
        setting.addToggle(toggle => {
          toggle.setValue(this.plugin.settings.workspaceSettings).onChange(value => {
            if (value) setting.settingEl.addClass("is-enabled");
            else setting.settingEl.removeClass("is-enabled");
            this.plugin.settings.workspaceSettings = value;
            void this.plugin.saveData(this.plugin.settings);
            if (value) this.plugin.enableModesFeature();
            else this.plugin.disableModesFeature();
          });
          if (this.plugin.app.isMobile) toggle.setDisabled(true);
        });
      });

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.saveOnChange.name)
      .setDesc(TOGGLE_TEXT.saveOnChange.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.saveOnChange).onChange(value => {
          this.plugin.settings.saveOnChange = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.trackOpenFiles.name)
      .setDesc(TOGGLE_TEXT.trackOpenFiles.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.trackOpenFiles).onChange(value => {
          this.plugin.settings.trackOpenFiles = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.preserveRibbon.name)
      .setDesc(TOGGLE_TEXT.preserveRibbon.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.preserveRibbon).onChange(value => {
          this.plugin.settings.preserveRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.preserveSidebarLayout.name)
      .setDesc(TOGGLE_TEXT.preserveSidebarLayout.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.preserveSidebarLayout).onChange(value => {
          this.plugin.settings.preserveSidebarLayout = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.systemDarkMode.name)
      .setClass("requires-workspace-modes")
      .setDesc(TOGGLE_TEXT.systemDarkMode.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.systemDarkMode).onChange(value => {
          this.plugin.settings.systemDarkMode = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.reloadLivePreview.name)
      .setClass("requires-workspace-modes")
      .setDesc(TOGGLE_TEXT.reloadLivePreview.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.reloadLivePreview).onChange(value => {
          this.plugin.settings.reloadLivePreview = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.restoreLayoutOnStartup.name)
      .setDesc(TOGGLE_TEXT.restoreLayoutOnStartup.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.restoreLayoutOnStartup).onChange(value => {
          this.plugin.settings.restoreLayoutOnStartup = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("工作区列表")
      .setHeading()
      .addExtraButton(button =>
        button
          .setIcon("plus")
          .setTooltip("新建空白工作区")
          .onClick(() => {
            // No name option supplied, so this can't fail (see createBlankWorkspace's own
            // comment) -- checked anyway since its return type no longer lets `name` be read
            // without narrowing on `success` first.
            const result = this.plugin.utils.createBlankWorkspace();
            if (!result.success) return;
            new Notice(`已创建工作区「${result.name}」，可在下方重命名或配置。`);
            this.renderSettings();
          })
      );

    let { workspaces } = this.plugin.workspacePlugin;
    Object.entries(workspaces).forEach(entry => {
      const [workspaceName, workspace] = entry;
      const workspaceSettings = this.plugin.utils.getWorkspaceSettings(workspaceName);

      if (this.plugin.utils.isMode(workspaceName)) return;

      // containerEl.createEl("h3", {
      //   text: workspaceName,
      // });

      new Setting(containerEl)
        .setHeading()
        .setClass("settings-heading")
        .setName(workspaceName)
        .then(setting => {
          setting.settingEl.addClass("is-collapsed");

          const iconContainer = createSpan({
            cls: "settings-collapse-indicator",
          });

          setIcon(iconContainer, "right-triangle");

          setting.nameEl.prepend(iconContainer);

          setting.settingEl.addEventListener("click", e => {
            setting.settingEl.toggleClass("is-collapsed", !setting.settingEl.hasClass("is-collapsed"));
          });
        });
      const subContainerEL = containerEl.createDiv({ cls: "settings-container" });
      new Setting(subContainerEL).setName("布局规模").setDesc(summarizeLayout(workspace));
      buildFavoriteSetting(new Setting(subContainerEL).setName("收藏此工作区"), this.plugin, workspaceName);
      buildDuplicateSetting(new Setting(subContainerEL).setName("复制工作区"), this.plugin, workspaceName, () => this.renderSettings());
      new Setting(subContainerEL)
        .setName("工作区名称")
        .setDesc("重命名时会同步迁移本插件已绑定的快捷键。")
        .then(setting =>
          buildWorkspaceRenameSetting(setting, this.plugin, workspaceName, () => this.renderSettings())
        );
      new Setting(subContainerEL).setName("工作区说明").addText(textfield => {
        textfield.inputEl.type = "text";
        textfield.inputEl.parentElement?.addClass("search-input-container");
        textfield.setValue(String(workspaceSettings?.description ?? ""));
        textfield.onChange(value => {
          workspaceSettings.description = value;
          this.plugin.workspacePlugin.saveData();
        });
      });

      new Setting(subContainerEL)
        .setName("工作区图标")
        .setDesc("显示在切换列表的工作区名称旁；留空使用默认图标。")
        .then(setting =>
          buildWorkspaceIconSetting(setting, this.app, workspaceSettings, () => this.plugin.workspacePlugin.saveData())
        );

      new Setting(subContainerEL)
        .setName("工作区图标颜色")
        .then(setting => buildWorkspaceIconColorSetting(setting, workspaceSettings, () => this.plugin.workspacePlugin.saveData()));

      // new Setting(containerEl)
      //   .setName(`Auto save workspace on changes (not yet implemented)`)
      //   // .setDesc(``)
      //   .addToggle(toggle =>
      //     toggle.setValue(workspaceSettings?.autoSave).onChange(value => {
      //       workspaceSettings.autoSave = value;
      //       this.plugin.workspacePlugin.saveData();
      //     })
      //   );

      new Setting(subContainerEL).setHeading().setName("标签页文件覆盖");

      for (const leaf of getChildIds(workspace.main)) {
        // 缺少 ID 的标签页无法定位，不能把覆盖配置写入共用的空键。
        const leafId = leaf.id;
        if (!leafId) continue;
        const currentFile = workspaceSettings.fileOverrides?.[leafId];
        new Setting(subContainerEL)
          .setName(leafId)
          .setClass("file-override")
          .addSearch(cb => {
            new FileSuggest(this.app, cb.inputEl);
            cb.setPlaceholder(leaf.file ? leaf.file : "");
            if (currentFile) cb.setValue(currentFile);
            // TODO: Allow for assigning names to pane IDs
            cb.onChange(overrideFile => {
              // store leaf ID and filename override to workspace settings
              // the workspace load function will look for overrides and apply them
              // need to create a function that can search for a leaf id and update it
              if (!workspaceSettings.fileOverrides) workspaceSettings.fileOverrides = {};
              if (overrideFile) workspaceSettings.fileOverrides[leafId] = overrideFile;
              else delete workspaceSettings.fileOverrides[leafId];
            });
          });
      }

      new Setting(subContainerEL)
        .setName("删除此工作区")
        .then(setting => buildWorkspaceDeleteSetting(setting, this.plugin, workspaceName, () => this.renderSettings()));
    });

    new Setting(containerEl).setName("模式列表").setHeading().setClass("requires-workspace-modes");

    Object.entries(workspaces).forEach(entry => {
      const [modeName] = entry;
      if (!this.plugin.utils.isMode(modeName)) return;
      const modeSettings = this.plugin.utils.getModeSettings(modeName);

      new Setting(containerEl)
        .setHeading()
        .setClass("settings-heading")
        .setClass("requires-workspace-modes")
        .setName(modeName?.replace(/^mode: /i, ""))
        .then(setting => {
          setting.settingEl.addClass("is-collapsed");

          const iconContainer = createSpan({
            cls: "settings-collapse-indicator",
          });

          setIcon(iconContainer, "right-triangle");

          setting.nameEl.prepend(iconContainer);

          setting.settingEl.addEventListener("click", e => {
            setting.settingEl.toggleClass("is-collapsed", !setting.settingEl.hasClass("is-collapsed"));
          });
        });

      const subContainerEL = containerEl.createDiv({ cls: "settings-container" });

      new Setting(subContainerEL)
        .setName(`保存并恢复左右侧栏状态`)
        .setClass("requires-workspace-modes")
        // .setDesc(``)
        .addToggle(toggle =>
          toggle.setValue(modeSettings?.saveSidebar).onChange(value => {
            modeSettings.saveSidebar = value;
            this.plugin.workspacePlugin.saveData();
          })
        );
    });
  }

  // 新客户端调用声明式设置；旧客户端仍走上面的 display()。
  getSettingDefinitions(): SettingDefinitionItem[] {
    return declarativeGetSettingDefinitions(this);
  }

  getControlValue(key: string): unknown {
    return declarativeGetControlValue(this, key);
  }

  setControlValue(key: string, value: unknown): void {
    declarativeSetControlValue(this, key, value);
  }
}

// setting.settingEl.addEventListener("click", (e) => {
//   setting.settingEl.toggleClass(
//     "is-collapsed",
//     !setting.settingEl.hasClass("is-collapsed")
//   );
// });
