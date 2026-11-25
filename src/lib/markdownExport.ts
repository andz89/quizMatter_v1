import type { Presentation } from "./schema";
import { presentationFileName, presentationOutline, saveFile, type OutlineBlock } from "./presentationOutline";

/**
 * "Download → Text": the presentation's outline (`presentationOutline.ts`) of the chosen slides (`positions`,
 * missing = all) as Markdown, saved as a .txt file. The questions' answers are in "## Answer key" at the end.
 */
export function presentationToMarkdown(presentation: Presentation, positions?: readonly number[]): string {
  const outline = presentationOutline(presentation, positions);
  const blocks: string[] = [`# ${outline.title}`];
  if (outline.description) blocks.push(outline.description);
  if (outline.details.length > 0) blocks.push(outline.details.map(({ label, value }) => `- **${label}:** ${value}`).join("\n"));
  if (outline.references.length > 0) blocks.push(`**References:**\n\n${outline.references.map((reference) => `- ${reference}`).join("\n")}`);

  for (const slide of outline.slides) {
    blocks.push("---", ...slide.blocks.map(blockToMarkdown));
    if (slide.answer.length > 0) blocks.push(labeled(`**${slide.answerLabel}:**`, slide.answer));
  }

  if (outline.answerKey.length > 0) {
    // One line each; an answer with more than one part gets a blank line around it, so the next number starts its own.
    const entries = outline.answerKey.map(({ number, answer }) => labeled(`${number}.`, answer));
    const isLong = (entry: string) => entry.includes("\n");
    const key = entries
      .map((entry, i) => (i === 0 ? "" : isLong(entry) || isLong(entries[i - 1]) ? "\n\n" : "\n") + entry)
      .join("");
    blocks.push("---", "## Answer key", key);
  }
  return `${blocks.join("\n\n")}\n`;
}

/** A label with its answer: a first line of text sits on the label's line, anything after it goes under. */
function labeled(label: string, [first, ...rest]: OutlineBlock[]): string {
  const inline = first.kind === "text" && !first.text.includes("\n");
  return [inline ? `${label} ${first.text}` : label, ...(inline ? rest : [first, ...rest]).map(blockToMarkdown)].join("\n\n");
}

function blockToMarkdown(block: OutlineBlock): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "options":
      // An option's pictures go under its letter, indented so they stay part of that line.
      return block.options
        .map(({ letter, text, blocks }) =>
          [`- ${letter}.${text ? ` ${text}` : ""}`, ...blocks.map((part) => blockToMarkdown(part).replace(/^/gm, "  "))].join("\n"),
        )
        .join("\n");
    case "link":
      return `${block.label}: ${block.url}`;
    case "photo":
      return `![${block.crop ? "Photo (cropped on the slide)" : "Photo"}](${block.url})`;
    case "table": {
      const line = (cells: string[]) => `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
      const [header, ...body] = block.rows;
      return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n");
    }
    case "list":
      return block.items.map(({ text, depth }, index) => `${"  ".repeat(depth)}${block.ordered ? `${index + 1}.` : "-"} ${text}`).join("\n");
  }
}

/** Saves the chosen slides (missing = all) as a Markdown .txt file on the teacher's computer (browser only). */
export function downloadPresentationText(presentation: Presentation, positions?: readonly number[]): void {
  const blob = new Blob([presentationToMarkdown(presentation, positions)], { type: "text/plain;charset=utf-8" });
  saveFile(blob, presentationFileName(presentation.title, ".txt"));
}
