/** Native editing copy must not enter the record-export entitlement flow. */
export function isEditableCopy(event, doc = globalThis.document) {
  const target = event?.target === doc ? doc?.activeElement : event?.target;
  const element = target?.nodeType === 3 ? target.parentElement : target;
  const editor = element?.closest?.('input, textarea, [contenteditable]');
  return Boolean(editor && editor.getAttribute?.('contenteditable') !== 'false');
}
