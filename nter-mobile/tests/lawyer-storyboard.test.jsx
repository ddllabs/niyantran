import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import LawyerProfile from '../src/screens/LawyerProfile.jsx';
import { docFromLawyerTemplate } from '../src/lib/studioDoc.js';
import * as sample from '../src/services/sample.js';
import { newTurn, applyFrame } from '../src/services/chatState.js';

const mockUpdateLawyerProfile = vi.fn();
const mockSetStage = vi.fn();
const mockSetTab = vi.fn();

vi.mock('../src/state/app.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useApp: () => ({
      lawyerProfile: {
        name: 'Arjun Kapoor',
        practiceArea: 'Civil & commercial',
        jurisdiction: 'India',
        practiceTags: ['Litigation', 'Advisory'],
        language: 'English',
      },
      updateLawyerProfile: mockUpdateLawyerProfile,
      setStage: mockSetStage,
      setTab: mockSetTab,
      profile: { name: 'Arjun Kapoor' },
      session: null,
    }),
  };
});

describe('LawyerProfile Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default 3 of 3 stepper and lawyer badge card with avatar and details', () => {
    const { container } = render(<LawyerProfile />);

    // Stepper verification
    const stepper = container.querySelector('.stepper-k');
    expect(stepper).not.toBeNull();
    expect(stepper.textContent).toContain('YOUR WORKING PROFILE · 3 OF 3');

    // Badge card verification
    const badge = container.querySelector('.lawyer-badge-card');
    expect(badge).not.toBeNull();
    const avatar = badge.querySelector('.lawyer-avatar');
    expect(avatar.textContent).toBe('AK');
    const name = badge.querySelector('.lawyer-name');
    expect(name.textContent).toBe('Arjun Kapoor');
    const desc = badge.querySelector('.lawyer-desc');
    expect(desc.textContent).toContain('Civil & commercial');
    expect(desc.textContent).toContain('India');
  });

  it('renders custom step in stepper (e.g. 2 of 3)', () => {
    const { container } = render(<LawyerProfile step={2} total={3} />);
    const stepper = container.querySelector('.stepper-k');
    expect(stepper.textContent).toContain('YOUR WORKING PROFILE · 2 OF 3');
  });

  it('allows selecting practice area and jurisdiction and updates badge card', () => {
    const { container } = render(<LawyerProfile />);

    const practiceSelect = screen.getByLabelText('Primary practice');
    fireEvent.change(practiceSelect, { target: { value: 'Corporate & M&A' } });
    expect(practiceSelect.value).toBe('Corporate & M&A');

    const jurisdictionSelect = screen.getByLabelText('Jurisdiction');
    fireEvent.change(jurisdictionSelect, { target: { value: 'Supreme Court of India' } });
    expect(jurisdictionSelect.value).toBe('Supreme Court of India');

    const desc = container.querySelector('.lawyer-desc');
    expect(desc.textContent).toContain('Corporate & M&A');
    expect(desc.textContent).toContain('Supreme Court of India');
  });

  it('toggles practice tags when clicked', () => {
    render(<LawyerProfile />);

    // Litigation is on by default in default tags ['Litigation', 'Advisory']
    const litButton = screen.getByRole('button', { name: 'Litigation' });
    expect(litButton.className).toContain('on');
    expect(litButton.getAttribute('aria-pressed')).toBe('true');

    // Toggle off
    fireEvent.click(litButton);
    expect(litButton.className).not.toContain('on');
    expect(litButton.getAttribute('aria-pressed')).toBe('false');

    // Toggle on again
    fireEvent.click(litButton);
    expect(litButton.className).toContain('on');
    expect(litButton.getAttribute('aria-pressed')).toBe('true');

    // Corporate tag is off by default, toggle on
    const corpButton = screen.getByRole('button', { name: 'Corporate' });
    expect(corpButton.className).not.toContain('on');
    fireEvent.click(corpButton);
    expect(corpButton.className).toContain('on');
  });

  it('triggers onSave callback with updated profile data when clicking "Continue to Chat →"', () => {
    const onSave = vi.fn();
    const onDone = vi.fn();

    render(<LawyerProfile onSave={onSave} onDone={onDone} />);

    const continueBtn = screen.getByRole('button', { name: 'Continue to Chat →' });
    fireEvent.click(continueBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Arjun Kapoor',
        practiceArea: 'Civil & commercial',
        jurisdiction: 'India',
        language: 'English',
      })
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('triggers navigation to chat when clicking "Continue to Chat →" without onSave or onDone', () => {
    render(<LawyerProfile />);

    const continueBtn = screen.getByRole('button', { name: 'Continue to Chat →' });
    fireEvent.click(continueBtn);

    expect(mockUpdateLawyerProfile).toHaveBeenCalledTimes(1);
    expect(mockSetTab).toHaveBeenCalledWith('ask');
    expect(mockSetStage).toHaveBeenCalledWith('app');
  });
});

