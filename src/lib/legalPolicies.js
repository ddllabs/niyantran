// Published policy text for the public site (Privacy, Terms, Refunds, Delivery,
// About, Contact). Facts come from the owner's decisions and the code's data
// flows (docs/research/2026-10-12-personal-data-inventory.md). Not legal advice;
// pending review by an Indian lawyer (open-work F107).

export const COMPANY = {
  legalName: 'Niyantran Strategy Consulting Private Limited',
  brand: 'NIYANTRAN TERMINAL',
  address: 'Kolkata, West Bengal, India',
  email: 'niyantranai@gmail.com',
  phone: '+91 80134 25401',
  grievanceOfficer: 'Tamanesh Kauri',
  hours: 'Monday to Saturday, 10:00 to 18:00 IST, except public holidays',
};

const LAST_UPDATED = '12 October 2026';

const contactBody = `Grievance Officer and contact person: ${COMPANY.grievanceOfficer}

- Email: [${COMPANY.email}](mailto:${COMPANY.email})
- Phone: ${COMPANY.phone}
- Address: ${COMPANY.legalName}, ${COMPANY.address}
- Hours: ${COMPANY.hours}

We acknowledge every complaint within 48 hours and resolve it within one month of receipt.`;

const doc = (team, sections) => ({
  lastUpdated: LAST_UPDATED,
  org: COMPANY.legalName,
  team,
  email: COMPANY.email,
  website: '',
  address: COMPANY.address,
  sections: sections.map(([id, title, body], i) => ({ id, num: String(i + 1), title, body })),
});

