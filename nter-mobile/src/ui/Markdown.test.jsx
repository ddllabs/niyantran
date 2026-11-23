import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import Markdown, { plainText } from './Markdown.jsx';

describe('answer rendering', () => {
  it('draws citations as buttons and never injects HTML', () => {
    const open = vi.fn();
    const { container, getByLabelText } = render(<Markdown text={'## Snapshot\nThe bill passed [1].\n\n- one [2]\n- <img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | 2 |'} sources={[{ id: 1 }, { id: 2 }]} onOpenSource={open} />);
    expect(container.querySelectorAll('button.cite')).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('table td').textContent).toBe('1');
    fireEvent.click(getByLabelText('Source 2'));
    expect(open).toHaveBeenCalledWith(2);
  });
  it('drops markers with nothing behind them once the answer is finished', () => {
    const { container } = render(<Markdown text="Fact [9]." sources={[]} />);
    expect(container.textContent).toBe('Fact .');
  });
  it('makes plain text for copying', () => {
    expect(plainText('**Bold** [1] and [link](https://a.b)')).toBe('Bold  and link (https://a.b)');
  });
});
