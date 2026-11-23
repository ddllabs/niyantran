// App-wide state: who is signed in, their plan, credits and models, the tab stacks, the open
// sheet, the toast, theme, pinned records, made documents and the watchlist.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, isSample } from '../services/index.js';
import { effectivePlan, creditsSummary } from '../services/shape.js';
import { getJSON, setJSON } from '../lib/storage.js';
import { isNative } from '../lib/platform.js';
import { personaByDb } from '../data/personas.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const DEFAULT_WATCHLIST = [
  { tab: 'global', feature: 'Open Fronts', label: 'Open Fronts' },
  { tab: 'national', feature: 'Bill Passage Probability Index', label: 'Bill Passage' },
  { tab: 'economics', feature: 'NSE/BSE Delayed Market Feed', label: 'Markets' },
];
export const DEFAULT_LAWYER_PROFILE = {
  name: 'Arjun Kapoor',
  practiceArea: 'Civil & commercial',
  jurisdiction: 'India',
  practiceTags: ['Litigation', 'Advisory', 'English'],
  language: 'English',
};
const EMPTY_STACKS = { home: [], ask: [], library: [], me: [] };

export function AppProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [stage, setStage] = useState('welcome'); // welcome | signin | signup | verify | forgot | persona | lawyer_profile | app
  const [authEmail, setAuthEmail] = useState('');
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [guestPersona, setGuestPersona] = useState(null);
  const [lawyerProfile, setLawyerProfileState] = useState(DEFAULT_LAWYER_PROFILE);
  const [entitlement, setEntitlement] = useState(null);
  const [cycle, setCycle] = useState(null);
  const [models, setModels] = useState([]);
  const [tab, setTabState] = useState('home');
  const [stacks, setStacks] = useState(EMPTY_STACKS);
  const [sheet, setSheet] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [theme, setThemeState] = useState('light');
  const [pins, setPins] = useState([]);
  const [made, setMade] = useState([]);
  const [watchlist, setWatchlistState] = useState(DEFAULT_WATCHLIST);
  const [writing, setWritingState] = useState({ aud: 'Principal / MP office', lang: 'English', cite: 'None', org: '' });
  const toastTimer = useRef(null);

  const signedIn = Boolean(session);
  const personaDb = profile?.persona || guestPersona || null;
  const persona = personaByDb(personaDb) || null;
  const plan = effectivePlan(entitlement);
  const credits = creditsSummary(cycle);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  // ---------- account ----------
  const refreshAccount = useCallback(async () => {
    const [ent, cyc] = await Promise.allSettled([api.getEntitlement(), api.getCredits()]);
    if (ent.status === 'fulfilled') setEntitlement(ent.value);
    if (cyc.status === 'fulfilled') setCycle(cyc.value);
  }, []);
  const refreshCredits = useCallback(async () => {
    try { setCycle(await api.getCredits()); } catch { /* keep the last figure */ }
  }, []);

  const loadSignedIn = useCallback(async () => {
    const p = await api.getProfile().catch(() => null);
    if (p && p.status && p.status !== 'active') {
      await api.signOut();
      setSession(null);
      setStage('signin');
      toast('This account is not active. Write to niyantranai@gmail.com.');
      return;
    }
    setProfile(p);
    refreshAccount();
    api.getWatchlist().then((w) => { if (Array.isArray(w) && w.length) setWatchlistState(w); }).catch(() => {});
    setStage(p?.persona ? 'app' : 'persona');
  }, [refreshAccount, toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, g, pn, md, wr, lp] = await Promise.all([
        getJSON('nter.theme', 'light'), getJSON('nter.guestPersona', null), getJSON('nter.pins', []), getJSON('nter.studio.docs', []), getJSON('nter.writing', null), getJSON('nter.lawyerProfile', null),
      ]);
      if (!alive) return;
      setThemeState(t || 'light');
      setGuestPersona(g);
      setPins(Array.isArray(pn) ? pn : []);
      setMade(Array.isArray(md) ? md : []);
      if (wr) setWritingState(wr);
      if (lp) setLawyerProfileState((prev) => ({ ...prev, ...lp }));
      const s = await api.getSession().catch(() => null);
      if (!alive) return;
      setSession(s);
      if (s) await loadSignedIn();
      else {
        const guest = await getJSON('nter.guest', false);
        if (guest) setStage('app');
      }
      setBooting(false);
    })();
    const off = api.onAuthChange((s) => setSession(s));
    return () => { alive = false; off?.(); };
  }, [loadSignedIn]);

  // The model list is readable only when signed in (ai_models is closed to anonymous visitors),
  // so it loads, and reloads, whenever the signed-in member changes.
  const memberId = session?.user?.id || null;
  useEffect(() => {
    let alive = true;
    if (!memberId && !isSample) { setModels([]); return undefined; }
    api.getModels().then((m) => alive && setModels(m)).catch(() => alive && setModels([]));
    return () => { alive = false; };
  }, [memberId]);

  // theme on <html>, the status bar and the browser chrome
  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121212' : '#f8f5f0');
    if (isNative()) {
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
        StatusBar.setBackgroundColor?.({ color: dark ? '#121212' : '#f8f5f0' }).catch(() => {});
      }).catch(() => {});
    }
  }, [theme]);
  const setTheme = useCallback((t) => { setThemeState(t); setJSON('nter.theme', t); }, []);

  // ---------- auth actions ----------
  const signIn = useCallback(async (email, password) => {
    const s = await api.signIn({ email, password });
    setSession(s);
    await setJSON('nter.guest', false);
    await loadSignedIn();
  }, [loadSignedIn]);

  const signUp = useCallback(async (form) => {
    const r = await api.signUp(form);
    setAuthEmail(form.email);
    if (r.session) {
      setSession(r.session);
      if (form.persona) await api.setPersona(form.persona.db).catch(() => {});
      await loadSignedIn();
    } else setStage('verify');
  }, [loadSignedIn]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(null); setProfile(null); setEntitlement(null); setCycle(null);
    setWatchlistState(DEFAULT_WATCHLIST);
    setStacks(EMPTY_STACKS); setTabState('home'); setSheet(null);
    await setJSON('nter.guest', false);
    setStage('welcome');
  }, []);

  const browseAsGuest = useCallback(async () => {
    await setJSON('nter.guest', true);
    setStage(guestPersona ? 'app' : 'persona');
  }, [guestPersona]);

  const choosePersona = useCallback(async (p) => {
    if (signedIn) {
      try { await api.setPersona(p.db); } catch (e) { toast(e.message); return; }
      setProfile((old) => ({ ...(old || {}), persona: p.db }));
    } else {
      setGuestPersona(p.db);
      await setJSON('nter.guestPersona', p.db);
    }
    if (stage === 'persona') {
      if (p.id === 'lawyer' || p.db === 'legal_researcher') {
        setStage('lawyer_profile');
      } else {
        setStage('app');
      }
    }
  }, [signedIn, stage, toast]);

  const updateLawyerProfile = useCallback((patch) => {
    setLawyerProfileState((old) => {
      const next = { ...old, ...patch };
      setJSON('nter.lawyerProfile', next);
      return next;
    });
  }, []);

  // ---------- navigation ----------
  const setTab = useCallback((t) => {
    setSheet(null);
    if (t === tab) setStacks((s) => ({ ...s, [t]: [] })); // tapping the current tab returns to its root
    setTabState(t);
  }, [tab]);
  const push = useCallback((view) => { setSheet(null); setStacks((s) => ({ ...s, [tab]: [...s[tab], view] })); }, [tab]);
  const pop = useCallback(() => setStacks((s) => ({ ...s, [tab]: s[tab].slice(0, -1) })), [tab]);
  const replaceTop = useCallback((view) => setStacks((s) => ({ ...s, [tab]: [...s[tab].slice(0, -1), view] })), [tab]);
  const go = useCallback((t, view) => {
    setSheet(null);
    setTabState(t);
    setStacks((s) => ({ ...s, [t]: view ? [view] : [] }));
  }, []);
  const openSheet = useCallback((k, props = {}) => setSheet({ k, ...props }), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  // Android back button: sheet → stack → home tab → leave the app
  const backRef = useRef(null);
  backRef.current = () => {
    if (sheet) { setSheet(null); return true; }
    if (stage !== 'app') {
      if (['signin', 'signup', 'forgot', 'verify'].includes(stage)) { setStage('welcome'); return true; }
      return false;
    }
    if (stacks[tab].length) { pop(); return true; }
    if (tab !== 'home') { setTabState('home'); return true; }
    return false;
  };
  useEffect(() => {
    if (!isNative()) return undefined;
    let subs = [];
    import('@capacitor/app').then(({ App }) => {
      subs.push(App.addListener('backButton', () => { if (!backRef.current()) App.exitApp(); }));
      subs.push(App.addListener('appUrlOpen', async ({ url }) => {
        if (String(url).startsWith('pro.nter.app://auth')) {
          try { const s = await api.completeOAuth(url); if (s) { setSession(s); await loadSignedIn(); } } catch (e) { toast(e.message); }
        }
      }));
    });
    return () => subs.forEach((p) => Promise.resolve(p).then((h) => h?.remove?.()));
  }, [loadSignedIn, toast]);

  // ---------- pins, made documents, watchlist, writing profile ----------
  const togglePin = useCallback((item) => {
    setPins((old) => {
      const has = old.some((p) => p.key === item.key);
      const next = has ? old.filter((p) => p.key !== item.key) : [{ ...item, pinnedAt: new Date().toISOString() }, ...old].slice(0, 100);
      setJSON('nter.pins', next);
      return next;
    });
  }, []);
  const saveMade = useCallback((doc) => {
    setMade((old) => {
      const next = [doc, ...old.filter((d) => d.id !== doc.id)].slice(0, 60);
      setJSON('nter.studio.docs', next);
      return next;
    });
  }, []);
  const removeMade = useCallback((id) => {
    setMade((old) => { const next = old.filter((d) => d.id !== id); setJSON('nter.studio.docs', next); return next; });
  }, []);
  const setWatchlist = useCallback(async (list) => {
    setWatchlistState(list);
    if (signedIn) { try { await api.saveWatchlist(list); } catch (e) { toast(e.message); } }
  }, [signedIn, toast]);
  const toggleWatch = useCallback((item) => {
    const has = watchlist.some((w) => w.tab === item.tab && w.feature === item.feature);
    const next = has ? watchlist.filter((w) => !(w.tab === item.tab && w.feature === item.feature)) : [...watchlist, item].slice(0, 24);
    setWatchlist(next);
    toast(has ? 'Removed from your watchlist' : 'Added to your watchlist');
  }, [watchlist, setWatchlist, toast]);
  const setWriting = useCallback((w) => { setWritingState(w); setJSON('nter.writing', w); }, []);

  const requireSignIn = useCallback((why = 'Sign in to use the AI') => {
    if (signedIn) return true;
    openSheet('signinPrompt', { why });
    return false;
  }, [signedIn, openSheet]);

  const value = useMemo(() => ({
    isSample, booting, stage, setStage, authEmail, setAuthEmail, session, signedIn, profile, persona, personaDb,
    lawyerProfile, updateLawyerProfile,
    entitlement, plan, credits, cycle, models, refreshAccount, refreshCredits,
    signIn, signUp, signOut, browseAsGuest, choosePersona, requireSignIn,
    tab, setTab, stacks, push, pop, replaceTop, go, sheet, openSheet, closeSheet,
    toastMsg, toast, theme, setTheme,
    pins, togglePin, made, saveMade, removeMade, watchlist, setWatchlist, toggleWatch, writing, setWriting,
  }), [booting, stage, authEmail, session, signedIn, profile, persona, personaDb, lawyerProfile, updateLawyerProfile, entitlement, plan, credits, cycle, models, refreshAccount, refreshCredits,
    signIn, signUp, signOut, browseAsGuest, choosePersona, requireSignIn, tab, setTab, stacks, push, pop, replaceTop, go, sheet, openSheet, closeSheet,
    toastMsg, toast, theme, setTheme, pins, togglePin, made, saveMade, removeMade, watchlist, setWatchlist, toggleWatch, writing, setWriting]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
