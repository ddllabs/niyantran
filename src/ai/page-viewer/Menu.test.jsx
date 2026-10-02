import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Copy } from './icons.js';
import { MenuPopup } from './Menu.jsx';

describe('MenuPopup', () => {
  const noop = () => {};

  it('is a labelled menu of items that are not in the tab order', () => {
    const html = renderToStaticMarkup(
      <MenuPopup id="m1" label="More" onChoose={noop} items={[
        { id: 'copy', label: 'Copy file name', icon: Copy, onSelect: noop },
        { id: 's', separator: true },
        { id: 'fit', label: 'Fit text', checked: true, onSelect: noop },
        { id: 'width', label: 'Fit width', checked: false, onSelect: noop },
      ]} />,
    );
    expect(html).toMatch(/^<div id="m1" class="pv-menu" role="menu" aria-label="More" data-side="below" data-align="end">/);
    expect(html).toMatch(/role="menuitem"[^>]*><span class="pv-menu-mark"><svg/);
    expect(html).toContain('role="separator"');
    expect(html).toMatch(/role="menuitemradio" aria-checked="true"><span class="pv-menu-mark"><svg/);
    expect(html).toMatch(/role="menuitemradio" aria-checked="false"><span class="pv-menu-mark"><\/span>/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3);
  });

  it('describes an item by the text it acts on, such as the file name in the footer', () => {
    const html = renderToStaticMarkup(<MenuPopup id="m" label="More" onChoose={noop} items={[{ id: 'copy', label: 'Copy file name', describedBy: 'f1', onSelect: noop }]} footer={<span id="f1">bill.pdf</span>} />);
    expect(html).toMatch(/role="menuitem" aria-describedby="f1"/);
  });

  it('renders its footer, and escapes text like any other', () => {
    const html = renderToStaticMarkup(<MenuPopup id="m" label="More" onChoose={noop} items={[]} footer={<span>{'<img src=x onerror=alert(1)>'}</span>} />);
    expect(html).toContain('class="pv-menu-foot"');
    expect(html).not.toContain('<img');
  });
});
