/**
 * MLA Directory's 31 states and union territories (the register in backup/STATE/F30_MLA_Directory.xlsx),
 * by the register's own names, each followed by the register's state code and the other spellings a
 * request may use. One list for both sides: server/feedSchedule.mjs reads it to name the store variants
 * and to resolve a request's `state`, and the State picker on MLA Directory (src/desks/MlaStatePicker.jsx)
 * offers the names. Plain data, so the browser bundle takes no server code.
 */
export const MLA_STATE_NAMES = Object.freeze([
  ['Andhra Pradesh', 'AP'], ['Arunachal Pradesh', 'AR'], ['Assam', 'AS'], ['Bihar', 'BR'],
  ['Chhattisgarh', 'CG', 'CT', 'Chattisgarh'], ['Delhi', 'DL', 'NCT of Delhi', 'National Capital Territory of Delhi'],
  ['Goa', 'GA'], ['Gujarat', 'GJ'], ['Haryana', 'HR'], ['Himachal Pradesh', 'HP'], ['Jammu & Kashmir', 'JK'],
  ['Jharkhand', 'JH'], ['Karnataka', 'KA'], ['Kerala', 'KL'], ['Madhya Pradesh', 'MP'], ['Maharashtra', 'MH'],
  ['Manipur', 'MN'], ['Meghalaya', 'ML'], ['Mizoram', 'MZ'], ['Nagaland', 'NL'], ['Odisha', 'OD', 'OR', 'Orissa'],
  ['Puducherry', 'PY', 'Pondicherry'], ['Punjab', 'PB'], ['Rajasthan', 'RJ'], ['Sikkim', 'SK'], ['Tamil Nadu', 'TN'],
  ['Telangana', 'TG', 'TS'], ['Tripura', 'TR'], ['Uttar Pradesh', 'UP'], ['Uttarakhand', 'UK', 'UT', 'Uttaranchal'],
  ['West Bengal', 'WB'],
].map((entry) => Object.freeze(entry)));

/** The states' names, in the register's order: the store variants and the picker's options. */
export const MLA_STATES = Object.freeze(MLA_STATE_NAMES.map(([name]) => name));

/** Whether a desk is MLA Directory (the only module with a State picker), by tier and feature name. */
export function isMlaDirectory(tier, feature) {
  return tier === 'state' && String(feature ?? '').trim().toLowerCase() === 'mla directory';
}
