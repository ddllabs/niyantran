/**
 * F140 (owner 2026-10-13): where each label on the homepage globe leads: its desk landing, or the
 * terminal module that holds that data. The terminal needs an account, so a signed-out visitor's
 * destination is kept in `niyantranLand` / `niyantranFeature` (the coverage carousel's hand-off,
 * read by TerminalShell after sign-in) and they are sent to sign in.
 */
export const GLOBE_DESTINATIONS = {
  bills: { tab: 'national', feature: 'Bill Passage Probability Index' },
  law: { tab: 'law', feature: '' },
  regulatory: { tab: 'national', feature: 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)' },
  news: { tab: 'home', feature: '' },
  questions: { tab: 'national', feature: 'Parliamentary Question Database' },
  economics: { tab: 'economics', feature: '' },
  global: { tab: 'global', feature: '' },
};

export function openGlobeDestination(key, { storage, signedIn, onLogin, navigate }) {
  const dest = GLOBE_DESTINATIONS[key];
  if (!dest) return;
  if (signedIn) {
    navigate?.(dest.tab, dest.feature);
    return;
  }
  storage.setItem('niyantranLand', dest.tab);
  if (dest.feature) storage.setItem('niyantranFeature', dest.feature);
  else storage.removeItem('niyantranFeature');
  onLogin?.();
}
