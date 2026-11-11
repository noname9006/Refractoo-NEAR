import { memo, useMemo } from 'react';

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line) {
  return /\|/.test(line) && splitTableRow(line).length > 1;
}

function isUnorderedList(line) {
  return /^\s*[-*]\s+/.test(line);
}

function isOrderedList(line) {
  return /^\s*\d+\.\s+/.test(line);
}

function isHeading(line) {
  return /^\s{0,3}#{1,3}\s+/.test(line);
}

function isLooseHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (/[|`]/.test(trimmed)) return false;
  if (/^[*-]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (/:$/.test(trimmed)) return true;
  return /^[A-Z0-9][A-Za-z0-9'()\-/%&+]*(?: [A-Z0-9][A-Za-z0-9'()\-/%&+]*)*$/.test(trimmed);
}

function parseInline(text) {
  const source = String(text || '');
  if (!source) return [];

  const parts = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('**', i)) {
      const end = source.indexOf('**', i + 2);
      if (end !== -1) {
        parts.push({ type: 'bold', text: source.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (source[i] === '`') {
      const end = source.indexOf('`', i + 1);
      if (end !== -1) {
        parts.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (source[i] === '*') {
      const end = source.indexOf('*', i + 1);
      if (end !== -1) {
        parts.push({ type: 'italic', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    let next = source.length;
    const nextBold = source.indexOf('**', i);
    const nextItalic = source.indexOf('*', i);
    const nextCode = source.indexOf('`', i);
    if (nextBold !== -1) next = Math.min(next, nextBold);
    if (nextItalic !== -1) next = Math.min(next, nextItalic);
    if (nextCode !== -1) next = Math.min(next, nextCode);
    if (next === i) next = i + 1;
    parts.push({ type: 'text', text: source.slice(i, next) });
    i = next;
  }

  return parts.length ? parts : [{ type: 'text', text: source }];
}

export function renderMarkdown(text, { live = false } = {}) {
  if (!text) return [];

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    if (!live && /^```/.test(trimmed)) {
      const lang = trimmed.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length && /^```/.test(lines[i].trim())) i++;
      blocks.push({ type: 'code', lang, text: code.join('\n'), key: `code-${blocks.length}` });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: `h${heading[1].length}`,
        content: parseInline(heading[2].trim()),
        key: `h-${blocks.length}`,
      });
      i++;
      continue;
    }

    if (isLooseHeading(line)) {
      blocks.push({
        type: 'h3',
        content: parseInline(trimmed.replace(/:$/, '')),
        key: `h-${blocks.length}`,
      });
      i++;
      continue;
    }

    if (!live && i + 1 < lines.length && isTableRow(line) && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && !isTableDivider(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, rows, key: `table-${blocks.length}` });
      continue;
    }

    if (isUnorderedList(line)) {
      const items = [];
      while (i < lines.length && isUnorderedList(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*[-*]\s+/, '')));
        i++;
      }
      blocks.push({ type: 'ul', items, key: `ul-${blocks.length}` });
      continue;
    }

    if (isOrderedList(line)) {
      const items = [];
      while (i < lines.length && isOrderedList(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*\d+\.\s+/, '')));
        i++;
      }
      blocks.push({ type: 'ol', items, key: `ol-${blocks.length}` });
      continue;
    }

    const paragraph = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        isHeading(next) ||
        isLooseHeading(next) ||
        isUnorderedList(next) ||
        isOrderedList(next) ||
        (!live && /^```/.test(nextTrimmed)) ||
        (!live && i + 1 < lines.length && isTableRow(next) && isTableDivider(lines[i + 1]))
      ) {
        break;
      }
      paragraph.push(nextTrimmed);
      i++;
    }
    blocks.push({
      type: 'p',
      content: parseInline(paragraph.join(live ? '\n' : ' ')),
      key: `p-${blocks.length}`,
    });
  }

  return blocks;
}

function renderInline(parts) {
  return (parts || []).map((part, i) => {
    if (part.type === 'bold') return <strong key={i}>{part.text}</strong>;
    if (part.type === 'italic') return <em key={i}>{part.text}</em>;
    if (part.type === 'code') return <code key={i} className="md-code">{part.text}</code>;
    return <span key={i}>{part.text}</span>;
  });
}

function renderBlocks(blocks) {
  return blocks.map((block) => {
    if (block.type === 'h1') return <h1 key={block.key} className="md-h1">{renderInline(block.content)}</h1>;
    if (block.type === 'h2') return <h2 key={block.key} className="md-h2">{renderInline(block.content)}</h2>;
    if (block.type === 'h3') return <h3 key={block.key} className="md-h3">{renderInline(block.content)}</h3>;
    if (block.type === 'ul') {
      return (
        <ul key={block.key} className="md-ul">
          {block.items.map((item, idx) => <li key={idx} className="md-li">{renderInline(item)}</li>)}
        </ul>
      );
    }
    if (block.type === 'ol') {
      return (
        <ol key={block.key} className="md-ol">
          {block.items.map((item, idx) => <li key={idx} className="md-li">{renderInline(item)}</li>)}
        </ol>
      );
    }
    if (block.type === 'table') {
      return (
        <div key={block.key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>{block.header.map((cell, idx) => <th key={idx}>{renderInline(parseInline(cell))}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, ridx) => (
                <tr key={ridx}>
                  {row.map((cell, cidx) => <td key={cidx}>{renderInline(parseInline(cell))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.type === 'code') {
      return (
        <pre key={block.key} className="md-pre">
          <code>{block.text}</code>
        </pre>
      );
    }
    return <p key={block.key} className="md-p">{renderInline(block.content)}</p>;
  });
}

export const MarkdownView = memo(function MarkdownView({ content }) {
  const parsed = useMemo(
    () => (Array.isArray(content) ? content : renderMarkdown(content, { live: false })),
    [content]
  );
  return <>{renderBlocks(parsed)}</>;
});

export const LiveMarkdownView = memo(function LiveMarkdownView({ content }) {
  const parsed = useMemo(() => renderMarkdown(content, { live: true }), [content]);
  return <>{renderBlocks(parsed)}</>;
});
