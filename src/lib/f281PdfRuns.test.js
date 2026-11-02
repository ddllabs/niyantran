import { describe, expect, it } from 'vitest';
import { runsFromOperatorList } from '../../scripts/f281-repair/pdfRuns.mjs';

// A synthetic pdf.js operator list. No PDF is committed: the real ones are the official documents, fetched by
// `repair.mjs prepare`. The operator numbers are arbitrary; only their names matter to the function.
const OPS = {
  save: 1, restore: 2, transform: 3, paintFormXObjectBegin: 4, paintFormXObjectEnd: 5, beginText: 6, setFont: 7, setTextMatrix: 8, moveText: 9,
  setLeadingMoveText: 10, setLeading: 11, nextLine: 12, setCharSpacing: 13, setWordSpacing: 14, setHScale: 15, showText: 16, nextLineShowText: 17,
  nextLineSetSpacingShowText: 18,
};
const g = (unicode, width = 500, extra = {}) => ({ unicode, width, ...extra });
const list = (ops) => ({ fnArray: ops.map(([name]) => OPS[name]), argsArray: ops.map(([, args]) => args) });
const run = (ops) => runsFromOperatorList(list(ops), OPS, (name) => ({ name: `${name}+Times`, composite: false })).runs;

describe('runsFromOperatorList', () => {
  it('turns a show operation into a run with its start, end, baseline and size', () => {
    const [r] = run([['beginText', null], ['setFont', ['F1', 10]], ['setTextMatrix', [1, 0, 0, 1, 100, 700]], ['showText', [[g('A'), g('B')]]]]);
    expect(r).toMatchObject({ str: 'AB', fontName: 'F1', x: 100, endX: 110, y: 700, size: 10 });
  });

  it('takes the scale from the text matrix when the font size is 1 (Word writes it that way)', () => {
    const [r] = run([['setFont', ['F1', 1]], ['setTextMatrix', [10, 0, 0, 10, 50, 600]], ['showText', [[g('A', 600)]]]]);
    expect(r).toMatchObject({ x: 50, endX: 56, y: 600, size: 10 });
  });

  it('cuts a run at a TJ gap of 150 thousandths of an em or more, and not at kerning', () => {
    const runs = run([['setFont', ['F1', 10]], ['setTextMatrix', [1, 0, 0, 1, 0, 700]], ['showText', [[g('A'), 40, g('B'), -300, g('C')]]]]);
    expect(runs.map((r) => r.str)).toEqual(['AB', 'C']);
    expect(runs[1].x).toBeGreaterThan(runs[0].endX);
    expect(runs[1].x - runs[0].endX).toBeCloseTo(3, 5);
  });

  it('the " operator sets word and character spacing, and they stay in force for the next show', () => {
    // " takes [wordSpacing, charSpacing, glyphs]: it moves to the next line, sets Tw and Tc, and shows.
    const runs = run([
      ['setFont', ['F1', 10]], ['setTextMatrix', [1, 0, 0, 1, 100, 700]], ['setLeading', [12]],
      ['nextLineSetSpacingShowText', [2, 1, [g('A'), g(' ', 250, { isSpace: true }), g('B')]]],
      ['showText', [[g('C')]]],
    ]);
    // advance of the first: A (5 + Tc 1) + space (2.5 + Tc 1 + Tw 2) + B (5 + Tc 1) = 17.5
    expect(runs[0]).toMatchObject({ str: 'A B', x: 100, y: 688 });
    expect(runs[0].endX).toBeCloseTo(117.5, 5);
    // the next show starts where this one ended and still pays Tc: C = 5 + 1
    expect(runs[1].x).toBeCloseTo(117.5, 5);
    expect(runs[1].endX).toBeCloseTo(123.5, 5);
  });

  it('a space glyph pays word spacing from Tw; another glyph does not', () => {
    const [r] = run([['setFont', ['F1', 10]], ['setTextMatrix', [1, 0, 0, 1, 0, 700]], ['setWordSpacing', [4]], ['showText', [[g('A'), g(' ', 250, { isSpace: true }), g('B')]]]]);
    expect(r.endX).toBeCloseTo(5 + 2.5 + 4 + 5, 5);
  });

  it('the old behaviour is gone: " without its spacing would end 6 short', () => {
    const [r] = run([['setFont', ['F1', 10]], ['setTextMatrix', [1, 0, 0, 1, 0, 700]], ['setLeading', [12]], ['nextLineSetSpacingShowText', [0, 2, [g('A'), g('B')]]]]);
    expect(r.endX).toBeCloseTo(10 + 4, 5);
  });

  it('applies horizontal scaling, line moves and the graphics state stack', () => {
    const runs = run([
      ['setFont', ['F1', 10]], ['setTextMatrix', [1, 0, 0, 1, 0, 700]], ['setHScale', [50]], ['showText', [[g('A')]]],
      ['save', null], ['transform', [1, 0, 0, 1, 20, 0]], ['moveText', [0, -10]], ['showText', [[g('B')]]], ['restore', null],
      ['moveText', [0, -10]], ['showText', [[g('C')]]],
    ]);
    expect(runs[0]).toMatchObject({ x: 0, endX: 2.5 });
    expect(runs[1]).toMatchObject({ x: 20, y: 690 });
    expect(runs[2].x).toBe(0);
    expect(runs[2].y).toBe(680);
  });

  it('reports each font once with what resolveFont said', () => {
    const { fonts } = runsFromOperatorList(list([['setFont', ['F1', 10]], ['showText', [[g('A')]]], ['setFont', ['F2', 10]], ['showText', [[g('B')]]], ['setFont', ['F1', 10]], ['showText', [[g('C')]]]]), OPS, (n) => ({ name: `${n}+X`, composite: n === 'F2' }));
    expect(fonts).toEqual({ F1: { name: 'F1+X', composite: false }, F2: { name: 'F2+X', composite: true } });
  });

  it('ignores a show with no font set and an empty one', () => {
    expect(run([['showText', [[g('A')]]]])).toEqual([]);
    expect(run([['setFont', ['F1', 10]], ['showText', [[]]]])).toEqual([]);
  });
});
