const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

class TFile {
  constructor(path) {
    this.path = path;
    this.extension = path.split(".").pop();
  }
}

class TFolder {
  constructor(path, children) {
    this.path = path;
    this.children = children;
  }
}

const source = fs.readFileSync(path.join(__dirname, "../src/suggesters/fileSuggest.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const obsidian = {
  AbstractInputSuggest: class {
    constructor(app) {
      this.app = app;
    }
  },
  TFile,
  TFolder,
  normalizePath: value => value.replace(/^\/+|\/+$/g, ""),
};
const compiled = { exports: {} };
new Function("require", "module", "exports", outputText)(() => obsidian, compiled, compiled.exports);

const exact = new TFile("Projects/Deep/Meeting.md");
const similar = new TFile("Projects/Meeting notes.md");
const unsupported = new TFile("Projects/Meeting.png");
const projects = new TFolder("Projects", [similar, unsupported, new TFolder("Projects/Deep", [exact])]);
const other = new TFolder("Other", [new TFile("Other/Meeting.md")]);
const crowded = new TFolder("Crowded", Array.from({ length: 100 }, (_, i) => new TFile(`Crowded/Note-${i}.md`)));
crowded.children.push(new TFolder("Crowded/Unreached", []));
Object.defineProperty(crowded.children.at(-1), "children", {
  get() { throw new Error("should stop searching after the results limit"); },
});
let rootReads = 0;
const vault = {
  getFileByPath: path => path === exact.path ? exact : null,
  getFolderByPath: path => ({ Projects: projects, Crowded: crowded })[path] ?? null,
  getRoot() {
    rootReads++;
    return new TFolder("", [projects, other]);
  },
};
const suggest = new compiled.exports.FileSuggest({ vault }, {});
assert.deepEqual(suggest.getSuggestions("   "), []);
assert.deepEqual(suggest.getSuggestions("Projects\\Deep\\Meeting.md"), [exact]);
assert.deepEqual(suggest.getSuggestions("Projects/MEET"), [similar, exact]);
assert.deepEqual(suggest.getSuggestions("Projects/"), [similar, exact]);
assert.equal(suggest.getSuggestions("Crowded/Note").length, 30);
assert.equal(rootReads, 0, "empty, exact and scoped queries do not read the vault root");
assert.deepEqual(suggest.getSuggestions("meeting"), [other.children[0], similar, exact]);
assert.deepEqual(suggest.getSuggestions("missing"), []);
console.log("File suggestions passed");
