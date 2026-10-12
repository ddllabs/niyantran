import LegalDocPage from './LegalDocPage.jsx';
import { ABOUT_PAGE, CONTACT_PAGE, DELIVERY_POLICY, REFUND_POLICY } from '../lib/legalPolicies.js';

const fixed = doc => ({ load: () => doc, subscribe: () => () => {} });
const about = fixed(ABOUT_PAGE), contact = fixed(CONTACT_PAGE), refunds = fixed(REFUND_POLICY), delivery = fixed(DELIVERY_POLICY);
const common = {
  railKicker: 'Contact', railTitle: 'Questions?', railCta: 'Email us', teamFallback: 'Grievance Officer',
  muteKicker: 'Operator', muteCopy: 'NIYANTRAN TERMINAL is operated by Niyantran Strategy Consulting Private Limited, Kolkata, West Bengal, India.',
};

export function AboutPage() {
  return <LegalDocPage {...about} {...common} kicker="ABOUT" title="About us" chip="Company and service"
    lede="Who operates {org}'s NIYANTRAN TERMINAL and what it does." railCopy="Reach us about the Terminal, accounts or partnerships." />;
}

export function ContactPage() {
  return <LegalDocPage {...contact} {...common} kicker="CONTACT" title="Contact us" chip="Support, billing and grievances"
    lede="How to reach {org} for support, billing and grievances." railCopy="We acknowledge every message within 48 hours." />;
}

export function RefundPage() {
  return <LegalDocPage {...refunds} {...common} kicker="REFUNDS" title="Refund & Cancellation Policy" chip="Applies to paid plans"
    lede="How cancellations and refunds work for paid plans offered by {org}." railCopy="Send the payment reference with any refund question." />;
}

export function DeliveryPage() {
  return <LegalDocPage {...delivery} {...common} kicker="DELIVERY" title="Shipping & Delivery Policy" chip="Digital service, no shipping"
    lede="How {org} delivers paid plans for NIYANTRAN TERMINAL." railCopy="Tell us if a paid plan is not active within 24 hours." />;
}