describe('docFromLawyerTemplate in studioDoc.js', () => {
  it('creates case_law_note with authorities, propositions, pinpoints, and 2 verification alerts', () => {
    const doc = docFromLawyerTemplate('case_law_note', {
      question: 'Termination after delayed performance in public procurement',
    });

    expect(doc.kind).toBe('lawyer_template');
    expect(doc.unverifiedItems).toBe(2);

    const authBlock = doc.blocks.find((b) => b.lab === 'AUTHORITIES & PROPOSITIONS');
    expect(authBlock).toBeDefined();
    // Authorities
    expect(authBlock.html).toContain('Authority 01 · Supreme Court order');
    expect(authBlock.html).toContain('Authority 02 · High Court order');
    expect(authBlock.html).toContain('Authority 03 · Tribunal decision');
    // Propositions
    expect(authBlock.html).toContain('Proposition:</b> A cure notice must identify the breach');
    expect(authBlock.html).toContain('Proposition:</b> Termination may be disproportionate');
    expect(authBlock.html).toContain('Proposition:</b> Commercial contracts permit liquidated damages');
    // Pinpoints
    expect(authBlock.html).toContain('Pinpoint:</b> ¶ 42');
    expect(authBlock.html).toContain('Pinpoint:</b> ¶¶ 18–21');
    expect(authBlock.html).toContain('Pinpoint:</b> <i>Pinpoint unavailable</i>');

    // 2 Verification alerts: unverifiedItems is 2, plus warning in auth 03 and gap alert block
    expect(authBlock.html).toContain('stg warn');
    expect(authBlock.html).toContain('Needs verification');
    const gapBlock = doc.blocks.find((b) => b.lab === 'VERIFICATION & GAP ALERTS');
    expect(gapBlock).toBeDefined();
    expect(gapBlock.html).toContain('[NEEDS VERIFICATION');
  });

  it('creates legal_notice verifying facts, grounds, and demand clauses', () => {
    const doc = docFromLawyerTemplate('legal_notice', {
      question: 'Contract default and improper termination notice',
    });

    expect(doc.kind).toBe('lawyer_template');
    expect(doc.name).toBe('Legal notice');

    // Facts
    const factsBlock = doc.blocks.find((b) => b.lab === 'STATEMENT OF FACTS');
    expect(factsBlock).toBeDefined();
    expect(factsBlock.lab).toBe('STATEMENT OF FACTS');
    expect(factsBlock.html).toContain('awarded contract');
    expect(factsBlock.html).toContain('notice of termination');

    // Grounds
    const groundsBlock = doc.blocks.find((b) => b.lab === 'GROUNDS & VIOLATIONS');
    expect(groundsBlock).toBeDefined();
    expect(groundsBlock.lab).toBe('GROUNDS & VIOLATIONS');
    expect(groundsBlock.html).toContain('Breach of Natural Justice');
    expect(groundsBlock.html).toContain('Proportionality');

    // Demand
    const demandBlock = doc.blocks.find((b) => b.lab === 'DEMAND & REQUISITION');
    expect(demandBlock).toBeDefined();
    expect(demandBlock.lab).toBe('DEMAND & REQUISITION');
    expect(demandBlock.html).toContain('called upon to withdraw the termination notice within <b>15 (fifteen) days</b>');
  });

  it('creates case_brief verifying issues and holding', () => {
    const doc = docFromLawyerTemplate('case_brief', {
      question: 'Validity of summary termination under Article 14',
    });

    expect(doc.kind).toBe('lawyer_template');
    expect(doc.name).toBe('Case brief');

    // Issues
    const issueBlock = doc.blocks.find((b) => b.lab === 'QUESTION PRESENTED & ISSUE');
    expect(issueBlock).toBeDefined();
    expect(issueBlock.html).toContain('Whether termination of a public procurement contract for delay is legally sustainable');

    // Holding
    const holdingBlock = doc.blocks.find((b) => b.lab === 'HOLDING & RATIO');
    expect(holdingBlock).toBeDefined();
    expect(holdingBlock.html).toContain('The right of termination in state contracts is conditioned by Article 14 fairness');
  });

  it('creates written_submissions verifying submission arguments', () => {
    const doc = docFromLawyerTemplate('written_submissions', {
      question: 'Submissions against arbitrary contract termination',
    });

    expect(doc.kind).toBe('lawyer_template');
    expect(doc.name).toBe('Written submissions');

    // Submission arguments
    const issue1 = doc.blocks.find((b) => b.lab.includes('ISSUE I'));
    expect(issue1).toBeDefined();
    expect(issue1.lab).toContain('INVALIDITY OF SUMMARY TERMINATION');
    expect(issue1.html).toContain('mandatory 30-day cure notification');

    const issue2 = doc.blocks.find((b) => b.lab.includes('ISSUE II'));
    expect(issue2).toBeDefined();
    expect(issue2.lab).toContain('PROPORTIONALITY & CONTRIBUTORY DELAY');
    expect(issue2.html).toContain('authority cannot take advantage of its own wrong');

    const prayer = doc.blocks.find((b) => b.lab === 'PRAYER & RELIEF');
    expect(prayer).toBeDefined();
    expect(prayer.html).toContain('order of termination be set aside');
  });

  it('creates chronology_of_facts verifying dated table/events', () => {
    const doc = docFromLawyerTemplate('chronology_of_facts', {
      question: 'Chronology of tender events and delays',
    });

    expect(doc.kind).toBe('lawyer_template');
    expect(doc.name).toBe('Chronology of facts');

    // Dated table/events
    const seqBlock = doc.blocks.find((b) => b.lab === 'DATED SEQUENCE OF EVENTS');
    expect(seqBlock).toBeDefined();
    expect(seqBlock.html).toContain('12 Jan 2024:');
    expect(seqBlock.html).toContain('Tender notice issued');
    expect(seqBlock.html).toContain('05 Mar 2024:');
    expect(seqBlock.html).toContain('Letter of Award');
    expect(seqBlock.html).toContain('18 Apr 2024:');
    expect(seqBlock.html).toContain('10 Nov 2024:');
    expect(seqBlock.html).toContain('19 Nov 2024:');
    expect(seqBlock.html).toContain('Impugned termination order');
  });
});

