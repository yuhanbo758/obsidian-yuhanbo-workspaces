import { AbstractInputSuggest, App, normalizePath, TFile, TFolder } from "obsidian";

const MAX_SUGGESTIONS = 30;

export class FileSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, private inputEl: HTMLInputElement) {
    super(app, inputEl);
  }

  getSuggestions(inputStr: string): TFile[] {
    const query = inputStr.trim().replace(/\\/g, "/");
    if (!query) return [];

    const { vault } = this.app;
    const path = normalizePath(query);
    const exact = vault.getFileByPath(path);
    if (exact?.extension === "md") return [exact];

    // 已指定文件夹时只搜索该目录；其他查询按需匹配，达到上限就停止。
    const slash = query.lastIndexOf("/");
    const folder = slash > 0 ? vault.getFolderByPath(normalizePath(query.slice(0, slash))) : null;
    const needle = (folder ? query.slice(slash + 1) : query.replace(/^\/+/, "")).toLowerCase();
    const pending = [folder ?? vault.getRoot()];
    const files: TFile[] = [];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const entry of current.children) {
        if (entry instanceof TFolder) {
          pending.push(entry);
        } else if (entry instanceof TFile && entry.extension === "md") {
          const relativePath = folder ? entry.path.slice(folder.path.length + 1) : entry.path;
          if (relativePath.toLowerCase().includes(needle)) {
            files.push(entry);
            if (files.length === MAX_SUGGESTIONS) return files;
          }
        }
      }
    }

    return files;
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.inputEl.value = file.path;
    this.inputEl.trigger("input");
    this.close();
  }
}
