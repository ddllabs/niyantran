import { LockKeyhole } from 'lucide-react';
import './restrictedDeskRoute.css';

export default function RestrictedDeskRoute({ desk, feature, onBack, onAccess, lang = 'en' }) {
  const hi = lang === 'hi';
  return <section className="restricted-desk-route" aria-labelledby="restricted-desk-title">
    <LockKeyhole size={26} aria-hidden="true"/>
    <p className="restricted-desk-label">{desk}</p>
    <h1 id="restricted-desk-title">{hi ? 'पहुँच सीमित है' : 'Access restricted'}</h1>
    {feature && <h2>{feature}</h2>}
    <p>{hi ? 'आपकी वर्तमान योजना में इस डेस्क की पहुँच शामिल नहीं है। अनुरोधित पृष्ठ का पता सुरक्षित है।' : 'Your current plan does not include this desk. Your requested destination is preserved.'}</p>
    <div><button type="button" onClick={onBack}>{hi ? 'वापस जाएँ' : 'Go back'}</button><button type="button" onClick={onAccess}>{hi ? 'पहुँच के विकल्प देखें' : 'View access options'}</button></div>
  </section>;
}
