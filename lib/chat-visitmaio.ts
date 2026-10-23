import type { Nodes, Root } from "mdast";

const visitMaioName = /\bVisit\s?Maio\b(?!\.com)/gi;
const visitMaioUrl = "https://visitmaio.com/";

/** Link source mentions in prose without rewriting code or existing Markdown links. */
export function remarkVisitMaioLinks() {
  return (tree: Root) => {
    function linkMentions(node: Root | Nodes) {
      if (node.type === "link" || node.type === "linkReference") return;
      if (!("children" in node)) return;
      const parent = node as { children: Nodes[] };
      parent.children = parent.children.flatMap((child): Nodes[] => {
        if (child.type !== "text") {
          linkMentions(child);
          return [child];
        }
        const matches = [...child.value.matchAll(visitMaioName)];
        if (!matches.length) return [child];
        const parts: Nodes[] = [];
        let start = 0;
        for (const match of matches) {
          const index = match.index ?? 0;
          if (index > start) parts.push({ type: "text", value: child.value.slice(start, index) });
          parts.push({ type: "link", url: visitMaioUrl, children: [{ type: "text", value: match[0] }] });
          start = index + match[0].length;
        }
        if (start < child.value.length) parts.push({ type: "text", value: child.value.slice(start) });
        return parts;
      });
    }
    linkMentions(tree);
  };
}
