import { FuzzySuggestModal, Notice, Setting } from "obsidian";
import type { SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import type WorkspacesPlus from "./main";
import { createConfirmationDialog } from "./confirm";
import { summarizeLayout } from "./personalWorkspaces";
import type { WorkspaceBackup } from "./personalWorkspaces";

export class WorkspaceBackupModal extends FuzzySuggestModal<WorkspaceBackup> {
  constructor(private plugin: WorkspacesPlus) {
    super(plugin.app);
    this.setPlaceholder("选择要恢复的工作区备份…");
  }
  getItems(): WorkspaceBackup[] { return this.plugin.settings.workspaceBackups; }
  getItemText(backup: WorkspaceBackup): string {
    return `${new Date(backup.createdAt).toLocaleString("zh-CN")} · ${backup.label} · ${Object.keys(backup.workspaces).length} 个工作区`;
  }
  onChooseItem(backup: WorkspaceBackup): void {
    createConfirmationDialog(this.app, {
      title: "恢复工作区备份", cta: "恢复",
      text: "将覆盖备份中同名工作区的已保存配置，保留其他工作区；不切换当前屏幕、不修改笔记。恢复前会自动备份当前配置。",
      onAccept: async () => { await this.plugin.restoreWorkspaceBackup(backup); },
    });
  }
}

export function openBackupPicker(plugin: WorkspacesPlus): void {
  if (!plugin.settings.workspaceBackups.length) { new Notice("还没有备份，请先创建工作区配置备份。"); return; }
  new WorkspaceBackupModal(plugin).open();
}

export function buildBackupSetting(setting: Setting, plugin: WorkspacesPlus): void {
  setting.setDesc(`已保存 ${plugin.settings.workspaceBackups.length} 份备份。仅备份已保存的工作区配置，不包含笔记正文。`)
    .addButton(button => button.setButtonText("创建备份").onClick(async () => {
      await plugin.backupWorkspaces("手动备份");
      setting.setDesc(`已保存 ${plugin.settings.workspaceBackups.length} 份备份。仅备份已保存的工作区配置，不包含笔记正文。`);
    }))
    .addButton(button => button.setButtonText("恢复备份").onClick(() => openBackupPicker(plugin)));
}

export function buildFavoriteSetting(setting: Setting, plugin: WorkspacesPlus, name: string): void {
  setting.addToggle(toggle => toggle.setValue(plugin.settings.favoriteWorkspaces.includes(name)).onChange(async value => {
    plugin.settings.favoriteWorkspaces = plugin.settings.favoriteWorkspaces.filter(item => item !== name);
    if (value) plugin.settings.favoriteWorkspaces.push(name);
    await plugin.saveSettings();
  }));
}

export function buildDuplicateSetting(setting: Setting, plugin: WorkspacesPlus, name: string, refresh: () => void): void {
  setting.addButton(button => button.setButtonText("复制已保存布局").onClick(async () => {
    await plugin.duplicateSavedWorkspace(name);
    refresh();
  }));
}

export function buildPersonalSettings(container: HTMLElement, plugin: WorkspacesPlus): void {
  new Setting(container).setName("个人工作区管理").setHeading();
  new Setting(container).setName("工作区排序").setDesc("收藏始终置顶，其余按最近使用或名称排序。")
    .addDropdown(dropdown => dropdown.addOptions({ recent: "最近使用", name: "名称" })
      .setValue(plugin.settings.workspaceSort).onChange(async value => {
        plugin.settings.workspaceSort = value === "name" ? "name" : "recent";
        await plugin.saveSettings();
      }));
  new Setting(container).setName("显示布局规模").setDesc("在切换列表显示标签页、笔记数量，便于识别大型布局。")
    .addToggle(toggle => toggle.setValue(plugin.settings.showLayoutSummary).onChange(async value => {
      plugin.settings.showLayoutSummary = value; await plugin.saveSettings();
    }));
  new Setting(container).setName("备份保留数量").setDesc("保留最新的 1–20 份，默认 5 份。降低数量会移除较旧备份。")
    .addDropdown(dropdown => dropdown.addOptions({ "1": "1 份", "5": "5 份", "10": "10 份", "20": "20 份" })
      .setValue(String(plugin.settings.backupLimit)).onChange(async value => { await plugin.setBackupLimit(Number(value)); }));
  buildBackupSetting(new Setting(container).setName("工作区配置备份"), plugin);
}

export function personalSettingDefinitions(plugin: WorkspacesPlus): SettingDefinitionItem {
  return { type: "group", heading: "个人工作区管理", items: [
    { name: "工作区排序", desc: "收藏始终置顶，其余按最近使用或名称排序。",
      control: { type: "dropdown", key: "workspaceSort", options: { recent: "最近使用", name: "名称" } } },
    { name: "显示布局规模", desc: "在切换列表显示标签页、笔记数量，便于识别大型布局。",
      control: { type: "toggle", key: "showLayoutSummary" } },
    { name: "备份保留数量", desc: "降低数量会移除较旧备份。",
      render: setting => { setting.addDropdown(dropdown => dropdown.addOptions({ "1": "1 份", "5": "5 份", "10": "10 份", "20": "20 份" })
        .setValue(String(plugin.settings.backupLimit)).onChange(async value => { await plugin.setBackupLimit(Number(value)); })); } },
    { name: "工作区配置备份", render: setting => buildBackupSetting(setting, plugin) },
  ] };
}

export function personalWorkspaceDefinitions(plugin: WorkspacesPlus, name: string, refresh: () => void): SettingDefinitionPage["items"] {
  return [
    { name: "布局规模", desc: summarizeLayout(plugin.workspacePlugin.workspaces[name]) },
    { name: "收藏此工作区", desc: "收藏会显示在切换列表顶部。", render: setting => buildFavoriteSetting(setting, plugin, name) },
    { name: "复制工作区", desc: "复制已保存的布局与设置，不切换当前屏幕。", render: setting => buildDuplicateSetting(setting, plugin, name, refresh) },
  ];
}
