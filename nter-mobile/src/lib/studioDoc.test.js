import { describe, expect, it } from 'vitest';
import { inlineHtml, markdownToBlocks, sanitizeHtml, blocksToText } from './studioDoc.js';
import { makeInstruction } from '../screens/Make.jsx';
import { QE_DATA } from '../data/quickExit.js';
import { PERSONAS } from '../data/personas.js';

describe('Studio documents', () => {
  it('escapes text and draws gap markers', () => {
    const h = inlineHtml('<b>x</b> [NOT IN RECORD → Bulletin Part II] and [FROM INSTRUMENT TEXT → sansad.in] [you: clause] [3]');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).toContain('<mark class="mk non">');
    expect(h).toContain('<mark class="mk txt">');
    expect(h).toContain('<mark class="mk you">');
    expect(h).toContain('<sup>[3]</sup>');
  });
  it('turns headings into labelled blocks', () => {
    const b = markdownToBlocks('Intro line\n## KEY FEATURES\n- one\n- two\n## STATUS\nPending');
    expect(b.map((x) => x.lab)).toEqual(['', 'KEY FEATURES', 'STATUS']);
    expect(b[1].html).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(blocksToText(b)).toContain('• one');
  });
  it('strips anything a paste could smuggle in', () => {
    const out = sanitizeHtml('<p onclick="x()">Hi <img src=x onerror=alert(1)><script>alert(1)</script><mark class="mk non" style="color:red">gap</mark><a href="javascript:1">link</a></p>');
    expect(out).toBe('<p>Hi <mark class="mk non">gap</mark>link</p>');
  });
});

describe('Quick Exit instructions', () => {
  it('fit research-chat’s 4,000-character limit for every document in the catalogue', () => {
    for (const qp of QE_DATA) {
      const persona = PERSONAS[QE_DATA.indexOf(qp)];
      for (const qe of qp.docs) {
        const m = makeInstruction({ qe, persona, fmtLabel: 'PDF', answer: 'a'.repeat(300) });
        expect(m.length).toBeLessThanOrEqual(4000);
        expect(m).toContain(qe.name);
      }
    }
  });
});
