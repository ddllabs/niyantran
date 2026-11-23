// Opens a web page: the in-app browser sheet on a phone, a new tab in a browser.
import { isNative } from './platform.js';

export async function openUrl(url) {
  const u = String(url || '');
  if (/^mailto:/i.test(u)) { window.location.href = u; return; }
  if (!/^https:\/\//i.test(u)) return;
  if (isNative()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'popover', toolbarColor: '#f8f5f0' });
  } else {
    // A real link click, which every browser (and embedded viewer) lets through.
    const a = document.createElement('a');
    a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

export async function shareLink({ title, text, url }) {
  try {
    if (isNative()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: 'Share' });
      return true;
    }
    if (navigator.share) { await navigator.share({ title, text, url }); return true; }
    await navigator.clipboard?.writeText([title, url].filter(Boolean).join('\n'));
    return 'copied';
  } catch { return false; }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      return true;
    } catch { return false; }
  }
}
