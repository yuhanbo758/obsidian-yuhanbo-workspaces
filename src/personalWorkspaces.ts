import type { Workspaces } from "obsidian";

export interface WorkspaceBackup {
  id: string;
  createdAt: string;
  label: string;
  workspaces: Record<string, Workspaces>;
}

export interface PersonalWorkspaceSettings {
  favoriteWorkspaces: string[];
  recentWorkspaces: string[];
  workspaceSort: "name" | "recent";
  showLayoutSummary: boolean;
  backupLimit: number;
  workspaceBackups: WorkspaceBackup[];
}

export const PERSONAL_DEFAULTS: PersonalWorkspaceSettings = {
  favoriteWorkspaces: [], recentWorkspaces: [], workspaceSort: "recent",
  showLayoutSummary: true, backupLimit: 5, workspaceBackups: [],
};

export function cloneWorkspace<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function orderedWorkspaceNames(names: string[], settings: PersonalWorkspaceSettings): string[] {
  const recent = settings.workspaceSort === "recent" ? settings.recentWorkspaces : [];
  const favorites = new Set(settings.favoriteWorkspaces);
  return names.filter(name => !/^mode:/i.test(name)).sort((a, b) => {
    if (favorites.has(a) !== favorites.has(b)) return favorites.has(a) ? -1 : 1;
    const aIndex = recent.indexOf(a), bIndex = recent.indexOf(b);
    if (aIndex !== bIndex) return (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex);
    return a.localeCompare(b, "zh-CN", { numeric: true });
  });
}

export function rememberWorkspace(settings: PersonalWorkspaceSettings, name: string): void {
  if (!name || /^mode:/i.test(name)) return;
  settings.recentWorkspaces = [name, ...settings.recentWorkspaces.filter(item => item !== name)].slice(0, 20);
}

export function renamePersonalWorkspace(settings: PersonalWorkspaceSettings, oldName: string, newName: string): void {
  for (const key of ["favoriteWorkspaces", "recentWorkspaces"] as const)
    settings[key] = [...new Set(settings[key].map(name => name === oldName ? newName : name))];
}

export function summarizeLayout(workspace: Workspaces): string {
  let leaves = 0, markdown = 0;
  const visited = new Set<object>();
  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as Record<string, unknown>;
    if (node.type === "leaf") {
      leaves++;
      const state = node.state as { type?: string } | undefined;
      if (state?.type === "markdown") markdown++;
      return;
    }
    Object.values(node).forEach(visit);
  }
  // 只统计布局树，不读取文件或实例化视图，也不把插件配置误算为布局。
  for (const key of ["main", "left", "right", "floating"]) visit(workspace[key] as unknown);
  return `${leaves} 个标签页 · ${markdown} 个笔记${markdown >= 30 ? " · 大型布局" : ""}`;
}

export function duplicateWorkspace(workspaces: Record<string, Workspaces>, sourceName: string): string | null {
  if (!workspaces[sourceName] || /^mode:/i.test(sourceName)) return null;
  let name = `${sourceName} 副本`;
  for (let suffix = 2; workspaces[name]; suffix++) name = `${sourceName} 副本 ${suffix}`;
  // 深拷贝确保副本的文件覆盖、图标和布局修改不会联动原工作区。
  workspaces[name] = cloneWorkspace(workspaces[sourceName]);
  return name;
}

export function createWorkspaceBackup(workspaces: Record<string, Workspaces>, label: string): WorkspaceBackup {
  const createdAt = new Date().toISOString();
  return { id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`, createdAt, label,
    workspaces: cloneWorkspace(workspaces) };
}

export function limitedBackups(backups: WorkspaceBackup[], limit: number): WorkspaceBackup[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 5;
  return backups.slice(0, safeLimit);
}
