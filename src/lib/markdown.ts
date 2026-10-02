function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(value: string): string {
  const expression =
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*(.+?)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let output = "";
  let lastIndex = 0;

  for (const match of value.matchAll(expression)) {
    const index = match.index;
    output += escapeHtml(value.slice(lastIndex, index));
    if (match[1] !== undefined && match[2] !== undefined) {
      let safeHref: string | null = null;
      try {
        const url = new URL(match[2]);
        if (url.protocol === "https:" || url.protocol === "http:") {
          safeHref = url.href;
        }
      } catch {
        safeHref = null;
      }
      output += safeHref
        ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`
        : escapeHtml(match[1]);
    } else if (match[3] !== undefined) {
      output += `<strong>${escapeHtml(match[3])}</strong>`;
    } else if (match[4] !== undefined) {
      output += `<code>${escapeHtml(match[4])}</code>`;
    } else if (match[5] !== undefined) {
      output += `<em>${escapeHtml(match[5])}</em>`;
    }
    lastIndex = index + match[0].length;
  }

  return output + escapeHtml(value.slice(lastIndex));
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listOpen = false;
  let codeOpen = false;
  let code: string[] = [];

  const closeList = () => {
    if (listOpen) output.push("</ul>");
    listOpen = false;
  };
  const closeParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    }
    paragraph = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      closeParagraph();
      closeList();
      if (codeOpen) {
        output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        codeOpen = false;
      } else {
        codeOpen = true;
      }
      continue;
    }
    if (codeOpen) {
      code.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(heading[1].length + 1, 5);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const item = line.match(/^\s*[-*+]\s+(.+)$/);
    if (item) {
      closeParagraph();
      if (!listOpen) {
        output.push("<ul>");
        listOpen = true;
      }
      output.push(`<li>${inlineMarkdown(item[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  closeParagraph();
  closeList();
  if (codeOpen) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return output.join("\n");
}
