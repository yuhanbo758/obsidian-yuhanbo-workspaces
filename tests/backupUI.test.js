const assert = require("assert"), fs = require("fs"), path = require("path"), ts = require("typescript");
let confirmation;
const stubs = { obsidian: { FuzzySuggestModal: class {}, Notice: class {} },
  "./confirm": { createConfirmationDialog: (_, config) => { confirmation = config; } },
  "./personalWorkspaces": require("./loadPersonalModule") };
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/personalWorkspaceUI.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleResult = { exports: {} };
new Function("require", "module", "exports", output)(id => stubs[id], moduleResult, moduleResult.exports);
const { WorkspaceBackupModal, buildFavoriteSetting, buildBackupSetting } = moduleResult.exports;
(async () => {
  const modal = Object.create(WorkspaceBackupModal.prototype);
  let restored = 0, saved = 0;
  const backup = { createdAt: new Date().toISOString(), label: "夹具", workspaces: {} };
  modal.plugin = { restoreWorkspaceBackup: async value => { assert.strictEqual(value, backup); restored++; } };
  modal.onChooseItem(backup);
  assert.equal(restored, 0, "selecting a backup must not restore until confirmation");
  assert.equal(confirmation.cta, "恢复");
  await confirmation.onAccept(); assert.equal(restored, 1);
  const plugin = { settings: { favoriteWorkspaces: ["A"], workspaceBackups: [] }, saveSettings: async () => { saved++; },
    backupWorkspaces: async () => { plugin.settings.workspaceBackups.push(backup); } };
  let changed;
  buildFavoriteSetting({ addToggle(fn) { fn({ setValue() { return this; }, onChange(fn) { changed = fn; } }); } }, plugin, "B");
  await changed(true); assert.deepStrictEqual(plugin.settings.favoriteWorkspaces, ["A", "B"]);
  await changed(false); assert.deepStrictEqual(plugin.settings.favoriteWorkspaces, ["A"]); assert.equal(saved, 2);
  const buttons = [], descriptions = [];
  const setting = { setDesc(text) { descriptions.push(text); return this; }, addButton(fn) {
    const button = { setButtonText() { return this; }, onClick(fn) { buttons.push(fn); return this; } }; fn(button); return this;
  } };
  buildBackupSetting(setting, plugin);
  await buttons[0](); assert.equal(plugin.settings.workspaceBackups.length, 1);
  assert(descriptions.at(-1).includes("1 份"));
  console.log("Backup UI: explicit restore confirmation, favorite persistence and backup button passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
