import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Citation } from "./chat-citations";
import type { Locale } from "./locale";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  ordered?: boolean;
};

type PdfAnswer = {
  question: string;
  answer: string;
  citations?: Citation[];
  example?: boolean;
  uncited?: boolean;
  locale: Locale;
  labels: { question: string; answer: string; sources: string; example: string; noSource: string };
};

function plainText(node: MarkdownNode): string {
  if (node.type === "break") return "\n";
  if (node.type === "image") return node.value ?? "";
  const content = node.value ?? node.children?.map(plainText).join("") ?? "";
  return node.type === "link" && node.url && node.url !== content
    ? `${content} (${node.url})`
    : content;
}

function fileName(question: string): string {
  const slug = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55);
  return `maio-cv-${slug || "answer"}.pdf`;
}

export async function saveChatAnswerPdf({ question, answer, citations, example, uncited, locale, labels }: PdfAnswer): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setProperties({ title: question, author: "maio.cv", subject: "MaioCV chat answer", creator: "maio.cv" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = width - margin * 2;
  const bottom = height - 24;
  let y = 35;

  const newPage = () => { pdf.addPage(); y = 30; };
  const ensureSpace = (needed: number) => { if (y + needed > bottom) newPage(); };
  const write = (content: string, options: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number; href?: string } = {}) => {
    const { size = 10, bold = false, color = [28, 28, 30], indent = 0, gap = 3, href } = options;
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lineHeight = size * 0.47;
    const lines = pdf.splitTextToSize(content || " ", contentWidth - indent) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin + indent, y);
      if (href) pdf.link(margin + indent, y - lineHeight, contentWidth - indent, lineHeight, { url: href });
      y += lineHeight;
    }
    y += gap;
  };

  const muted: [number, number, number] = [110, 110, 115];
  const blue: [number, number, number] = [39, 68, 170];
  write(labels.question.toUpperCase(), { size: 8, bold: true, color: muted, gap: 4 });
  write(question, { size: 18, bold: true, gap: 10 });
  write(labels.answer.toUpperCase(), { size: 8, bold: true, color: muted, gap: 5 });

  const nodes = unified().use(remarkParse).parse(answer).children as MarkdownNode[];
  const render = (node: MarkdownNode, indent = 0, number?: number) => {
    const content = plainText(node).trim();
    switch (node.type) {
      case "heading":
        write(content, { size: 13, bold: true, indent, gap: 4 });
        break;
      case "paragraph":
        write(content, { indent, gap: 4 });
        break;
      case "list":
        node.children?.forEach((item, index) => render(item, indent + 5, node.ordered ? index + 1 : undefined));
        y += 1;
        break;
      case "listItem": {
        const prefix = number === undefined ? "• " : `${number}. `;
        const children = node.children ?? [];
        if (children[0]) write(prefix + plainText(children[0]).trim(), { indent, gap: 2 });
        children.slice(1).forEach(child => render(child, indent + 5));
        break;
      }
      case "blockquote":
        node.children?.forEach(child => render(child, indent + 5));
        break;
      case "code":
        write(node.value ?? "", { size: 9, indent: indent + 4, color: muted, gap: 4 });
        break;
      case "table":
        node.children?.forEach(row => write(row.children?.map(plainText).join("  |  ") ?? "", { size: 9, indent, gap: 2 }));
        y += 3;
        break;
      case "thematicBreak":
        ensureSpace(6);
        pdf.setDrawColor(229, 229, 231);
        pdf.line(margin + indent, y, width - margin, y);
        y += 6;
        break;
      default:
        if (content) write(content, { indent });
    }
  };
  nodes.forEach(node => render(node));

  if (example) write(labels.example, { size: 8, color: muted });
  if (uncited) write(labels.noSource, { size: 8, color: muted });
  if (citations?.length) {
    y += 3;
    write(labels.sources.toUpperCase(), { size: 8, bold: true, color: muted, gap: 4 });
    citations.forEach(({ name, href, kind }) => {
      write([name, kind].filter(Boolean).join(" · "), { size: 9, bold: true, gap: href ? 1 : 3 });
      if (href) write(href, { size: 8, color: blue, gap: 4, href });
    });
  }

  const pageCount = pdf.getNumberOfPages();
  const date = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium" }).format(new Date());
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    pdf.setFillColor(39, 68, 170);
    pdf.rect(0, 0, width, 4, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(28, 28, 30);
    pdf.text("maio.cv", margin, 19);
    pdf.link(margin, 10, 28, 12, { url: "https://www.maio.cv" });
    pdf.setDrawColor(229, 229, 231);
    pdf.line(margin, height - 19, width - margin, height - 19);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...muted);
    pdf.text(`maio.cv  ·  ${date}`, margin, height - 13);
    pdf.text(`${page} / ${pageCount}`, width - margin, height - 13, { align: "right" });
  }
  pdf.save(fileName(question));
}