export const PRIVACY_POLICY = doc('Grievance Officer: Tamanesh Kauri', [
  ['intro', 'Who we are', `${COMPANY.brand} (the "Terminal") is operated by ${COMPANY.legalName}, ${COMPANY.address} ("we", "us"). We decide why and how your personal data is processed when you use the Terminal and its website.

This Privacy Policy explains what personal data we collect, why, who we share it with, how long we keep it and how you can exercise your rights. It is a separate document from our [Terms of Service](/#/terms). It is written to meet the Information Technology Act, 2000 and its Reasonable Security Practices and Sensitive Personal Data or Information Rules, 2011, and to be ready for the Digital Personal Data Protection Act, 2023 and its Rules.`],
  ['collect', 'Personal data we collect', `### Account details
- Name and email address, and your password when you sign up with email. Passwords are handled by our authentication provider and stored only in hashed form; we never see them.
- If you sign in with Google: the name, email address and profile picture Google shares with us.
- Your chosen persona (for example Policy Analyst), language, and answers to the optional persona questions.

### Use of the AI research assistant
- The questions you ask, the text of any files you attach (files are read in your browser and only their text is sent), the answers, cited sources and the model used.
- Usage records for each answer: tokens processed and cost, used for credits, billing and security.

### Voice input
- If you dictate a question, the recording is sent for transcription and the text returned to you. We do not store the recording.

### Payments
- Name, email, plan, amount and the payment and order references from our payment provider. Card, UPI and bank details are entered on the payment provider's page and are not received or stored by us.

### Product usage
- Events such as opening a desk or finishing a tour, with a random session identifier and, when you are signed in, your account identifier. We do not store your IP address with these events. To prevent abuse we keep a one-way, keyed hash of the network address for one hour.

### Technical data
- Our hosting providers record standard server logs (such as IP address, browser and time of request) to run and secure the service.

### On your device
- The Terminal keeps your sign-in session and preferences (such as layout and recent views) in your browser's local storage. We do not use advertising or tracking cookies.`],
  ['purposes', 'Why we use it', `- To create and run your account and keep you signed in.
- To answer your research questions, find and cite sources, and keep your conversation history.
- To transcribe voice input.
- To process payments, apply your plan and account for AI credits.
- To secure the service, prevent abuse and enforce our Terms.
- To understand, in aggregate, which features are used and improve them.
- To send service messages such as email verification and important changes.
- To comply with law and respond to lawful requests.

We do not sell personal data and we do not show advertising. We do not use your questions, attachments or answers to train AI models, including our own Niyantran AI model, unless you separately agree to it.`],
  ['consent', 'Consent and withdrawal', `By creating an account you consent to the processing described here for the purposes above. You can withdraw consent at any time by asking us to close your account (see "Your rights"). Withdrawal does not affect processing already carried out, and we may keep records the law requires us to keep. Without the data needed to run an account, we cannot provide the Terminal to you.`],
  ['sharing', 'Who we share it with', `We share personal data only with service providers that process it for us under contract, and only as needed:

- Supabase: accounts, authentication, database and file storage, on servers in Mumbai, India. It also sends our account emails.
- OpenRouter and the AI model providers it routes to: your question, relevant recent conversation, attached text and the cited source passages, to generate an answer, and voice recordings for transcription. These providers may process data outside India.
- OpenRouter's web search, run by Exa: when web search is on for a question, the AI model writes a search query from your question and the conversation's material, such as the record in view or attached text, and Exa receives that search query to find public web pages. Exa receives the query, not your name, email address or account.
- Razorpay: payment processing.
- Vercel: hosting of the website and its application programming interface.
- Google: sign-in with Google, and web fonts loaded by the site.
- Content you choose to open from third parties, such as embedded videos or map tiles, is loaded from those providers, which receive your browser's network address.

We may disclose personal data where the law requires it, to protect our rights or users' safety, or as part of a merger or sale of the business with equivalent protection.`],
  ['transfers', 'Processing outside India', `Some providers above, including AI model providers, web search and hosting, may process data outside India. We use them only as needed to provide the service and subject to contractual safeguards, and we will follow any restrictions the Government of India notifies under the Digital Personal Data Protection Act, 2023.`],
  ['retention', 'How long we keep it', `- Account and profile data: while your account is open.
- Conversations: until you delete them or close your account. Usage records (model, tokens, cost) are kept for billing and security.
- Product usage events: 180 days. Abuse-prevention hashes: one hour.
- Payment and invoice records: as long as tax and company law require.
- Logs and records needed for security and legal compliance: at least one year, or longer where the law requires.

When data is no longer needed, we delete or anonymise it.`],
  ['security', 'How we protect it', `We use encryption in transit, row-level access controls so each user can reach only their own records, hashed passwords, short-lived signed links for stored documents, server-side keys, rate limits and restricted administrator access. No system is perfectly secure; if a personal data breach affects you, we will inform you and the authorities as the law requires.`],
  ['rights', 'Your rights', `You can ask us to:

- tell you what personal data we hold about you and how we use it;
- correct, complete or update it;
- delete it and close your account;
- withdraw your consent;
- name another person to exercise these rights if you die or cannot act yourself.

Write from your registered email address to the Grievance Officer below. We may ask you to confirm your identity. We respond within one month. If you are not satisfied, you may complain to the Data Protection Board of India once it is available to you.`],
  ['children', 'Children', `The Terminal is for people aged 18 and over. We do not knowingly collect personal data of anyone under 18; if we learn we have, we delete it.`],
  ['public', 'Public records in the Terminal', `The desks show information from public government and other published sources, which can include names and details of public figures (for example election candidates). We do not collect this information from you; it remains subject to its publisher's terms. To raise a concern about such information, contact the Grievance Officer.`],
  ['changes', 'Changes to this policy', `We may update this policy. We will post the new version here with its date and, for material changes, notify you by email or in the Terminal.`],
  ['contact', 'Grievance Officer and contact', contactBody],
]);
// Web search (F130) added the search provider to "Who we share it with" on this date.
PRIVACY_POLICY.lastUpdated = '13 October 2026';


