const assert = require("assert");
const { PERSONAL_DEFAULTS, cloneWorkspace, orderedWorkspaceNames, rememberWorkspace,
  renamePersonalWorkspace, summarizeLayout, duplicateWorkspace, createWorkspaceBackup, limitedBackups } = require("./loadPersonalModule");
const settings = cloneWorkspace(PERSONAL_DEFAULTS);
settings.favoriteWorkspaces = ["收藏"];
settings.recentWorkspaces = ["最近", "名称2"];
assert.deepStrictEqual(orderedWorkspaceNames(["名称10", "收藏", "名称2", "最近", "Mode: hidden"], settings), ["收藏", "最近", "名称2", "名称10"]);
settings.workspaceSort = "name";
assert.deepStrictEqual(orderedWorkspaceNames(["名称10", "收藏", "名称2"], settings), ["收藏", "名称2", "名称10"]);
rememberWorkspace(settings, "最近"); rememberWorkspace(settings, "最近");
assert.equal(settings.recentWorkspaces.filter(x => x === "最近").length, 1);
rememberWorkspace(settings, "Mode: hidden");
assert(!settings.recentWorkspaces.includes("Mode: hidden"));
renamePersonalWorkspace(settings, "收藏", "收藏新名");
assert.deepStrictEqual(settings.favoriteWorkspaces, ["收藏新名"]);
for (let i = 0; i < 30; i++) rememberWorkspace(settings, String(i));
assert.equal(settings.recentWorkspaces.length, 20);

const layout = { main: { type: "tabs", children: [{ type: "leaf", state: { type: "markdown", state: { file: "fixture.md" } } }] },
  floating: { children: [{ type: "leaf", state: { type: "markdown" } }] },
  left: { type: "leaf", state: { type: "file-explorer" } },
  "workspaces-plus:settings-v1": { fileOverrides: { one: "fixture.md" }, fake: { type: "leaf" } } };
assert.equal(summarizeLayout(layout), "3 个标签页 · 2 个笔记");
const workspaces = { 原版: layout };
const firstCopy = duplicateWorkspace(workspaces, "原版");
assert.equal(firstCopy, "原版 副本");
assert.equal(duplicateWorkspace(workspaces, "原版"), "原版 副本 2");
workspaces[firstCopy]["workspaces-plus:settings-v1"].fileOverrides.one = "changed.md";
assert.equal(layout["workspaces-plus:settings-v1"].fileOverrides.one, "fixture.md");
assert.equal(duplicateWorkspace(workspaces, "不存在"), null);
assert.equal(duplicateWorkspace({ "Mode: Mode": layout }, "Mode: Mode"), null);
const backup = createWorkspaceBackup(workspaces, "手动备份");
workspaces.原版.main.children[0].state.state.file = "other.md";
assert.equal(backup.workspaces.原版.main.children[0].state.state.file, "fixture.md");
const backups = Array.from({ length: 25 }, (_, i) => ({ ...backup, id: String(i) }));
assert.equal(limitedBackups(backups, 5).length, 5);
assert.equal(limitedBackups(backups, 100).length, 20);
assert.equal(limitedBackups(backups, NaN).length, 5);
assert.equal(limitedBackups(backups, 0).length, 1);
console.log("Personal workspaces: favorites/recent ordering, rename, limits, floating views, independent copies and backups passed.");
