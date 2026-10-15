/**
 * F196: plain HTML tables as grids of cell text, for the RBI pages (the Handbook of Statistics on
 * Indian States and the State Government Securities auction releases). No HTML library: the pages
 * are simple, regular tables, read with one scan of their table, row and cell tags.
 *
 * extractTables(html) returns every table, innermost first as each closes, each as
 * { rows: [[{ text, rowspan, colspan }]] }. A table inside a cell is its own table; its text is not
 * added to the outer cell. gridOf(table) lays the cells out on a grid with rowspan and colspan
 * expanded (a spanned cell's text repeats in every slot it covers) and marks each slot with the cell
 * it came from, so a caller can tell one wide cell from several cells.
 */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', agrave: 'à', eacute: 'é', minus: '−', times: '×', deg: '°' };

/** HTML character references as text (named ones from a short list; numeric ones all). */
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** A cell's markup as one line of text: tags out, <br> as a space, references decoded, spaces squashed. */
export function cellText(html) {
  const text = String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text).replace(/[\s\u00a0]+/g, ' ').trim();
}

const SPAN = /\b(rowspan|colspan)\s*=\s*["']?(\d+)/gi;

function spans(tag) {
  const out = { rowspan: 1, colspan: 1 };
  for (const [, name, n] of tag.matchAll(SPAN)) out[name.toLowerCase()] = Math.max(1, Math.min(50, Number(n) || 1));
  return out;
}

/** Every table of the page, innermost first, as rows of cells (see the file comment). */
export function extractTables(html) {
  const source = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const TAG = /<(\/?)(table|tr|td|th)\b[^>]*>/gi;
  const stack = [];
  const done = [];
  let at = 0;
  const top = () => stack[stack.length - 1];
  const closeCell = (t) => {
    if (t?.cell) {
      t.cell.text = cellText(t.cell.raw);
      delete t.cell.raw;
      t.cell = null;
    }
  };
  for (const m of source.matchAll(TAG)) {
    const t = top();
    if (t?.cell) t.cell.raw += source.slice(at, m.index);
    at = m.index + m[0].length;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'table') {
      if (!closing) stack.push({ rows: [], cell: null });
      else if (t) {
        closeCell(t);
        stack.pop();
        done.push({ rows: t.rows.filter((r) => r.length) });
      }
      continue;
    }
    if (!t) continue;
    if (name === 'tr') {
      closeCell(t);
      if (!closing) t.rows.push([]);
      continue;
    }
    // td / th
    if (closing) {
      closeCell(t);
      continue;
    }
    closeCell(t);
    if (!t.rows.length) t.rows.push([]);
    t.cell = { raw: '', ...spans(m[0]) };
    t.rows[t.rows.length - 1].push(t.cell);
  }
  // Tables left open at the end of the page (a cut-off page) are still returned.
  while (stack.length) {
    const t = stack.pop();
    closeCell(t);
    done.push({ rows: t.rows.filter((r) => r.length) });
  }
  return done;
}

/**
 * The table on a grid: grid[r][c] = { text, id, colspan, rowspan } where id numbers the source cell,
 * so the slots one cell covers share it. Missing slots (a short row) are null.
 */
export function gridOf(table) {
  const grid = [];
  let id = 0;
  table.rows.forEach((row, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const cell of row) {
      while (grid[r][c]) c += 1;
      id += 1;
      for (let dr = 0; dr < cell.rowspan; dr += 1) {
        const rr = r + dr;
        grid[rr] = grid[rr] || [];
        for (let dc = 0; dc < cell.colspan; dc += 1) grid[rr][c + dc] = { text: cell.text, id, colspan: cell.colspan, rowspan: cell.rowspan, top: dr === 0 };
      }
      c += cell.colspan;
    }
  });
  // Only the table's own rows: a rowspan past the last row adds nothing.
  grid.length = table.rows.length;
  const width = Math.max(0, ...grid.map((row) => row.length));
  return grid.map((row) => Array.from({ length: width }, (_v, c) => row[c] || null));
}
