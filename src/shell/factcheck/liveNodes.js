// Test support: every element of a markup string that is a live region of any kind (aria-live polite or
// assertive, role status, role alert). A node that has two of those attributes counts once.
export const liveNodes = (html) => html.match(/<[a-z0-9]+\b[^>]*(?:aria-live="(?:polite|assertive)"|role="(?:status|alert)")[^>]*>/g) ?? [];