export const TERMS_OF_SERVICE = {
  ...doc('Grievance Officer: Tamanesh Kauri', [
    ['intro', 'Agreement', `These Terms of Service govern your use of ${COMPANY.brand} (the "Terminal"), its website and related services, operated by ${COMPANY.legalName}, ${COMPANY.address} ("we", "us"). By creating an account or using the Terminal you agree to these Terms and to our [Privacy Policy](/#/privacy). If you use the Terminal for an organisation, you confirm you may bind it.`],
    ['eligibility', 'Eligibility and accounts', `You must be at least 18 and able to enter a binding contract under Indian law. Give accurate information, keep your credentials secure and do not share your account. One account is allowed per email address. You are responsible for activity on your account; tell us promptly about any unauthorised use.`],
    ['service', 'The service', `The Terminal organises information from public government, legislative, economic and other published sources into desks, and offers an AI research assistant that answers questions with citations to those sources. All desks are available to signed-in users. We may add, change or remove features; we will give notice of changes that materially reduce a paid plan.`],
    ['plans', 'Plans, credits and billing', `- Plans: Free (₹0), Plus (₹399 per month), Pro (₹999 per month) and Max (₹9,999 per month). Current plan details are on the [Pricing](/#/pricing) page.
- What plans include: paid plans differ in AI credits and, when personal file storage is introduced, storage. Credits are consumed according to the AI processing (tokens) your requests use. How many credits each plan includes and how consumption is counted are published on the Pricing page; we may change them for future billing months with notice.
- Niyantran AI: our in-house model will be available only on Pro and Max plans once released. Other models use credits on every plan.
- Unused credits remain available on your account while it is open. Credits have no cash value and cannot be transferred.
- Billing: paid plans are billed monthly in advance in Indian rupees through Razorpay. If you choose automatic renewal, your plan renews each month until you cancel, and you are notified before each renewal charge as Reserve Bank of India rules require. Without automatic renewal, your plan ends at the end of the paid month unless you pay again.
- Taxes: we are not registered under GST, so no GST is charged; the price shown is the price you pay.
- Failed payments: if a renewal payment fails, your account moves to the Free plan.`],
    ['cancel', 'Cancellation and refunds', `You can cancel a paid plan at any time; it stays active until the end of the current billing month and then moves to Free. Payments are non-refundable except as set out in our [Refund & Cancellation Policy](/#/refunds).`],
    ['use', 'Acceptable use', `Do not:

- break the law or infringe anyone's rights;
- scrape, bulk-download or resell data, or access the Terminal by automated means except as we allow;
- attempt to bypass security, credit limits or plan restrictions, or reverse engineer the service;
- upload malware, or content you have no right to share, including other people's sensitive personal data without a lawful basis;
- use the AI assistant to create unlawful, defamatory, or deceptive content, or to impersonate others.`],
    ['ai', 'AI answers', `AI answers are generated automatically and can be incomplete or wrong. Check important points against the cited sources. Answers and desk data are information only and are not legal, financial, investment or other professional advice. You are responsible for how you use them.`],
    ['data', 'Sources and data', `Desk data and documents come from public and published sources and remain subject to their publishers' terms. We work to keep provenance visible but do not guarantee that any source is complete, current or accurate.`],
    ['content', 'Your content', `You keep your rights in the questions and files you submit. You allow us to process them only to provide the service as described in the Privacy Policy. You confirm you have the right to submit them.`],
    ['ip', 'Our rights', `The Terminal's software, design, compilations, analysis and branding belong to us or our licensors. We grant you a limited, personal, non-transferable right to use the Terminal under these Terms.`],
    ['third', 'Third-party services', `Payments, sign-in with Google and AI models are provided by third parties whose terms also apply to their parts of the service.`],
    ['availability', 'Availability', `We aim for a reliable service but do not guarantee it will be uninterrupted or error-free. We may suspend it for maintenance, security or reasons beyond our control.`],
    ['termination', 'Suspension and closure', `You can close your account at any time by writing to us. We may suspend or close accounts that break these Terms or the law, with notice where reasonable. On closure your access ends, unused credits lapse, and your data is handled as the Privacy Policy describes.`],
    ['disclaimer', 'Disclaimer', `To the extent the law allows, the Terminal is provided "as is" without warranties of any kind, express or implied.`],
    ['liability', 'Limitation of liability', `To the extent the law allows, we are not liable for indirect, incidental or consequential loss, or for loss of profits, data or goodwill. Our total liability for any claim is limited to the amount you paid us in the three months before the claim arose.`],
    ['indemnity', 'Indemnity', `You will compensate us for claims and losses arising from your breach of these Terms or misuse of the Terminal.`],
    ['law', 'Governing law and disputes', `These Terms are governed by the laws of India. Courts at Kolkata, West Bengal have exclusive jurisdiction, subject to any consumer forum you are entitled to use by law.`],
    ['changes', 'Changes to these Terms', `We may update these Terms. We will post the new version here with its date and, for material changes, notify you before they apply. Continuing to use the Terminal after that means you accept them.`],
    ['general', 'General', `If any part of these Terms is unenforceable, the rest remains in force. These Terms and the documents they refer to are the whole agreement between you and us about the Terminal. Not enforcing a right is not a waiver.`],
    ['contact', 'Grievance Officer and contact', contactBody],
  ]),
  jurisdiction: 'Laws of India',
  courts: 'Courts at Kolkata, West Bengal',
};

