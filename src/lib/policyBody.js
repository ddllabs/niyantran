/** Section body text (### headings, - lists, > quotes, [links](/path)) into blocks for LegalDocPage. */
export function parsePolicyBody(body) {
  const lines = String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const blocks = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('\n').trim();
    if (text) blocks.push({ type: 'p', text });
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: 'ul', items: list });
    list = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^###\s+/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', text: line.replace(/^###\s+/, '').trim() });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: 'note', text: line.replace(/^>\s?/, '').trim() });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, '').trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
