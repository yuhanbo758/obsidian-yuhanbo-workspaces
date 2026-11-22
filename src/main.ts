import {
  Plugin,
  WorkspacePluginInstance,
  setIcon,
  Notice,
  debounce,
  WorkspaceCustomSettings,
  Workspaces,
} from "obsidian";
import { WorkspacesPlusSettings, WorkspacesPlusSettingsTab, DEFAULT_SETTINGS, DEFAULT_WORKSPACE_ICON } from "./settings";
import { WorkspacesPlusPluginWorkspaceModal } from "./workspaceModal";
import { WorkspacesPlusPluginModeModal } from "./modeModal";
import { NewWorkspaceModal } from "./newWorkspaceModal";
import { around } from "monkey-around";
import Utils from "./utils";
import { cycleWorkspace as runWorkspaceCycle } from "./workspaceCycle";
import { cloneWorkspace, createWorkspaceBackup, duplicateWorkspace, limitedBackups, orderedWorkspaceNames, rememberWorkspace, renamePersonalWorkspace } from "./personalWorkspaces";
import type { WorkspaceBackup } from "./personalWorkspaces";
import { openBackupPicker } from "./personalWorkspaceUI";

export default class WorkspacesPlus extends Plugin {
  settings: WorkspacesPlusSettings;
  workspacePlugin: WorkspacePluginInstance;
  debug: boolean;
  workspaceLoading: boolean;
  statusBarWorkspace: HTMLElement;
  statusBarMode: HTMLElement;
  ribbonIconMode: HTMLElement;
  ribbonIconWorkspaces: HTMLElement;
  nativeWorkspaceRibbonItem: HTMLElement;
  isNativePluginEnabled: boolean;
  utils: Utils;
  settingsTab: WorkspacesPlusSettingsTab;
  // Set when setPlatformWorkspace() triggers a workspace-load at startup (only happens when
  // settings.restoreLayoutOnStartup is on), so enableModesFeature()'s own onWorkspaceLoad()
  // bootstrap call can skip re-running it. One-shot: consumed (cleared) the first time
  // enableModesFeature() checks it, so a later, user-triggered call to enableModesFeature()
  // (e.g. toggling modes on mid-session) still does its own onWorkspaceLoad() call as before.
  private startupWorkspaceLoadTriggered = false;
  // 每次切换或卸载递增，防止旧异步恢复覆盖新工作区及卸载后的状态。
  private workspaceLoadGeneration = 0;

