/** Preserve table semantics while making row selection reachable by keyboard. */
export function rowSelectionProps(select) {
  return {
    tabIndex: 0,
    onClick: select,
    onKeyDown(e) {
      // A link or button inside the row owns its own keyboard activation.
      if (e.target !== e.currentTarget || e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      select();
    },
  };
}
