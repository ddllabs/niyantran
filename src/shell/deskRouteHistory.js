/** Only TerminalShell transitions establish an app-owned Back destination. */
export function rememberDeskNavigation(navigate, browser = window) {
  const before = browser.location.href;
  navigate();
  if (browser.location.href !== before) browser.history.replaceState({ ...browser.history.state, nterDeskBack: true }, '', browser.location.href);
}
export function backFromRestrictedDesk(onHome, browser = window) {
  if (browser.history.state?.nterDeskBack === true) browser.history.back();
  else onHome();
}
