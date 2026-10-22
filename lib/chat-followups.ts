import type { Nodes, Root } from "mdast";

function plainText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "break") return " ";
  if ("children" in node) return node.children.map(plainText).join("");
  return "";
}

function isFollowUpIntro(value: string): boolean {
  const intro = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  return /^(?:se (?:quiser(?:es)?|desejar(?:es)?|preferir(?:es)?),? (?:tambem )?posso(?: tambem)?|posso tambem|if (?:you(?:'d| would) like|you want),? i can(?: also)?|i can also|si (?:vous (?:le souhaitez|voulez)|tu (?:le souhaites|veux)),? je peux(?: aussi| egalement)?|je peux (?:aussi|egalement)|perguntas de seguimento|sugestoes de perguntas|follow[- ]up questions|suggested follow[- ]ups|questions de suivi)\s*[:.!?]?$/.test(intro);
}

function followUpLabel(node: Nodes): string {
  const text = plainText(node).replace(/\s+/g, " ").trim()
    .replace(/[,;]?\s+(?:ou|or)(?: encore)?[.!;]?$/i, "")
    .replace(/[.;]+$/, "").trim();
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : "";
}

/** Mark explicit suggestion lists without changing the stored answer or ordinary lists. */
export function remarkChatFollowUps() {
  return (tree: Root) => {
    tree.children.forEach((node, index) => {
      const intro = tree.children[index - 1];
      if (node.type !== "list" || !intro ||
        (intro.type !== "paragraph" && intro.type !== "heading") ||
        !isFollowUpIntro(plainText(intro))) return;
      // Multi-paragraph, nested and task lists are answer content, not quick replies.
      if (!node.children.length || node.children.some(item =>
        item.checked != null || item.children.length !== 1 || item.children[0].type !== "paragraph")) return;
      const labels = node.children.map(followUpLabel);
      if (labels.some(label => !label || label.length > 500)) return;
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: ["chat-followups"] } };
      node.children.forEach((item, itemIndex) => {
        item.data = { ...item.data, hProperties: { ...item.data?.hProperties, "data-follow-up": labels[itemIndex] } };
      });
    });
  };
}
