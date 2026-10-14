import LegalDocPage from './LegalDocPage.jsx';
import { PRIVACY_POLICY } from '../lib/legalPolicies.js';

// F108: the published text only; nothing a browser has stored changes it.
const load = () => PRIVACY_POLICY;
const subscribe = () => () => {};

export default function PrivacyPage() {
  return (
    <LegalDocPage
      load={load}
      subscribe={subscribe}
      kicker="POLICY"
      title="Privacy Policy"
      lede="How {org} collects, uses, protects and otherwise processes information when you use the Terminal and related services."
      railKicker="Data protection"
      railTitle="Questions about this policy"
      railCopy="Reach the privacy team with access, correction, or deletion requests."
      railCta="Email privacy team"
      muteKicker="Provenance"
      muteCopy="Third-party records in the Terminal remain subject to the publisher’s terms. Presence in a desk is not a claim that NIYANTRAN collected that information from the person it describes."
      teamFallback="Data Protection / Privacy Team"
    />
  );
}
