import { useEffect, useState } from 'react';
import HomePage from './HomePage.jsx';
import LoginPage from './LoginPage.jsx';
import SignupPage from './SignupPage.jsx';
import ForgotPasswordPage from './ForgotPasswordPage.jsx';
import ResetPasswordPage from './ResetPasswordPage.jsx';
import PricingPage from './PricingPage.jsx';
import PrivacyPage from './PrivacyPage.jsx';
import TermsPage from './TermsPage.jsx';
import { loadSiteSettings, subscribeSiteSettings } from '../lib/siteSettingsStore.js';
import { setPageTitle } from '../lib/siteHead.js';
import './marketing.css';

const LEGAL = { privacy: '/privacy', terms: '/terms' };

function pageFromRoute() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/privacy') return 'privacy';
  if (path === '/terms') return 'terms';
  if (path === '/forgot-password') return 'forgot-password';
  if (path === '/reset-password') return 'reset-password';
  const raw = String(location.hash || '')
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
  if (raw.startsWith('forgot-password') || raw.startsWith('forgotpassword')) return 'forgot-password';
  if (raw.startsWith('reset-password') || raw.startsWith('resetpassword') || raw.includes('type=recovery') || raw.includes('error_code=')) return 'reset-password';
  if (raw.startsWith('pricing')) return 'pricing';
  if (raw.startsWith('signup') || raw.startsWith('register')) return 'signup';
  if (raw.startsWith('login')) return 'login';
  if (raw.startsWith('privacy')) return 'privacy';
  if (raw.startsWith('terms')) return 'terms';
  return 'home';
}

