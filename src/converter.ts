import type { Scan2mdSettings } from "./settings";
import { PROVIDER_PRESETS } from "./presets";
import { convertWithClaude } from "./providers/claude";
import type { InputImage } from "./providers/claude";
import { convertWithGemini } from "./providers/gemini";
import { callOpenAICompat } from "./providers/openai-compat";

export type { InputImage };

/** 默认提示词：把书本图片转成干净、结构化的 Markdown。 */
export const DEFAULT_PROMPT =
  "你是专业的 OCR + 排版助手。请把图片中的书本内容转成干净、结构化的 Markdown：" +
  "保留标题层级、段落、列表、表格、加粗/斜体；" +
  "数学公式用 LaTeX：行内 $...$、块级 $$...$$（块级独占一行）；" +
  "行内公式的 $ 定界符必须紧贴内容、中间不能有空格（写 $x$ 不要写 $ x $）；" +
  "不要转义 $ 符号（禁止写 \\$），也不要用 \\(...\\) 或 \\[...\\] 作为定界符；" +
  "不要添加任何解释、总结或评论；只输出 Markdown 本身。";

function buildPrompt(settings: Scan2mdSettings, multi: boolean): string {
  let p = (settings.prompt || "").trim() || DEFAULT_PROMPT;
  if (settings.autoDetectLegends) {
    p +=
      "\n\n另外：插图的图注（如「图 1-1 …」这类标题文字）不要转成文字输出，直接跳过；这些图会作为图片单独保存。";
  }
  if (multi) {
    p +=
      "\n\n注意：本批次是同一来源的多页连续图片，请按顺序合并为连贯的一篇 Markdown，不要逐页重复标题或加多余分隔。";
  }
  return p;
}

/**
 * 按设置里的 provider 分发。Claude / Gemini 走各自专用接口；
 * 其余（OpenAI + 国产厂商 + 自定义）统一走 OpenAI 兼容通道。
 */
/** 统一的视觉调用分发：按设置里的 provider 走对应通道，返回模型原始文本。 */
async function callVision(
  settings: Scan2mdSettings,
  images: InputImage[],
  prompt: string
): Promise<string> {
  if (!settings.apiKey) throw new Error("尚未配置 API key，请在插件设置中填写。");
  const preset = PROVIDER_PRESETS[settings.provider];
  if (preset.kind === "anthropic") {
    return convertWithClaude(settings, images, prompt);
  }
  if (preset.kind === "gemini") {
    return convertWithGemini(settings, images, prompt);
  }
  // openai-compat：OpenAI + 国产厂商 + 自定义端点
  const endpoint = (settings.apiBase || "").trim() || preset.endpoint;
  const model = (settings.model || "").trim() || preset.defaultModel;
  if (!endpoint) {
    throw new Error("请填写 API 端点地址（自定义端点需在设置里手动填写完整地址）。");
  }
  if (!model) {
    throw new Error("请填写模型名。");
  }
  return callOpenAICompat(endpoint, settings.apiKey, model, images, prompt);
}

export async function convertImages(
  settings: Scan2mdSettings,
  images: InputImage[],
  multi: boolean
): Promise<string> {
  if (!images.length) throw new Error("没有可识别的图片");
  const prompt = buildPrompt(settings, multi);
  const md = await callVision(settings, images, prompt);
  return normalizeMathDelimiters(stripCodeFence(md));
}

/** 归一化边界框（相对整图宽高的 0~1 坐标）。 */
export interface FigureBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const FIGURE_DETECT_PROMPT =
  "你是专业的图书版面分析助手。请找出图片中所有的插图、示意图、图表，" +
  "并包含其正下方的图注文字（如「图 1-1 …」）。" +
  "只返回一个 JSON 数组，每个元素形如 {\"x1\":0.1,\"y1\":0.2,\"x2\":0.9,\"y2\":0.6}，" +
  "表示该图（含图注）的归一化边界框（相对整图宽高的 0~1 坐标，坐标尽量贴合图的边缘）。" +
  "如果没有任何插图/图表，返回空数组 []。除 JSON 外不要输出任何文字。";

/** 容错解析模型返回的 JSON 边界框数组。 */
function parseFigureBoxes(text: string): FigureBox[] {
  const t = text.trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(t.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const boxes: FigureBox[] = [];
  for (const o of arr as any[]) {
    const x1 = typeof o?.x1 === "number" ? o.x1 : NaN;
    const y1 = typeof o?.y1 === "number" ? o.y1 : NaN;
    const x2 = typeof o?.x2 === "number" ? o.x2 : NaN;
    const y2 = typeof o?.y2 === "number" ? o.y2 : NaN;
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      continue;
    }
    const bx1 = Math.max(0, Math.min(1, Math.min(x1, x2)));
    const by1 = Math.max(0, Math.min(1, Math.min(y1, y2)));
    const bx2 = Math.max(0, Math.min(1, Math.max(x1, x2)));
    const by2 = Math.max(0, Math.min(1, Math.max(y1, y2)));
    if (bx2 - bx1 < 0.02 || by2 - by1 < 0.02) continue;
    boxes.push({ x1: bx1, y1: by1, x2: bx2, y2: by2 });
  }
  return boxes;
}

/** 让视觉模型定位图例区域（图 + 图注），返回归一化边界框列表。 */
export async function detectFigureBoxes(
  settings: Scan2mdSettings,
  image: InputImage
): Promise<FigureBox[]> {
  const text = await callVision(settings, [image], FIGURE_DETECT_PROMPT);
  return parseFigureBoxes(text);
}

/**
 * 若整段文本被一对 ``` 代码块整体包裹（模型偶尔会这样做），去掉外层，
 * 返回纯 Markdown，避免写入后变成代码块而非可渲染内容。
 */
function stripCodeFence(md: string): string {
  const t = md.trim();
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(t);
  return m ? m[1] : md;
}

/**
 * 规范化数学公式定界符，确保 Obsidian 能正常渲染。
 * - 部分模型（如智谱 GLM 系列）会把公式定界符 $ 转义成 \$，Obsidian 当成字面美元而不渲染 → 还原。
 * - 兼容模型偶尔输出的 LaTeX 定界符 \(...\) / \[...\]，转成 Obsidian 支持的 $...$ / $$...$$。
 */
function normalizeMathDelimiters(md: string): string {
  let s = md;
  // LaTeX 块级 \[ ... \] → $$ ... $$（先于行内，避免被 \(...\) 规则误伤）
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body: string) => "$$" + body + "$$");
  // LaTeX 行内 \( ... \) → $ ... $
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body: string) => "$" + body + "$");
  // 还原被转义的美元符号：\$ → $（已成对的纯 $ 不含反斜杠，不受影响）
  s = s.replace(/\\(\$)/g, "$1");
  // 行内公式定界符内侧有空格时 Obsidian 不渲染（如「$ x $」）→ 去掉 $ 紧内侧的首尾空格；
  // 块级 $$...$$ 因两 $ 紧邻、(?!\$) 与 [^$\n] 不跨行而不会被误伤
  s = s.replace(/(?<!\$)\$([^$\n]*)\$(?!\$)/g, (_m, body: string) => "$" + body.trim() + "$");
  return s;
}
