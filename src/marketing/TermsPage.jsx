import LegalDocPage from './LegalDocPage.jsx';
import { TERMS_OF_SERVICE } from '../lib/legalPolicies.js';

// F108: the published text only; nothing a browser has stored changes it.
const load = () => TERMS_OF_SERVICE;
const subscribe = () => () => {};

export default function TermsPage() {
  return (
    <LegalDocPage
      load={load}
      subscribe={subscribe}
      kicker="TERMS"
      title="Terms & Conditions"
      lede="The agreement that governs access to {org}, including the website, dashboards, APIs, research tools and related services."
      chip="Governs website, dashboards, APIs and research tools"
      railKicker="Legal"
      railTitle="Questions about these Terms"
      railCopy="Contact the legal and compliance team about these Terms, the Services, or a suspected violation."
      railCta="Email legal team"
      muteKicker="No professional advice"
      muteCopy="The Terminal is an information service. Outputs are not legal, financial, investment, or other professional advice unless a separate written agreement says otherwise."
      teamFallback="Legal / Compliance Team"
      showLaw
    />
  );
}
