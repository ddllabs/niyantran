import { useId } from 'react';
import './nationalLandingArtwork.css';

// Decorative, static SVG: the scene survives reduced motion and unavailable data.
export default function NationalLandingArtwork({ scene = 'parliament' }) {
  const id = useId().replace(/:/g, '');
  if (scene === 'parliament') return <svg className="nl-parliament" viewBox="0 0 1600 800" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-sky`} x2="0" y2="1"><stop stopColor="#e0e8f7"/><stop offset="1" stopColor="#faf1df"/></linearGradient>
      <linearGradient id={`${id}-stone`}><stop stopColor="#fbf5e8"/><stop offset="1" stopColor="#cfbea1"/></linearGradient>
    </defs>
    <rect width="1600" height="800" fill={`url(#${id}-sky)`}/>
    <g fill="#fff" opacity=".6"><ellipse cx="520" cy="240" rx="150" ry="26"/><ellipse cx="1230" cy="140" rx="170" ry="30"/></g>
    <path d="M0 720 Q800 650 1600 720 V800 H0Z" fill="#dce3d2"/>
    <g transform="translate(220 -80)">
      <path d="M682 400 A118 60 0 0 1 918 400Z" fill={`url(#${id}-stone)`}/>
      <path d="M690 400 H910 V470 H690Z" fill="#ece2cf"/>
      <rect x="797" y="314" width="6" height="36" fill="#cfbea1"/><circle cx="800" cy="312" r="6" fill="#cfbea1"/>
      {Array.from({ length: 13 }, (_, i) => <rect key={i} x={704 + i * 15} y="418" width="5" height="24" fill="#c7b695"/>)}
      <path d="M440 492 Q800 446 1160 492 V540 Q800 495 440 540Z" fill="#dfd1b7"/>
      <path d="M320 548 Q800 484 1280 548 V710 Q800 680 320 710Z" fill="#d0bd9e"/>
      {Array.from({ length: 40 }, (_, i) => {
        const a = (-84 + i * 168 / 39) * Math.PI / 180;
        const x = 800 + 470 * Math.sin(a), width = 12 * Math.max(.34, Math.cos(a));
        return <g key={i}><rect x={x - width / 2} y="548" width={width} height="150" fill={`url(#${id}-stone)`}/><rect x={x - width / 2 - 2} y="545" width={width + 4} height="7" fill="#f5eddd"/></g>;
      })}
      <path d="M312 526 Q800 460 1288 526 V548 Q800 488 312 548Z" fill="#f4eada"/>
      <path d="M310 700 Q800 670 1290 700 V716 Q800 686 310 716Z" fill="#e8dcc6"/>
      <path d="M710 706 H890 V718 H710Z M695 718 H905 V730 H695Z M680 730 H920 V742 H680Z" fill="#cdbd9f"/>
    </g>
    <g fill="#aabc99" opacity=".9"><ellipse cx="640" cy="670" rx="70" ry="50"/><ellipse cx="1400" cy="662" rx="90" ry="58"/></g>
  </svg>;
  return <svg className={`nl-tile nl-tile-${scene}`} viewBox="0 0 240 110" aria-hidden="true" focusable="false">
    <rect width="240" height="110" fill="currentColor"/>
    <g transform="translate(126 8)" fill="#15366e" opacity=".85">
      {scene === 'chamber' && <g fill="none" stroke="#15366e" strokeWidth="9"><path d="M-18 90 A62 62 0 0 1 106 90 M0 90 A44 44 0 0 1 88 90 M18 90 A26 26 0 0 1 70 90"/><path d="M32 78 H56"/></g>}
      {scene === 'ballot' && <><rect x="0" y="49" width="84" height="44" rx="7"/><path d="M-6 49 L10 33 H73 L91 49Z"/><rect x="35" y="3" width="30" height="38" rx="3" fill="#fff" transform="rotate(12 50 22)"/><path d="M42 22 L49 28 L60 15" fill="none" stroke="#15366e" strokeWidth="3"/></>}
      {scene === 'microphones' && <g stroke="#15366e" strokeWidth="4"><rect x="12" y="15" width="18" height="38" rx="9"/><path d="M6 37 V47 Q21 68 36 47 V37 M21 63 V91 M61 63 V91" fill="none"/><rect x="52" y="24" width="18" height="34" rx="9"/><path d="M44 42 V52 Q61 73 78 52 V42" fill="none"/></g>}
      {scene === 'secretariat' && <><circle cx="86" cy="28" r="19" fill="#fff"/><path d="M-10 98 V59 H95 V98Z M16 59 V44 H67 V59Z M27 44 A15 15 0 0 1 57 44Z"/><g fill="#fff"><rect x="3" y="70" width="9" height="17"/><rect x="23" y="70" width="9" height="17"/><rect x="57" y="70" width="9" height="17"/><rect x="77" y="70" width="9" height="17"/></g></>}
      {scene === 'economy' && <><rect x="0" y="62" width="20" height="35" rx="4"/><rect x="30" y="43" width="20" height="54" rx="4"/><rect x="60" y="70" width="20" height="27" rx="4"/><path d="M-5 51 L24 30 L48 39 L80 10 L102 3" fill="none" stroke="#fff" strokeWidth="4"/></>}
    </g>
  </svg>;
}
