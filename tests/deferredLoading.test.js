const assert = require("assert");
const fs = require("fs");
const ts = require("typescript");
const path = require("path");
const noop = () => {};
const stubs = {
  "./personalWorkspaces": require("./loadPersonalModule"),
  "./personalWorkspaceUI": {},
  obsidian: { Plugin: class {}, setIcon: noop, Notice: class {}, debounce: fn => fn },
  "./settings": {}, "./workspaceModal": {}, "./modeModal": {}, "./newWorkspaceModal": {},
  "./utils": { default: class {} }, "./workspaceCycle": {},
  "monkey-around": { around(target, wrappers) {
    const old = {};
    for (const key of Object.keys(wrappers)) {
      old[key] = target[key];
      target[key] = wrappers[key](target[key] || noop);
    }
    return () => Object.assign(target, old);
  } },
};
const source = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", output)(id => {
  if (!(id in stubs)) throw new Error(id);
  return stubs[id];
}, compiled, compiled.exports);
const Plugin = compiled.exports.default;
const settle = () => new Promise(resolve => setImmediate(resolve));
function make(count = 42) {
  const p = new Plugin();
  const layouts = [], restored = [], overrides = [], saved = [];
  let forced = 0;
  const leaves = Array.from({ length: count }, () => ({ isDeferred: true, loadIfDeferred() { forced++; } }));
  p.settings = { ...JSON.parse(JSON.stringify(require("./loadPersonalModule").PERSONAL_DEFAULTS)), trackOpenFiles: true, workspaceSettings: false };
  p.app = { isMobile: false, workspace: {
    changeLayout: async layout => { layouts.push(layout.name); },
    iterateAllLeaves: cb => leaves.forEach(cb), trigger: noop,
  } };
  p.workspacePlugin = { app: p.app, workspaces: { A: { name: "A" }, B: { name: "B" } }, saveData: () => saved.push(true) };
  p.utils = {
    restoreOpenFiles: async name => { restored.push(name); },
    applyFileOverrides: async name => { overrides.push(name); },
    isMode: name => name.startsWith("Mode:"), loadMode: noop,
  };
  p.isNativePluginEnabled = true;
  p.register = noop;
  p.installWorkspaceHooks();
  return { p, layouts, restored, overrides, saved, leaves, forced: () => forced };
}
(async () => {
  for (const count of [8, 20, 36, 42]) {
    const h = make(count);
    h.p.workspacePlugin.loadWorkspace("A");
    await settle();
    assert.deepStrictEqual(h.layouts, ["A"]);
    assert.deepStrictEqual(h.restored, ["A"]);
    assert.deepStrictEqual(h.overrides, ["A"]);
    assert.equal(h.saved.length, 1);
    assert.equal(h.forced(), 0, `${count} background leaves must remain deferred`);
  }
  const h = make();
  let release;
  h.p.utils.restoreOpenFiles = name => name === "A" ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  h.p.workspacePlugin.loadWorkspace("A");
  h.p.workspacePlugin.loadWorkspace("B");
  assert.equal(h.p.workspaceLoading, true);
  await settle();
  release();
  await settle();
  assert.deepStrictEqual(h.layouts, ["B"]);
  assert.deepStrictEqual(h.overrides, ["B"]);
  assert.equal(h.saved.length, 1);
  assert.equal(h.p.workspaceLoading, false);

  const u = make();
  u.p.utils.restoreOpenFiles = () => new Promise(resolve => { release = resolve; });
  u.p.workspacePlugin.loadWorkspace("A");
  global.document = { body: { dataset: {} } };
  u.p.onunload();
  release();
  await settle();
  assert.deepStrictEqual(u.layouts, []);
  assert.equal(u.saved.length, 0);

  const m = make();
  m.p.settings.workspaceSettings = true;
  m.p.utils.restoreOpenFiles = () => new Promise(resolve => { release = resolve; });
  m.p.workspacePlugin.loadWorkspace("A");
  m.p.workspacePlugin.loadWorkspace("Mode: Focus");
  release();
  await settle();
  assert.deepStrictEqual(m.layouts, []);
  const modeLoading = make();
  modeLoading.p.settings.workspaceSettings = true;
  modeLoading.p.utils.loadMode = () => new Promise(resolve => { release = resolve; });
  modeLoading.p.workspacePlugin.loadWorkspace("Mode: Focus");
  await settle();
  assert.equal(modeLoading.p.workspaceLoading, true, "mode layout must also remain protected until completion");
  release();
  await settle();
  assert.equal(modeLoading.p.workspaceLoading, false);

  const c = make();
  const commands = [];
  c.p.addCommand = command => commands.push(command);
  c.p.registerCommands();
  c.p.registerWorkspaceHotkeys();
  assert(commands.every(command => command.id.startsWith("obsidian-yuhanbo-")));
  assert(new Set(commands.map(command => command.id)).size === commands.length);
  const backupFixture = make();
  backupFixture.p.saveData = async () => {};
  await backupFixture.p.backupWorkspaces("夹具备份");
  const backup = backupFixture.p.settings.workspaceBackups[0];
  backupFixture.p.workspacePlugin.workspaces.A.name = "changed";
  backupFixture.p.workspacePlugin.workspaces.New = { name: "New" };
  backupFixture.p.registerWorkspaceHotkeys = noop;
  await backupFixture.p.restoreWorkspaceBackup(backup);
  assert.equal(backupFixture.p.workspacePlugin.workspaces.A.name, "A");
  assert.equal(backupFixture.p.workspacePlugin.workspaces.New.name, "New");
  assert.equal(backupFixture.p.settings.workspaceBackups[0].label, "恢复前自动备份");
  assert.deepStrictEqual(backupFixture.layouts, [], "restoring saved configuration must not switch the screen");
  backupFixture.p.saveData = async () => { throw new Error("fixture write failure"); };
  backupFixture.p.workspacePlugin.workspaces.A.name = "do not overwrite";
  await assert.rejects(() => backupFixture.p.restoreWorkspaceBackup(backup));
  assert.equal(backupFixture.p.workspacePlugin.workspaces.A.name, "do not overwrite");
  console.log("Deferred loading: 4 layout sizes, rapid switching, unload, mode cancellation and command naming passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