export const REFUND_POLICY = doc('Grievance Officer: Tamanesh Kauri', [
  ['overview', 'Overview', `This policy explains cancellations and refunds for paid plans of ${COMPANY.brand}, operated by ${COMPANY.legalName}. It forms part of our [Terms of Service](/#/terms).`],
  ['cancel', 'Cancelling a plan', `You can cancel a paid plan at any time by writing to us from your registered email address, and through your account once that option is available. There is no cancellation charge. Your plan stays active until the end of the current billing month and then moves to the Free plan; no further charges are made. Cancelling automatic renewal also cancels the payment mandate.`],
  ['refunds', 'Refunds', `Plan fees are non-refundable once a billing month has been charged, including for partly used months and unused credits, because the AI service and credits are made available immediately.`],
  ['exceptions', 'When we do refund', `We refund the full amount, to the original payment method, when:

- you were charged twice for the same plan and month (duplicate charge);
- money was debited but your plan was not activated (failed or incomplete transaction);
- a charge was made without your authorisation and reported to us promptly.

We confirm an eligible refund within 7 working days of your request. Your bank or card issuer may take a further 5 to 7 working days to credit it.`],
  ['credits', 'Unused credits', `Unused credits remain on your account while it is open. They have no cash value and are not refunded.`],
  ['request', 'How to ask', `Email [${COMPANY.email}](mailto:${COMPANY.email}) from your registered email address with the payment reference and a short description. We acknowledge within 48 hours. This policy does not affect any rights you have under Indian consumer law.`],
  ['contact', 'Grievance Officer and contact', contactBody],
]);

export const DELIVERY_POLICY = doc('Grievance Officer: Tamanesh Kauri', [
  ['digital', 'Digital service', `${COMPANY.brand} is an online service operated by ${COMPANY.legalName}. Nothing physical is shipped and there are no shipping charges.`],
  ['activation', 'Delivery', `A paid plan is activated on your account automatically as soon as the payment is confirmed, usually within minutes and at most within 24 hours. You access it by signing in at the Terminal's website from anywhere in India.`],
  ['problems', 'If your plan is not active', `If your plan is not active within 24 hours of a successful payment, contact us with the payment reference. If we cannot activate it, we refund the payment as described in our [Refund & Cancellation Policy](/#/refunds).`],
  ['contact', 'Grievance Officer and contact', contactBody],
]);

export const ABOUT_PAGE = doc('Grievance Officer: Tamanesh Kauri', [
  ['who', 'Who we are', `${COMPANY.brand} is operated by ${COMPANY.legalName}, a private limited company based in ${COMPANY.address}.`],
  ['what', 'What the Terminal does', `The Terminal brings public government, legislative, legal, economic and global-affairs records into eight desks, and adds an AI research assistant that answers questions with citations to the underlying documents, so the source is always in view.`],
  ['plans', 'Plans', `Desks are available to every signed-in user. Paid plans add AI credits; see [Pricing](/#/pricing).`],
  ['contact', 'Contact', contactBody],
]);

export const CONTACT_PAGE = doc('Grievance Officer: Tamanesh Kauri', [
  ['company', 'Company', `${COMPANY.brand} is operated by ${COMPANY.legalName}, ${COMPANY.address}.`],
  ['support', 'Support and billing', `For account, billing or technical questions, email [${COMPANY.email}](mailto:${COMPANY.email}) or call ${COMPANY.phone} during ${COMPANY.hours}.`],
  ['contact', 'Grievance Officer', contactBody],
]);
