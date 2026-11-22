const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/personalWorkspaces.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
new Function("module", "exports", output)(compiled, compiled.exports);
module.exports = compiled.exports;
