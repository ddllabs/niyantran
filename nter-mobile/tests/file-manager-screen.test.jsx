import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import FileManager from '../src/screens/FileManager.jsx';
import { setJSON } from '../src/lib/storage.js';

const mockSetTab = vi.fn();
const mockToast = vi.fn();
const mockPop = vi.fn();
const mockAttach = vi.fn();

vi.mock('../src/state/app.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useApp: () => ({
      tab: 'me',
      setTab: mockSetTab,
      toast: mockToast,
      pop: mockPop,
      push: vi.fn(),
      signedIn: true,
      profile: { name: 'Test Lawyer' },
    }),
  };
});

vi.mock('../src/state/chat.jsx', () => ({
  useChat: () => ({
    attach: mockAttach,
    attachments: [],
  }),
}));

describe('FileManager Screen Component', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setJSON('nter.sample.files', null);
  });

  it('renders header, storage bar, action bar, and filter tabs', async () => {
    render(<FileManager />);

    // Header
    expect(screen.getByText('File Manager')).toBeDefined();

    // Storage card
    await waitFor(() => {
      expect(screen.getByText('STORAGE USAGE')).toBeDefined();
    });

    // Search and upload button
    expect(screen.getByPlaceholderText('Search files…')).toBeDefined();
    expect(screen.getByText('Upload')).toBeDefined();

    // Filter pills
    expect(screen.getByText('All')).toBeDefined();
    expect(screen.getByText('PDF')).toBeDefined();
    expect(screen.getByText('Ready for AI')).toBeDefined();
    expect(screen.getByText('Processing')).toBeDefined();
    expect(screen.getByText('Failed')).toBeDefined();
  });

  it('renders sample file cards with name, status, and actions', async () => {
    render(<FileManager />);

    await waitFor(() => {
      expect(screen.getByText('Q3_Procurement_Contract.pdf')).toBeDefined();
      expect(screen.getByText('Arbitration_Petition_2026.pdf')).toBeDefined();
      expect(screen.getByText('Notice_of_Motion_Draft.pdf')).toBeDefined();
    });

    // Verify Ready for AI badge
    expect(screen.getAllByText('✦ Ready for AI').length).toBeGreaterThan(0);

    // Verify Ask AI button is available for ready files
    const askButtons = screen.getAllByText('Ask AI');
    expect(askButtons.length).toBeGreaterThan(0);
  });

  it('attaches file and navigates to Ask tab when clicking Ask AI', async () => {
    render(<FileManager />);

    await waitFor(() => {
      expect(screen.getByText('Q3_Procurement_Contract.pdf')).toBeDefined();
    });

    const askButtons = screen.getAllByText('Ask AI');
    fireEvent.click(askButtons[0]);

    expect(mockAttach).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'user_file',
        name: expect.any(String),
      })
    );
    expect(mockSetTab).toHaveBeenCalledWith('ask');
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('Attached'));
  });

  it('opens preview modal when clicking Preview button', async () => {
    render(<FileManager />);

    await waitFor(() => {
      expect(screen.getByText('Q3_Procurement_Contract.pdf')).toBeDefined();
    });

    const previewButtons = screen.getAllByText('Preview');
    fireEvent.click(previewButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText(/COMMERCIAL DIVISION|ARBITRATION PETITION/i)).toBeDefined();
    });

    // Close preview
    const closeBtn = screen.getByLabelText('Close Preview');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('filters file list when clicking filter pills', async () => {
    render(<FileManager />);

    await waitFor(() => {
      expect(screen.getByText('Q3_Procurement_Contract.pdf')).toBeDefined();
      expect(screen.getByText('Annual_Financial_Report_2025.xlsx')).toBeDefined();
    });

    // Click PDF filter
    const pdfFilterBtn = screen.getByText('PDF').closest('button');
    fireEvent.click(pdfFilterBtn);

    // XLSX should be filtered out
    expect(screen.queryByText('Annual_Financial_Report_2025.xlsx')).toBeNull();
    // PDF should remain
    expect(screen.getByText('Q3_Procurement_Contract.pdf')).toBeDefined();
  });

  it('filters file list by search input', async () => {
    render(<FileManager />);

    await waitFor(() => {
      expect(screen.getByText('Q3_Procurement_Contract.pdf')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText('Search files…');
    fireEvent.change(searchInput, { target: { value: 'Arbitration' } });

    await waitFor(() => {
      expect(screen.getByText('Arbitration_Petition_2026.pdf')).toBeDefined();
      expect(screen.queryByText('Q3_Procurement_Contract.pdf')).toBeNull();
    });
  });
});