export default function MarketingSite({ onAuthed }) {
  const [page, setPage] = useState(pageFromRoute);
  const [menu, setMenu] = useState(false);
  const [site, setSite] = useState(() => loadSiteSettings());

  useEffect(() => {
    document.documentElement.classList.add('mkt-doc');
    document.body.classList.add('mkt-doc');
    const onHash = () => {
      setPage(pageFromRoute());
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      document.documentElement.classList.remove('mkt-doc');
      document.body.classList.remove('mkt-doc');
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);

  useEffect(() => subscribeSiteSettings(setSite), []);

  useEffect(() => {
    if (page === 'privacy') setPageTitle('Privacy Policy');
    else if (page === 'terms') setPageTitle('Terms & Conditions');
    else if (page === 'pricing') setPageTitle('Pricing');
    else if (page === 'login') setPageTitle('Sign in');
    else if (page === 'signup') setPageTitle('Create account');
    else if (page === 'forgot-password') setPageTitle('Forgot Password');
    else if (page === 'reset-password') setPageTitle('Reset Password');
    else setPageTitle('');
  }, [page, site.siteName, site.metaTitle]);

  function go(next) {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const legalHref = LEGAL[next];
    if (legalHref) {
      if (path !== legalHref) {
        history.pushState({}, '', legalHref);
        window.dispatchEvent(new Event('popstate'));
      } else {
        setPage(next);
        setMenu(false);
        window.scrollTo(0, 0);
      }
      return;
    }
    const hash = next === 'home' ? '#/' : `#/${next}`;
    if (path === '/privacy' || path === '/terms') {
      history.pushState({}, '', `/${hash}`);
      window.dispatchEvent(new Event('popstate'));
      return;
    }
    if (location.hash !== hash) location.hash = hash;
    else {
      setPage(next);
      setMenu(false);
      window.scrollTo(0, 0);
    }
  }

  function onCoverage() {
    if (page !== 'home') {
      go('home');
      setTimeout(() => document.getElementById('coverage')?.scrollIntoView({ behavior: 'smooth' }), 80);
      return;
    }
    document.getElementById('coverage')?.scrollIntoView({ behavior: 'smooth' });
  }

  const year = new Date().getFullYear();
  const short = site.shortName || 'TERMINAL';
  const auth = page === 'login' || page === 'signup' || page === 'forgot-password' || page === 'reset-password';

  return (
    <div className={`mkt${auth ? ' mkt-auth' : ''}`}>
      <header className="mkt-header">
        <div className="mkt-header-inner">
          <button type="button" className="mkt-brand" onClick={() => go('home')}>
            <img src={site.faviconUrl || '/brand/logo.png?v=2'} alt="" />
            <span>{short}</span>
          </button>
          <nav className={`mkt-nav-links${menu ? ' open' : ''}`}>
            <button type="button" className={`mkt-nav-link${page === 'home' ? ' on' : ''}`} onClick={() => go('home')}>
              Home
            </button>
            <button type="button" className={`mkt-nav-link${page === 'pricing' ? ' on' : ''}`} onClick={() => go('pricing')}>
              Pricing
            </button>
            <button type="button" className={`mkt-nav-link${page === 'login' ? ' on' : ''}`} onClick={() => go('login')}>
              Sign in
            </button>
            <button type="button" className={`mkt-cta${page === 'signup' ? ' on' : ''}`} onClick={() => go('signup')}>
              Get Started
            </button>
          </nav>
          <button type="button" className="mkt-menu-btn" aria-label="Menu" onClick={() => setMenu((v) => !v)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </header>

      {page === 'home' && (
        <HomePage onLogin={() => go('login')} onCoverage={onCoverage} onPricing={() => go('pricing')} />
      )}
      {page === 'pricing' && (
        <PricingPage
          onLogin={(planId) => {
            if (!planId || planId === 'signup' || planId === 'gov') go('signup');
            else go(`signup?plan=${planId}`);
          }}
        />
      )}
      {page === 'privacy' && <PrivacyPage />}
      {page === 'terms' && <TermsPage />}
      {page === 'login' && <LoginPage onSuccess={onAuthed} onSignup={() => go('signup')} onForgotPassword={() => go('forgot-password')} />}
      {page === 'signup' && <SignupPage onSuccess={onAuthed} onLogin={() => go('login')} />}
      {page === 'forgot-password' && <ForgotPasswordPage onLogin={() => go('login')} />}
      {page === 'reset-password' && <ResetPasswordPage onLogin={() => go('login')} />}

      {!auth && <footer className="mkt-footer">
        <span className="mkt-red-shard" aria-hidden="true" />
        <div className="mkt-wrap mkt-footer-grid">
          <div>
            <div className="mark">
              <img src={site.faviconUrl || '/brand/logo.png?v=2'} alt="" />
              {short}
            </div>
            <p>{site.tagline}</p>
            <div className="mkt-soc">
              <a href="https://x.com" target="_blank" rel="noreferrer">
                𝕏
              </a>
              <a href="https://www.linkedin.com" target="_blank" rel="noreferrer">
                in
              </a>
              <a href="https://www.youtube.com" target="_blank" rel="noreferrer">
                ▶
              </a>
            </div>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li>
                <button type="button" onClick={() => go('login')}>
                  Live Terminal
                </button>
              </li>
              <li>
                <button type="button" onClick={onCoverage}>
                  Desks Overview
                </button>
              </li>
            </ul>
          </div>
          <div>
            <h4>Resources</h4>
            <ul>
              <li>
                <button type="button" onClick={onCoverage}>
                  Documentation
                </button>
              </li>
              <li>
                <button type="button" onClick={() => go('pricing')}>
                  Pricing
                </button>
              </li>
            </ul>
          </div>
          <div>
            <h4>Legal</h4>
            <ul>
              <li>
                <button type="button" onClick={() => go('privacy')}>
                  Privacy Policy
                </button>
              </li>
              <li>
                <button type="button" onClick={() => go('terms')}>
                  Terms & Conditions
                </button>
              </li>
              <li>
                <button type="button" onClick={() => go('home')}>
                  About
                </button>
              </li>
            </ul>
          </div>
          <div className="mkt-box">
            <p>Ready to power your decisions with real-time intelligence?</p>
            <button type="button" className="mkt-cta" onClick={() => go('signup')}>
              Request Access →
            </button>
          </div>
        </div>
        <div className="mkt-wrap mkt-copy">
          <div className="mkt-copy-row">
            <span>
              © {year} {site.siteName}. All rights reserved.
            </span>
            <div className="mkt-legal-links">
              <button type="button" onClick={() => go('privacy')}>
                Privacy Policy
              </button>
              <button type="button" onClick={() => go('terms')}>
                Terms & Conditions
              </button>
            </div>
          </div>
        </div>
      </footer>}
    </div>
  );
}