  async onload() {
    this.debug = false;
    // load settings
    await this.loadSettings();
    this.utils = new Utils(this);
    this.workspacePlugin = this.utils.workspacePlugin;
    this.isNativePluginEnabled = this.utils.isNativePluginEnabled;
    this.installWorkspaceHooks();
    this.registerEvent(
      this.app.internalPlugins.on("change", plugin => {
        if (plugin?.instance?.id == "workspaces") {
          if (plugin?._loaded) {
            // load
            this.isNativePluginEnabled = true;
            // this.setWorkspaceName();
          } else {
            // unload
            this.isNativePluginEnabled = false;
            // this.setWorkspaceName();
          }
        }
      })
    );

    // add the settings tab
    this.settingsTab = new WorkspacesPlusSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.registerEventHandlers();
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      // store current Obsidian settings into local plugin storage -- must run before
      // setPlatformWorkspace(), which (when settings.restoreLayoutOnStartup is on) can trigger
      // a synchronous workspace-load that reads globalSettings back via mergeGlobalSettings();
      // if globalSettings were still empty at that point, applySettings() would overwrite (and
      // persist) an empty app.vault.config.
      if (this.modesEnabled) this.storeGlobalSettings();
      this.setPlatformWorkspace();

      this.backupCoreConfig();

      window.setTimeout(() => {
        this.registerWorkspaceHotkeys();
        this.setWorkspaceAttribute();
        this.addStatusBarIndicator.apply(this);
        if (this.modesEnabled) this.enableModesFeature();
        if (this.settings.workspaceSwitcherRibbon) {
          this.toggleWorkspaceRibbonButton();
          this.toggleNativeWorkspaceRibbon();
        }
        if (this.modesEnabled && this.settings.modeSwitcherRibbon) {
          this.toggleModeRibbonButton();
        }
      }, 100);
    });
  }

  backupCoreConfig() {
    void this.backupConfigFile("workspaces");
    void this.backupConfigFile("app");
    void this.backupConfigFile("appearance");
  }

  async backupConfigFile(configType: string): Promise<void> {
    const configFileName = this.manifest.dir + `/${configType}.json.bak`;
    const fileExists = await this.app.vault.exists(configFileName);
    if (!fileExists) {
      const configData = await this.app.vault.readConfigJson(configType);
      if (configData && typeof configData === "object")
        return this.app.vault.writeJson(configFileName, configData, true);
    }
  }

  onunload(): void {
    // 卸载后，尚未完成的文件恢复任务不得再次应用布局或保存状态。
    ++this.workspaceLoadGeneration;
    if (this.modesEnabled) {
      let combinedSettings = this.mergeGlobalSettings();
      this.applySettings(combinedSettings);
    }
    delete document.body.dataset.workspaceMode;
    delete document.body.dataset.workspaceName;
    if (this.settings.replaceNativeRibbon && this.nativeWorkspaceRibbonItem) {
      this.nativeWorkspaceRibbonItem.show();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<WorkspacesPlusSettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async setBackupLimit(limit: number): Promise<void> {
    this.settings.backupLimit = [1, 5, 10, 20].includes(limit) ? limit : 5;
    this.settings.workspaceBackups = limitedBackups(this.settings.workspaceBackups, this.settings.backupLimit);
    await this.saveSettings();
  }

  async backupWorkspaces(label: string): Promise<void> {
    if (!this.isNativePluginEnabled) { new Notice("请先启用核心插件「工作区」。"); return; }
    const backup = createWorkspaceBackup(this.workspacePlugin.workspaces, label);
    const previousBackups = this.settings.workspaceBackups;
    this.settings.workspaceBackups = limitedBackups([backup, ...this.settings.workspaceBackups], this.settings.backupLimit);
    try { await this.saveSettings(); }
    catch (error) {
      this.settings.workspaceBackups = previousBackups;
      new Notice("工作区备份保存失败，请检查库目录的写入权限。");
      throw error;
    }
    new Notice("已备份工作区配置。");
  }

  async restoreWorkspaceBackup(backup: WorkspaceBackup): Promise<void> {
    if (!this.isNativePluginEnabled) { new Notice("请先启用核心插件「工作区」。"); return; }
    // 先持久化恢复前的配置；失败时不覆盖核心工作区。只合并已保存配置，不切换屏幕。
    await this.backupWorkspaces("恢复前自动备份");
    const previousWorkspaces = cloneWorkspace(this.workspacePlugin.workspaces);
    try {
      Object.assign(this.workspacePlugin.workspaces, cloneWorkspace(backup.workspaces));
      await Promise.resolve(this.workspacePlugin.saveData());
    } catch (error) {
      this.workspacePlugin.workspaces = previousWorkspaces;
      new Notice("配置恢复保存失败，已还原内存中的工作区；请检查配置文件后重试。");
      throw error;
    }
    this.registerWorkspaceHotkeys();
    new Notice("备份已恢复，请从切换列表选择需要的工作区。");
  }

  async duplicateSavedWorkspace(name: string): Promise<void> {
    if (!this.isNativePluginEnabled) return;
    const duplicateName = duplicateWorkspace(this.workspacePlugin.workspaces, name);
    if (!duplicateName) { new Notice("请先选择一个已保存的普通工作区。"); return; }
    await Promise.resolve(this.workspacePlugin.saveData());
    this.registerWorkspaceHotkeys();
    new Notice(`已创建工作区「${duplicateName}」。`);
  }

  registerCommands() {
    this.addCommand({ id: "obsidian-yuhanbo-backup-workspaces", name: "备份工作区配置",
      callback: async () => { await this.backupWorkspaces("手动备份"); } });
    this.addCommand({ id: "obsidian-yuhanbo-restore-workspaces", name: "恢复工作区配置备份",
      callback: () => openBackupPicker(this) });
    this.addCommand({ id: "obsidian-yuhanbo-duplicate-workspace", name: "复制当前已保存的工作区",
      callback: async () => { await this.duplicateSavedWorkspace(this.workspacePlugin.activeWorkspace); } });
    this.addCommand({
      id: "obsidian-yuhanbo-open-workspaces-plus",
      name: "打开工作区切换器",
      callback: () => new WorkspacesPlusPluginWorkspaceModal(this, this.settings, true).open(),
    });
    this.addCommand({
      id: "obsidian-yuhanbo-save-workspace",
      name: `保存当前工作区`,
      callback: () => {
        this.workspacePlugin.saveWorkspace(this.workspacePlugin.activeWorkspace);
        new Notice("已保存工作区：" + this.workspacePlugin.activeWorkspace);
      },
    });
    this.addCommand({
      id: "obsidian-yuhanbo-cycle-workspace",
      name: "切换到下一个工作区",
      callback: () => this.cycleWorkspace(),
    });
    this.addCommand({
      id: "obsidian-yuhanbo-save-and-cycle-workspace",
      name: "保存当前工作区并切换到下一个",
      callback: () => this.cycleWorkspace(true),
    });
    this.addCommand({
      id: "obsidian-yuhanbo-sync-ribbon-to-all-workspaces",
      name: "将当前工具栏布局同步到全部工作区",
      callback: () => this.syncRibbonToAllWorkspaces(),
    });
    this.addCommand({
      id: "obsidian-yuhanbo-sync-sidebar-to-all-workspaces",
      name: "将当前左右侧栏布局同步到全部工作区",
      callback: () => this.syncSidebarToAllWorkspaces(),
    });
    this.addCommand({
      id: "obsidian-yuhanbo-new-empty-workspace",
      name: "新建空白工作区",
      callback: () => {
        if (!this.isNativePluginEnabled) return;
        new NewWorkspaceModal(this).open();
      },
    });
  }

  syncRibbonToAllWorkspaces(): void {
    if (!this.isNativePluginEnabled) return;
    const count = this.utils.syncRibbonAcrossWorkspaces();
    if (count === null) {
      new Notice("当前没有可同步的工具栏布局。");
    } else if (count > 0) {
      this.workspacePlugin.saveData();
      new Notice(`已将工具栏布局同步到 ${count} 个工作区。`);
    } else {
      new Notice("没有其他工作区可同步工具栏布局。");
    }
  }

  syncSidebarToAllWorkspaces(): void {
    if (!this.isNativePluginEnabled) return;
    const count = this.utils.syncSidebarAcrossWorkspaces();
    if (count === null) {
      new Notice("当前没有可同步的侧栏布局。");
    } else if (count > 0) {
      this.workspacePlugin.saveData();
      new Notice(`已将侧栏布局同步到 ${count} 个工作区。`);
    } else {
      new Notice("没有其他工作区可同步侧栏布局。");
    }
  }

  cycleWorkspace(saveCurrent: boolean = false): void {
    const activeWorkspace = this.workspacePlugin.activeWorkspace;
    runWorkspaceCycle(
      orderedWorkspaceNames(Object.keys(this.workspacePlugin.workspaces), this.settings),
      activeWorkspace,
      workspaceName => this.workspacePlugin.loadWorkspace(workspaceName),
      saveCurrent ? workspaceName => this.workspacePlugin.saveWorkspace(workspaceName) : undefined
    );
  }

  registerEventHandlers() {
    this.registerEvent(this.app.workspace.on("workspace-delete", this.onWorkspaceDelete));
    this.registerEvent(this.app.workspace.on("workspace-rename", this.onWorkspaceRename));
    this.registerEvent(this.app.workspace.on("workspace-save", this.onWorkspaceSave));
    this.registerEvent(this.app.workspace.on("workspace-load", this.onWorkspaceLoad));
    this.registerEvent(this.app.workspace.on("layout-change", this.onLayoutChange));
    this.registerEvent(this.app.workspace.on("resize", this.onLayoutChange));
  }

  // Modes snapshot and restore Obsidian's entire core config (app.json, which is shared
  // across platforms). applySettings() replaces app.vault.config wholesale, so restoring a
  // desktop-captured snapshot on mobile would drop mobile-only keys (mobile toolbar, pull
  // action, etc.) and persist the loss. Until Modes captures/merges config platform-safely,
  // the feature is desktop-only regardless of the stored toggle.
  get modesEnabled(): boolean {
    return this.settings.workspaceSettings && !this.app.isMobile;
  }

  get changeWorkspaceButton() {
    return this.statusBarWorkspace?.querySelector(".status-bar-item-segment.name");
  }

  get changeWorkspaceIcon() {
    return this.statusBarWorkspace?.querySelector<HTMLElement>(".status-bar-item-segment.icon");
  }

  // Off by default (see TOGGLE_TEXT.showWorkspaceIconInStatusBar in settings.ts): applies the
  // active workspace's own icon/color over the plugin's default status bar icon when enabled,
  // and restores the default otherwise. Called on toggle and whenever the active workspace
  // changes (see setWorkspaceName).
  updateStatusBarIcon(): void {
    const iconEl = this.changeWorkspaceIcon;
    if (!iconEl) return;
    const workspaceSettings = this.settings.showWorkspaceIconInStatusBar
      ? this.utils.getWorkspaceSettings(this.utils.activeWorkspace)
      : null;
    setIcon(iconEl, workspaceSettings?.icon || DEFAULT_WORKSPACE_ICON);
    if (workspaceSettings?.iconColor) iconEl.style.color = workspaceSettings.iconColor;
    else iconEl.style.removeProperty("color");
  }

  get changeModeButton() {
    return this.statusBarMode?.querySelector(".status-bar-item-segment.name");
  }

  setPlatformWorkspace(): void {
    if (!this.isNativePluginEnabled) return;
    // note: don't call this too early in the init process or it will wipe all workspaces
    const _activeWorkspace = this.app.isMobile
      ? this.settings.activeWorkspaceMobile
      : this.settings.activeWorkspaceDesktop;
    if (!_activeWorkspace) return;
    if (this.settings.restoreLayoutOnStartup) {
      // loadWorkspace (not setActiveWorkspace) so the saved layout is actually reapplied on
      // startup, not just the active-workspace label. Obsidian's own setActiveWorkspace only
      // sets that label; without an actual reload, the status bar can end up naming a
      // workspace whose layout was never restored, disagreeing with whatever Obsidian's
      // native session-restore happened to reopen. Opt-in (see TOGGLE_TEXT.restoreLayoutOnStartup
      // in settings.ts) because it also means every plugin load -- startup, and toggling the
      // plugin off/on in Community Plugins -- discards whatever unsaved layout is currently
      // on screen in favor of that workspace's last-saved copy.
      this.startupWorkspaceLoadTriggered = true;
      this.workspacePlugin.loadWorkspace(_activeWorkspace);
    } else {
      // Only update the remembered active-workspace label; leave whatever layout is already
      // on screen (e.g. Obsidian's own native session-restore) untouched.
      this.workspacePlugin.setActiveWorkspace(_activeWorkspace);
    }
  }

  toggleNativeWorkspaceRibbon(): void {
    if (this.settings.replaceNativeRibbon) {
      if (!this.nativeWorkspaceRibbonItem) {
        this.nativeWorkspaceRibbonItem = document.body.querySelector('[aria-label="管理工作区"]');
      }
      this.nativeWorkspaceRibbonItem?.hide();
    } else {
      this.nativeWorkspaceRibbonItem?.show();
    }
  }

  toggleWorkspaceRibbonButton(): void {
    if (this.settings.workspaceSwitcherRibbon) {
      if (!this.ribbonIconWorkspaces) {
        this.ribbonIconWorkspaces = this.addRibbonIcon("pane-layout", "管理工作区", async () =>
          new WorkspacesPlusPluginWorkspaceModal(this, this.settings, true).open()
        );
      }
      this.ribbonIconWorkspaces?.show();
    } else {
      this.ribbonIconWorkspaces?.hide();
    }
  }
  toggleModeRibbonButton(): void {
    if (this.modesEnabled && this.settings.modeSwitcherRibbon) {
      if (!this.ribbonIconMode) {
        this.ribbonIconMode = this.addRibbonIcon("gear", "管理模式", async () =>
          new WorkspacesPlusPluginModeModal(this, this.settings, true).open()
        );
      }
      this.ribbonIconMode?.show();
    } else {
      this.ribbonIconMode?.hide();
    }
  }

  enableModesFeature() {
    if (this.modesEnabled) {
      this.storeGlobalSettings();
      this.addStatusBarIndicator("mode");
      this.addCommand({
        id: "obsidian-yuhanbo-open-workspaces-plus-modes",
        name: "打开模式切换器",
        callback: () => new WorkspacesPlusPluginModeModal(this, this.settings, true).open(),
      });
      if (this.startupWorkspaceLoadTriggered) {
        // setPlatformWorkspace() already fired a workspace-load (and therefore
        // onWorkspaceLoad) synchronously at startup -- avoid running it a second time.
        this.startupWorkspaceLoadTriggered = false;
      } else {
        if (this.debug) console.debug("toggle load", this.workspacePlugin.activeWorkspace);
        this.onWorkspaceLoad(this.workspacePlugin.activeWorkspace);
      }
      this.registerEvent(this.app.vault.on("config-changed", this.onConfigChange));
    }
  }

  disableModesFeature() {
    // Only undo what enableModesFeature() actually set up. It no-ops unless modesEnabled
    // (so it never runs on mobile), and statusBarMode is the marker it leaves behind.
    // Without this, toggling the persisted `workspaceSettings` off while the feature was
    // never active would run applySettings() over an empty globalSettings and wipe app.json.
    if (!this.statusBarMode) return;
    this.app.vault.off("config-changed", this.onConfigChange);
    let combinedSettings = this.mergeGlobalSettings();
    this.applySettings(combinedSettings);
    this.statusBarMode?.detach();
    this.statusBarMode = null;
    this.app.commands.removeCommand(`${this.manifest.id}:obsidian-yuhanbo-open-workspaces-plus-modes`);
  }

  addStatusBarIndicator(modalType: string = "workspace") {
    let statusBarItem;
    const itemName = modalType == "mode" ? "statusBarMode" : "statusBarWorkspace";
    if (this[itemName]) return;
    else statusBarItem = this[itemName] = this.addStatusBarItem();

    statusBarItem.addClass(`${modalType}-switcher`);
    statusBarItem.setAttribute("aria-label", modalType === "workspace" ? "切换工作区" : "切换模式");
    statusBarItem.setAttribute("aria-label-position", "top");
    // create the status bar icon
    const icon = statusBarItem.createSpan("status-bar-item-segment icon");
    modalType == "workspace" ? setIcon(icon, "pane-layout") : setIcon(icon, "gear"); // inject svg icon
    if (modalType == "workspace") this.updateStatusBarIcon(); // reflect the active workspace's own icon, if enabled
    // create the status bar text
    let modeText = this.utils.getActiveModeDisplayName();
    statusBarItem.createSpan({
      cls: "status-bar-item-segment name",
      text: !this.isNativePluginEnabled
        ? "核心插件「工作区」尚未启用"
        : modalType == "workspace"
        ? this.utils.activeWorkspace
        : modeText,
      prepend: false,
    });
    // register click handler
    statusBarItem.addEventListener("click", evt => this.onStatusBarClick(evt, modalType));
  }

  onStatusBarClick(evt: MouseEvent, modalType: string) {
    if (!this.isNativePluginEnabled) return;
    // handle the shift click to save current workspace shortcut
    if (evt.shiftKey === true) {
      modalType == "mode" ? this.utils.saveActiveMode() : this.utils.saveActiveWorkspace();
      // why trigger here?
      // this.app.workspace.trigger("layout-change");
      this.registerWorkspaceHotkeys();
      new Notice("已保存" + (modalType == "mode" ? "模式" : "工作区"));
    } else {
      if (modalType === "workspace") new WorkspacesPlusPluginWorkspaceModal(this, this.settings).open();
      if (modalType === "mode") new WorkspacesPlusPluginModeModal(this, this.settings).open();
    }
  }

  setWorkspaceName = debounce(
    () => {
      if (!this.isNativePluginEnabled) {
        this.changeWorkspaceButton?.setText("核心插件「工作区」尚未启用");
      } else {
        this.changeWorkspaceButton?.setText(this.utils.activeWorkspace);
        this.updateStatusBarIcon();
      }
      if (this.modesEnabled) this.changeModeButton?.setText(this.utils.getActiveModeDisplayName());
    },
    100,
    true
  );

  debouncedSave = debounce(
    // avoid overly serializing the workspace during expensive operations like window resize
    (workspaceName: string) => {
      // avoid errors if the debounced save happens in the middle of a workspace switch
      if (!this.workspaceLoading && workspaceName === this.utils.activeWorkspace) {
        if (this.debug) console.debug("layout invoked save: " + workspaceName);
        this.workspacePlugin.saveWorkspace(workspaceName);
      } else {
        if (this.debug) console.debug("skipped saving because the workspace has been changed");
      }
    },
    2000,
    true
  );

  onConfigChange = () => {
    if (!this.modesEnabled) return;
    if (this.workspaceLoading) {
      if (this.debug) console.debug("skipped save due to recent workspace switch");
      return;
    }
    const activeModeName = this.utils.activeModeName;
    if (activeModeName) {
      if (this.debug) console.debug("config invoked mode update: " + activeModeName);
      this.workspacePlugin.saveWorkspace(activeModeName);
    } else {
      if (this.debug) console.debug("config invoked global update");
      this.updateGlobalSettings();
    }
  };

  onLayoutChange = () => {
    if (!this.workspaceLoading) {
      // TODO: Handle per workspace auto save
      if (this.settings.saveOnChange) {
        this.debouncedSave(this.utils.activeWorkspace);
      }
    }
  };

  setWorkspaceAttribute() {
    const workspace = this.utils.activeWorkspace;
    document.body.dataset.workspaceName = workspace;
    if (this.modesEnabled) {
      const modeName = this.utils.getActiveModeDisplayName();
      if (modeName) document.body.dataset.workspaceMode = modeName;
    }
  }

  onWorkspaceRename = (name: string, oldName: string) => {
    renamePersonalWorkspace(this.settings, oldName, name);
    void this.saveSettings();
    this.setWorkspaceName();
    // remove the old command
    this.app.commands.removeCommand(`${this.manifest.id}:obsidian-yuhanbo-load-${oldName}`);
    const hotkeys = this.app.hotkeyManager.getHotkeys(`${this.manifest.id}:obsidian-yuhanbo-load-${oldName}`);
    // register the new command
    this.registerWorkspaceHotkeys();
    if (hotkeys) {
      // reassign any hotkeys that were assigned to the old command
      this.app.hotkeyManager.setHotkeys(this.manifest.id + ":obsidian-yuhanbo-load-" + name, hotkeys);
    }
    // update any cMenu buttons that were associated to the old command
    this.updateCMenuIcon(name, oldName);
    // persist changes to disk
    this.workspacePlugin.saveData();
  };

  updateCMenuIcon(name: string, oldName: string) {
    const cMenuPlugin = this.app.plugins.plugins["cmenu-plugin"];
    let cMenuItemIdx = cMenuPlugin?.settings.menuCommands.findIndex(cmd => cmd.id === `${this.manifest.id}:obsidian-yuhanbo-load-${oldName}`);
    if (!cMenuPlugin || cMenuItemIdx === -1) return;
    let cMenuItems = cMenuPlugin.settings.menuCommands;
    cMenuItems[cMenuItemIdx].id = `${this.manifest.id}:obsidian-yuhanbo-load-${name}`;
    cMenuItems[cMenuItemIdx].name = `${this.manifest.name}：加载工作区：${name}`;
    cMenuPlugin.saveSettings();
    // rebuild the cMenu toolbar
    dispatchEvent(new Event("cMenu-NewCommand"));
  }

  onWorkspaceDelete = (workspaceName: string) => {
    this.settings.favoriteWorkspaces = this.settings.favoriteWorkspaces.filter(name => name !== workspaceName);
    this.settings.recentWorkspaces = this.settings.recentWorkspaces.filter(name => name !== workspaceName);
    void this.saveSettings();
    this.setWorkspaceName();
    const id = this.manifest.id + ":obsidian-yuhanbo-load-" + workspaceName;
    this.app.commands.removeCommand(id);
    const hotkeys = this.app.hotkeyManager.getHotkeys(id);
    if (hotkeys) {
      this.app.hotkeyManager.removeHotkeys(this.manifest.id + ":obsidian-yuhanbo-load-" + workspaceName, hotkeys);
    }
  };

  onWorkspaceSave = async (workspaceName: string, customSettings: WorkspaceCustomSettings | null) => {
    if (!this.isNativePluginEnabled) return;
    this.setWorkspaceName();
    this.registerWorkspaceHotkeys();

    if (!customSettings) {
      customSettings = this.utils.getWorkspaceSettings(workspaceName);
    } else {
      customSettings = this.utils.setWorkspaceSettings(workspaceName, customSettings);
    }
    
    // Capture currently open files if tracking is enabled
    if (this.settings.trackOpenFiles) {
      const currentWorkspace = this.workspacePlugin.workspaces[workspaceName];
      if (currentWorkspace) {
        const openFiles = this.utils.captureOpenFiles(currentWorkspace);
        customSettings.trackedFiles = openFiles;
      }
    }
    
    if (this.modesEnabled && this.utils.isMode(workspaceName)) {
      customSettings.app = this.app.vault.config;
    }
    
    let explorerFoldState: unknown = await this.app.loadLocalStorage("file-explorer-unfold");
    if (explorerFoldState) customSettings.explorerFoldState = explorerFoldState;

    if (this.settings.preserveRibbon) {
      this.utils.syncRibbonAcrossWorkspaces();
    }

    if (this.settings.preserveSidebarLayout) {
      this.utils.syncSidebarAcrossWorkspaces();
    }

    this.workspacePlugin.saveData();
  };

  updatePlatformWorkspace(name: string) {
    if (this.app.isMobile) {
      this.settings.activeWorkspaceMobile = name;
    } else {
      this.settings.activeWorkspaceDesktop = name;
    }
  }

  mergeModeSettings(settings: WorkspaceCustomSettings): Record<string, unknown> {
    return Object.assign({}, settings["app"]) as Record<string, unknown>;
  }

  mergeGlobalSettings(): Record<string, unknown> {
    return Object.assign({}, this.settings.globalSettings);
  }

  onWorkspaceLoad = (name: string) => {
    rememberWorkspace(this.settings, name);
    this.setWorkspaceName(); // sets status bar text
    this.setWorkspaceAttribute(); // sets HTML data attribute
    this.updatePlatformWorkspace(name);
    const settings = this.utils.getWorkspaceSettings(name);
    if (this.modesEnabled) {
      const modeName = settings?.mode;
      const mode = modeName && this.utils.getModeSettings(modeName);
      let combinedSettings;
      if (mode) {
        combinedSettings = this.mergeModeSettings(mode);
        if (this.debug) console.debug("loading mode settings", mode, combinedSettings);
      } else {
        combinedSettings = this.mergeGlobalSettings();
        if (this.debug) console.debug("loading default settings", combinedSettings);
        settings && (settings["mode"] = null);
      }
      if (this.settings.systemDarkMode) this.utils.updateDarkModeFromOS(combinedSettings);

      this.needsReload(combinedSettings) && this.reloadIfNeeded();
      this.applySettings(combinedSettings);
    }
    if (settings) this.utils.updateFoldState(settings);
    void this.saveData(this.settings);
  };

  needsReload(settings: Record<string, unknown>) {
    return this.settings.reloadLivePreview && settings.livePreview != this.app.vault.config.livePreview;
  }

  reloadIfNeeded = debounce(() => {
    function sleep(ms: number) {
      return new Promise(resolve => window.setTimeout(resolve, ms));
    }
    // this is currently the only way to tell if CM6 is actually loaded on desktop
    const isLoaded = this.app.commands.editorCommands["editor:toggle-source"] ? true : false;
    const isEnabled = this.app.vault.config.livePreview;
    if (isEnabled != isLoaded) {
      void this.app.workspace.saveLayout().then(async () => {
        while (true) {
          await sleep(100);
          if (this.app.workspace.layoutReady) {
            return window.location.reload();
          } else {
            await sleep(100);
          }
        }
      });
    }
  }, 500);

  applySettings(settings: Record<string, unknown>) {
    this.app.disableCssTransition();
    // this emulates what Obsidian does when loading the core settings
    this.app.vault.config = settings;
    this.app.vault.saveConfig();
    // this.app.workspace.updateOptions();
    this.app.setTheme(settings?.theme as string);
    this.app.customCss.setTheme(settings?.cssTheme as string);
    // this.app.changeBaseFontSize(settings?.baseFontSize as number);
    this.app.customCss.loadData();
    this.app.customCss.applyCss();
    window.setTimeout(() => {
      this.app.enableCssTransition();
    }, 1000);
  }

  registerWorkspaceHotkeys() {
    const workspaceNames = Object.keys(this.workspacePlugin.workspaces);
    for (const workspaceName of workspaceNames) {
      this.addCommand({
        id: `obsidian-yuhanbo-load-${workspaceName}`,
        name: `加载工作区：${workspaceName}`,
        callback: () => {
          this.workspacePlugin.loadWorkspace(workspaceName);
        },
      });
    }
  }

  setLoadingStatus(): void {
    this.workspaceLoading = true;
  }

  updateGlobalSettings(): void {
    this.settings.globalSettings = Object.assign({}, this.settings.globalSettings, this.app.vault.config);
    void this.saveData(this.settings);
  }

  storeGlobalSettings() {
    if (Object.keys(this.settings.globalSettings).length === 0) {
      this.settings.globalSettings = Object.assign({}, this.app.vault.config);
      void this.saveData(this.settings);
    }
    return this.settings.globalSettings;
  }

  installWorkspaceHooks() {
    // patch the internal workspaces plugin to emit events on save, delete, and load
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- captured for the patched functions below, whose own `this` is rebound to workspacePlugin
    const plugin = this;
    this.register(
      around(this.workspacePlugin, {
        saveWorkspace(old) {
          return function saveWorkspace(workspaceName, ...etc) {
            // TODO: Does this prevent saving a workspace with no name?
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            let settings;
            settings = plugin.utils.getWorkspaceSettings(workspaceName);
            // old.call()'s TS typing falls back to `any` for this arity, same as bind() elsewhere in this codebase
            const result = old.call(this, workspaceName, ...etc) as unknown;
            if (plugin.debug) console.debug("workspace saved: " + workspaceName);
            this.app.workspace.trigger("workspace-save", workspaceName, settings);
            return result;
          };
        },
        deleteWorkspace(old) {
          return function deleteWorkspace(workspaceName, ...etc) {
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            // old.call()'s TS typing falls back to `any` for this arity, same as bind() elsewhere in this codebase
            const result = old.call(this, workspaceName, ...etc) as unknown;
            this.app.workspace.trigger("workspace-delete", workspaceName);
            return result;
          };
        },
        loadWorkspace(old) {
          return function loadWorkspace(workspaceName, ...etc) {
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            if (!this.workspaces[workspaceName] && !(plugin.modesEnabled && plugin.utils.isMode(workspaceName))) return;
            // 切换到模式也会使之前的普通工作区恢复失效。
            const generation = ++plugin.workspaceLoadGeneration;
            plugin.setLoadingStatus();
            let result;

            if (plugin.modesEnabled && plugin.utils.isMode(workspaceName)) {
              // if the workspace being loaded is a mode, invoke the mode loader
              let modeName = workspaceName;
              workspaceName = plugin.utils.activeWorkspace;
              result = plugin.utils.loadMode(workspaceName, modeName);
              void Promise.resolve(result).catch(() => { new Notice("模式加载失败。"); }).finally(() => {
                if (generation === plugin.workspaceLoadGeneration) plugin.workspaceLoading = false;
              });
            } else {
              const workspace = this.workspaces[workspaceName];
              if (workspace) {
                this.activeWorkspace = workspaceName;
                // Guards against a rapid second switch superseding this one while its restore
                // chain is still in flight (see the generation checks below).
                // Restore tracked files, then overrides -- sequential (not Promise.all) is
                // intentional: when the same leaf is both tracked and overridden, the override
                // must win, which only holds if it's applied after restoreOpenFiles.
                const restore: Promise<void> = plugin.settings.trackOpenFiles
                  ? plugin.utils
                      .restoreOpenFiles(workspaceName, workspace)
                      .then(() => {
                        if (generation === plugin.workspaceLoadGeneration)
                          return plugin.utils.applyFileOverrides(workspaceName, workspace);
                      })
                  : plugin.utils.applyFileOverrides(workspaceName, workspace);
                restore
                  .catch((e: unknown) => {
                    // Swallow and continue to changeLayout() regardless -- both
                    // restoreOpenFiles and applyFileOverrides already isolate per-leaf
                    // errors internally, so a rejection here means something unexpected
                    // happened, not "nothing was restored."
                    console.error("failed to restore files:", e);
                  })
                  .then(async () => {
                    // A newer switch started while restore was running -- applying this
                    // (now-stale) layout would revert the user's screen back to it.
                    if (generation !== plugin.workspaceLoadGeneration) return;
                    // Captured here, right before use, rather than at the top of loadWorkspace --
                    // the restore chain above can await real file I/O, and grabbing the ribbon
                    // before that gap risks re-applying a snapshot the user has since changed.
                    let layoutToApply: Workspaces = workspace;
                    if (plugin.settings.preserveRibbon || plugin.settings.preserveSidebarLayout) {
                      const currentLayout = plugin.app.workspace.getLayout();
                      if (plugin.settings.preserveRibbon) {
                        layoutToApply = plugin.utils.preserveRibbonInLayout(workspace, currentLayout);
                      }
                      if (plugin.settings.preserveSidebarLayout) {
                        layoutToApply = plugin.utils.preserveSidebarInLayout(layoutToApply, currentLayout);
                      }
                    }
                    await this.app.workspace.changeLayout(layoutToApply);
                    if (generation !== plugin.workspaceLoadGeneration) return;
                    // 保留后台标签页的延迟视图；布局状态已经恢复，无需实例化全部编辑器。
                    // 由 Obsidian 在标签页激活时加载，避免多屏切换集中触发插件初始化。
                    if (generation === plugin.workspaceLoadGeneration) this.saveData();
                  })
                  .catch((e: unknown) => {
                    console.error("failed to apply workspace layout:", e);
                    new Notice("工作区布局恢复失败，请检查布局或相关视图插件。");
                  })
                  .finally(() => {
                    // 大型布局可能超过两秒；恢复完成前暂停自动保存，避免保存半成品布局。
                    if (generation === plugin.workspaceLoadGeneration) plugin.workspaceLoading = false;
                  });
              }
            }
            this.app.workspace.trigger("workspace-load", workspaceName);
            return result;
          };
        },
      })
    );
  }
}