describe('Evidence telemetry & authorities in sample.js and chatState.js', () => {
  it('updates chat turn state with evidence telemetry and authorities array via applyFrame', () => {
    let turn = newTurn({ question: 'What are the legal authorities on termination?' });

    const evidenceFrame = {
      evidence: {
        recordsSearched: 23,
        searchedRecords: 23,
        sourcesOpened: 9,
        citationsFound: 7,
      },
    };
    const authoritiesFrame = {
      authorities: [
        {
          id: 'auth-1',
          name: 'Authority 01 · Supreme Court order',
          court: 'Supreme Court of India',
          proposition: 'Notice and opportunity to cure · pinpoint ¶ 42',
          pinpoint: '¶ 42',
          verified: true,
        },
        {
          id: 'auth-2',
          name: 'Authority 02 · High Court order',
          court: 'High Court of Delhi',
          proposition: 'Delay attributable to the public authority · pinpoint ¶¶ 18–21',
          pinpoint: '¶¶ 18–21',
          verified: true,
        },
      ],
    };

    turn = applyFrame(turn, evidenceFrame);
    expect(turn.evidence).toEqual({
      recordsSearched: 23,
      searchedRecords: 23,
      sourcesOpened: 9,
      citationsFound: 7,
    });
    expect(turn.evidence.searchedRecords).toBe(23);
    expect(turn.evidence.sourcesOpened).toBe(9);
    expect(turn.evidence.citationsFound).toBe(7);

    turn = applyFrame(turn, authoritiesFrame);
    expect(turn.authorities).toHaveLength(2);
    expect(turn.authorities[0].court).toBe('Supreme Court of India');
    expect(turn.authorities[0].pinpoint).toBe('¶ 42');
  });

  it('produces evidence telemetry and authorities array when sample.sendTurn processes legal queries', async () => {
    let turn = newTurn({ question: 'Authorities on contract termination and cure period' });
    const frames = [];

    await sample.sendTurn(
      { message: 'Authorities on contract termination and cure period' },
      {
        onFrame: (f) => {
          frames.push(f);
          turn = applyFrame(turn, f);
        },
      }
    );

    // Verify frames received
    const evidenceFrame = frames.find((f) => f.evidence);
    expect(evidenceFrame).toBeDefined();
    expect(evidenceFrame.evidence.recordsSearched).toBe(23);
    expect(evidenceFrame.evidence.searchedRecords).toBe(23);
    expect(evidenceFrame.evidence.sourcesOpened).toBe(9);
    expect(evidenceFrame.evidence.citationsFound).toBe(7);

    const authoritiesFrame = frames.find((f) => f.authorities);
    expect(authoritiesFrame).toBeDefined();
    expect(authoritiesFrame.authorities).toHaveLength(3);
    expect(authoritiesFrame.authorities[0]).toMatchObject({
      court: 'Supreme Court of India',
      pinpoint: '¶ 42',
      verified: true,
    });
    expect(authoritiesFrame.authorities[1]).toMatchObject({
      court: 'High Court of Delhi',
      pinpoint: '¶¶ 18–21',
      verified: true,
    });
    expect(authoritiesFrame.authorities[2]).toMatchObject({
      court: 'NCLAT Principal Bench',
      pinpoint: null,
      verified: false,
    });

    // Verify accumulated turn state
    expect(turn.status).toBe('complete');
    expect(turn.evidence.searchedRecords).toBe(23);
    expect(turn.evidence.sourcesOpened).toBe(9);
    expect(turn.evidence.citationsFound).toBe(7);
    expect(turn.authorities).toHaveLength(3);
  });
});
