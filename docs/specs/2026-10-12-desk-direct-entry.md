# Direct desk entry and AI dismissal

> **2026-10-13 owner amendment (F119):** picture cards no longer open a
> module. A card selects its sector, and the module cards below it open the
> terminal. The AI-dismissal half of this spec is unchanged. See
> [sector cards select](2026-10-13-sector-cards-select.md).

> **Status: Normative.** Owner-approved local UI work, 2026-10-12.

Current picture cards select sectors, then modules open coverage dialogs before navigation. An open AI dock survives landing navigation and shrinks the landing.

Each of the 35 picture cards must link directly to its explicitly approved canonical default module. Preserve native link behavior and existing entitlements. Remove the intermediary module picker; retain measured charts and coverage counts. All 120 modules must remain accessible in matching internal sector menus. Defaults follow the owner's approved recommendation, including the documented coverage limitations; do not imply new data capabilities.

Completed pointer clicks outside an open AI panel dismiss it, including expanded mode. Inside clicks, resize drags and modal interactions must not dismiss it. Landing navigation dismisses AI and expansion, while retaining mounted chat, draft and attachments. Normal module navigation preserves AI unless an outside click dismisses it. Desk/Record behavior otherwise stays unchanged.

Evidence: regression tests must fail on the old behavior; test all 35 canonical destinations and 120 menu memberships; browser checks cover direct card handoffs, docked/expanded outside clicks, inside clicks, landing return and preserved chat. Run lint, focused/full Vitest, build and reference asset check.

Exclude corpus work, backend/data changes, authentication/billing changes, push and deployment. Shared tracker edits are limited to F93/F95.
