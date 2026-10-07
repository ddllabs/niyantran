import { DESK_IMAGES } from './deskImages.js';
const filename = name => /\.(png|jpe?g|svg|webp)$/.test(name) ? name : `${name}.jpg`;
const positions = { voters: '50% 8%', 'supreme-front-web': '50% 28%', 'press-cameras': '50% 28%', 'parliament-new': '50% 25%', 'steel-web': '50% 68%' };
function Photo({ name, className = '', position }) {
  return <img className={className} src={DESK_IMAGES[filename(name)]} alt="" style={{ objectPosition: position || positions[name] || '50% 50%' }} loading="lazy" decoding="async" />;
}
export default function V6Photo({ name }) {
  if (name === 'government-emblem') return <div className="government-scene"><Photo name="parliament-new" className="government-building" /><div className="emblem-seal"><img src={DESK_IMAGES['emblem.svg']} alt="Indian national emblem" loading="lazy" /></div><span className="government-name">GOVERNMENT<br />OF INDIA</span></div>;
  const pairs = {
    'energy-plants': ['nuclear', 'thermal-web', '', 'NUCLEAR · THERMAL'],
    'judicial-books': ['law', 'indian-courtroom', 'court-pair'],
    insolvency: ['legal-files', 'economy', 'insolvency-pair', 'JUSTICE · RESTRUCTURING'],
    'nse-bse': ['nse-mumbai.jpg', 'bse-mumbai.jpg', 'exchange-pair'],
  };
  if (pairs[name]) {
    const [first, second, pairClass, caption] = pairs[name];
    return <><div className={`photo-pair ${pairClass}`}><Photo name={first} className={name === 'judicial-books' ? 'book-photo' : name === 'insolvency' ? 'justice-photo' : 'exchange-nse'} /><Photo name={second} className={name === 'judicial-books' ? 'court-photo' : name === 'insolvency' ? 'finance-photo' : 'exchange-bse'} /></div>{caption && <span className="image-caption">{caption}</span>}{name === 'nse-bse' && <><span className="exchange-label nse">NSE</span><span className="exchange-label bse">BSE</span></>}</>;
  }
  return <><Photo name={name === 'global-trade' ? 'trade' : name} />{name === 'steel-web' && <span className="budget-motion" aria-hidden="true"><span>₹</span><i /><i /><i /></span>}{name === 'global-trade' && <span className="growth-glass" aria-hidden="true"><svg viewBox="0 0 90 40"><path className="growth-grid" d="M3 10h82M3 22h82M3 34h82" /><path className="growth-line" d="M4 33 20 25 34 28 49 16 61 19 82 5" /><circle cx="82" cy="5" r="2" /></svg><span>TRADE &amp; GROWTH</span></span>}</>;
}
