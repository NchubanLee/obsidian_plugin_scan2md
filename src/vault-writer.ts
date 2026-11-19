import { App, MarkdownView, normalizePath, TFile } from "obsidian";
import type { Scan2mdSettings } from "./settings";

/** 去掉文件名里的非法字符。 */
function sanitize(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Scan"
  );
}

/** 确保目录存在（已存在或创建失败则忽略）。 */
async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder || folder === "/" || folder === ".") return;
  if (app.vault.getAbstractFileByPath(folder)) return;
  try {
    await app.vault.createFolder(folder);
  } catch {
    // 可能已被并发创建，忽略
  }
}

/** 若路径已存在，追加 " (1)"、" (2)" 直至不冲突。 */
function uniquePath(app: App, path: string): string {
  if (!app.vault.getAbstractFileByPath(path)) return path;
  const dot = path.lastIndexOf(".");
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  let i = 1;
  while (app.vault.getAbstractFileByPath(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

export interface SaveInput {
  markdown: string;
  images: ArrayBuffer[];
  imageExt: string;
  title?: string;
  createdAt: string; // ISO 时间
  /** raw 直存模式：忽略 attachImages 设置，强制把图片存进笔记。 */
  forceAttach?: boolean;
}

/**
 * 把识别出的 Markdown 插入当前活动笔记的光标处（纯文本，不附图、不加 frontmatter）。
 * 没有打开的 Markdown 笔记时抛错，由调用方提示用户先打开笔记。返回笔记路径。
 */
export async function insertIntoActiveNote(
  app: App,
  markdown: string
): Promise<string> {
  const { view, editor, cursor } = getActiveEditor(app);
  // 光标之前若已有文字，前面补空行；否则只补一个换行 —— 保证表格/标题等块级元素前后有空行，正确渲染
  const before = editor.getRange({ line: cursor.line, ch: 0 }, cursor);
  const prefix = before.trim().length > 0 ? "\n\n" : "\n";
  const insert = prefix + markdown + "\n";
  insertAtCursor(editor, cursor, insert);
  return view.file!.path;
}

/** 获取当前活动 Markdown 编辑器；没有打开的 Markdown 笔记时抛错。 */
function getActiveEditor(app: App) {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || !view.file) {
    throw new Error(
      "当前没有打开的 Markdown 笔记。请先在电脑端打开一个笔记、把光标放在要插入的位置，再拍照上传。"
    );
  }
  return { view, editor: view.editor, cursor: view.editor.getCursor() };
}

/** 在光标处插入文本，并把光标移到插入内容末尾。 */
function insertAtCursor(
  editor: import("obsidian").Editor,
  cursor: { line: number; ch: number },
  insert: string
): void {
  editor.replaceRange(insert, cursor);
  const nl = (insert.match(/\n/g) || []).length;
  const afterLastNl = insert.slice(insert.lastIndexOf("\n") + 1);
  editor.setCursor({
    line: cursor.line + nl,
    ch: (nl === 0 ? cursor.ch : 0) + afterLastNl.length,
  });
}

/** 把图片二进制存进附件文件夹（时间戳命名、防重名），返回可用于 ![[...]] 的文件名列表。 */
export async function saveAttachments(
  app: App,
  settings: Scan2mdSettings,
  images: ArrayBuffer[],
  imageExt: string,
  baseName: string
): Promise<string[]> {
  const attFolder = normalizePath(settings.attachmentFolder || settings.outputFolder || "/");
  await ensureFolder(app, attFolder);
  const names: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const imgName = `${baseName} - ${i + 1}.${imageExt}`;
    const imgPath = uniquePath(app, normalizePath(`${attFolder}/${imgName}`));
    await app.vault.createBinary(imgPath, images[i]);
    // uniquePath 可能加 " (n)" 后缀，链接要用实际落盘的文件名
    names.push(imgPath.slice(imgPath.lastIndexOf("/") + 1));
  }
  return names;
}

/** 时间戳附件名前缀，如 scan2md-20260629-143052。 */
function timestampBase(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `scan2md-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * 把手机端框选的「图例」区域（示意图/图表）存为附件，并追加到 Markdown 末尾。
 * 不改变识别出的正文，图例链接始终排在输出最后。
 */
export async function appendLegendImages(
  app: App,
  settings: Scan2mdSettings,
  markdown: string,
  legends: ArrayBuffer[]
): Promise<string> {
  if (!legends.length) return markdown;
  const names = await saveAttachments(
    app,
    settings,
    legends,
    "jpg",
    `${timestampBase()}-legend`
  );
  const links = names.map((n) => `![[${n}]]`).join("\n");
  const body = markdown.trimEnd();
  return (body ? body + "\n\n" : "") + links + "\n";
}

/**
 * 不识别、直接把拍摄的图片存为附件，并在当前笔记光标处插入 ![[...]] 嵌入链接。
 * 返回笔记路径。
 */
export async function insertImagesIntoActiveNote(
  app: App,
  settings: Scan2mdSettings,
  images: ArrayBuffer[],
  imageExt: string
): Promise<string> {
  const { view, editor, cursor } = getActiveEditor(app);
  const names = await saveAttachments(app, settings, images, imageExt, timestampBase());
  const links = names.map((n) => `![[${n}]]`).join("\n");
  const before = editor.getRange({ line: cursor.line, ch: 0 }, cursor);
  const prefix = before.trim().length > 0 ? "\n\n" : "\n";
  insertAtCursor(editor, cursor, prefix + links + "\n");
  return view.file!.path;
}

/** 把识别出的 Markdown 写成笔记，并把图片作为附件引用到笔记顶部。返回笔记路径。 */
export async function saveScan(
  app: App,
  settings: Scan2mdSettings,
  input: SaveInput
): Promise<string> {
  const folder = normalizePath(settings.outputFolder || "/");
  await ensureFolder(app, folder);

  const m = (window as any).moment;
  const ts = m
    ? m(input.createdAt).format("YYYY-MM-DD HHmm")
    : input.createdAt.slice(0, 16).replace("T", " ");
  const base =
    input.title && input.title.trim()
      ? sanitize(input.title)
      : sanitize((settings.titleTemplate || "Scan {{DATE}}").replace(/\{\{DATE\}\}/g, ts));

  let body = input.markdown;
  if ((settings.attachImages || input.forceAttach) && input.images.length) {
    const names = await saveAttachments(app, settings, input.images, input.imageExt, base);
    const links = names.map((n) => `![[${n}]]`).join("\n");
    body = input.markdown.trim()
      ? `${links}\n\n${input.markdown}`
      : links;
  }

  const frontmatter = `---\ncreated: ${input.createdAt}\nsource: scan2md\n---\n\n`;
  const notePath = uniquePath(app, normalizePath(`${folder}/${base}.md`));
  await app.vault.create(notePath, frontmatter + body);

  if (settings.openAfterSave) {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (file instanceof TFile) await app.workspace.getLeaf().openFile(file);
  }
  return notePath;
}
