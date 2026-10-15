// F192: the document's lang follows the interface language (en or hi). Returns a function that puts
// back the language the page had before, for when the shell unmounts.
export function applyInterfaceLang(root, lang) {
  const before = root.lang;
  root.lang = lang;
  return () => { root.lang = before; };
}
