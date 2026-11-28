# NTER Phase 2 — Authentication & Persona Onboarding Verification Report

**Module:** Auth, Onboarding & User Store (`Agent 1`)  
**Status:** ACCEPTED  
**Date:** 2026-11-20  
**Authority:** `terminal-lawyer-mobile-journey.pdf` & `AGENTS.md`  

---

## 1. Executive Summary

Phase 2 verifies the complete user entry, authentication, and persona-based onboarding configuration across mobile, tablet, and desktop viewports. The implementation preserves existing enterprise session integrity while ensuring that new and returning legal professionals are guided through the 3-step onboarding wizard.

---

## 2. Onboarding Flow Architecture

### 2.1 3-Step Wizard Structure (`src/shell/PersonaChooser.jsx`)
1. **Step 1: Persona Selection**
   - Options: Lawyer, Policy Analyst, Student (UPSC/Law), Journalist, Corporate Analyst, Academic Researcher.
   - Distinctive visual card presentation with role blurbs and access entitlements.
   - Persona persistence via `writePersonaId` and `setSessionUser`.
2. **Step 2: Primary Jurisdiction & Institutions**
   - Configures legal grounding indices:
     - Supreme Court of India (`sci`)
     - High Court of Delhi (`dhc`)
     - High Court of Bombay (`bhc`)
     - National Company Law Appellate Tribunal (`nclat`)
     - High Court of Karnataka (`khc`)
3. **Step 3: Core Practice Area**
   - Configures primary research focus:
     - Commercial Litigation & Arbitration (`commercial`)
     - Constitutional & Administrative Law (`constitutional`)
     - Regulatory, Competition & SEBI Compliance (`regulatory`)
     - Criminal Law & Special Statutes (`criminal`)
     - Intellectual Property Rights (`ipr`)

### 2.2 Profile Persistence & Database Contract
- Syncs with Supabase RPC `public.update_my_onboarding_profile`.
- Synchronizes with `niy_session_user` in local storage for instantaneous offline hydration.
- Automatically directs the user to their designated starting desk (`home` or role-specific view).

---

## 3. Verification Evidence

- Verified `PersonaChooser.jsx` step transitions, radio bindings, and progress pill navigation.
- Safe fallback when user is unauthenticated or running in guest mode.
- Non-blocking error handling for RPC calls.
