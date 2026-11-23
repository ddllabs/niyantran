// Screen 01: Outcome-led Sign In.
// First impression promises a useful result: turn today's live record into work a lawyer can file.
import { useEffect, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { api, isSample } from '../services/index.js';
import { SITE_FIGURES } from '../services/shape.js';
import { loadGlobe } from '../globe/index.js';
import { asset } from '../lib/asset.js';
import Icon from '../ui/Icon.jsx';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export default function Welcome() {
  const { setStage, setAuthEmail, browseAsGuest, signIn } = useApp();
  const [figures, setFigures] = useState(SITE_FIGURES);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [globe, setGlobe] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGlobe().then((ok) => alive && setGlobe(ok));
    api.siteFigures().then((f) => alive && setFigures(f)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleContinue = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address');
      return;
    }
    if (!EMAIL_RE.test(cleanEmail)) {
      setError('Enter a valid email address');
      return;
    }
    setError('');
    setAuthEmail(cleanEmail);
    if (isSample) {
      try {
        await signIn(cleanEmail, 'sample123');
      } catch {
        setStage('persona');
      }
    } else {
      setStage('signin');
    }
  };

  const openLegal = (path) => {
    import('@capacitor/browser')
      .then(({ Browser }) => Browser.open({ url: `https://www.nter.pro${path}` }))
      .catch(() => window.open(`https://www.nter.pro${path}`, '_blank'));
  };

  return (
    <div className="view welcome-storyboard-view">
      <div className="welcome-nav">
        <div className="brand">
          <img src={asset('/brand/logo-128.webp')} alt="" className="brand-pi" />
          <span className="brand-name">TERMINAL</span>
        </div>
        <button type="button" className="ib nav-menu" onClick={browseAsGuest} aria-label="Menu / Browse as guest">
          <Icon name="bars" />
        </button>
      </div>

      <div className="body welcome-scroll">
        {/* Outcome Hero */}
        <div className="outcome-hero">
          <div className="intelligence-badge">
            <span className="live-dot" />
            <span>LIVE INTELLIGENCE · READY</span>
          </div>

          <h1 className="outcome-headline">
            From today's feed<br />to work you can file.
          </h1>

          <p className="outcome-sub">
            Search trusted public records, analyse the evidence and create a cited document in one flow.
          </p>

          <div className="hero-globe-mini">
            {globe ? (
              <nter-data-globe {...(paused ? { paused: '' } : {})} />
            ) : (
              <img className="globe-still-mini" src={asset('/textures/globe-still.webp')} alt="" />
            )}
            <button
              type="button"
              className="mini-globe-toggle"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? 'Resume globe' : 'Pause globe'}
            >
              {paused ? '▶' : '❚❚'}
            </button>
          </div>
        </div>

        {/* Outcome Sign-in Card */}
        <div className="outcome-card">
          <div className="card-k">SIGN IN TO YOUR TERMINAL</div>

          <form onSubmit={handleContinue} className="outcome-form" noValidate>
            <label htmlFor="welcome-email-input" className="input-label">Email address</label>
            <input
              id="welcome-email-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="name@chambers.in"
              className="outcome-input"
            />
            {error && <div className="err-msg" role="alert">{error}</div>}

            <button type="submit" className="pbtn continue-outcome-btn">
              Continue →
            </button>
          </form>

          <div className="legal-notice">
            By continuing, you agree to the{' '}
            <button type="button" onClick={() => openLegal('/terms')} className="link-text">Terms</button>{' '}
            and{' '}
            <button type="button" onClick={() => openLegal('/privacy')} className="link-text">Privacy Policy</button>.
          </div>
        </div>

        {/* Live Indicators Metrics */}
        <div className="trust-metrics-row">
          <div className="metric-col">
            <div className="metric-val">{figures.endpoints ? `${figures.endpoints}+` : '211+'}</div>
            <div className="metric-lbl">LIVE ENDPOINTS</div>
          </div>
          <div className="metric-col">
            <div className="metric-val">{figures.bills ? `${figures.bills.toLocaleString('en-IN')}+` : '4,576+'}</div>
            <div className="metric-lbl">BILLS TRACKED</div>
          </div>
          <div className="metric-col">
            <div className="metric-val">{figures.since ? `${figures.since}–` : '1952–'}</div>
            <div className="metric-lbl">ARCHIVE DEPTH</div>
          </div>
        </div>

        <div className="welcome-alt-foot">
          <button type="button" className="guest-action-btn" onClick={browseAsGuest}>
            Browse the record without an account →
          </button>
          <div className="tagline-sub">CONCEPT · SAMPLE WORKSPACE AND CONTENT</div>
        </div>
      </div>
    </div>
  );
}
