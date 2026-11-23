import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Model, vendorBadge, vendorTitle, vendorKey } from '../src/sheets/SheetHost.jsx';
import * as sample from '../src/services/sample.js';

const mockSetModelId = vi.fn();
const mockSetEffort = vi.fn();
const mockOpenSheet = vi.fn();
const mockCloseSheet = vi.fn();

const TEST_MODELS = [
  {
    model_id: 'google/gemini-3.8-flash',
    label: 'Gemini - Flash',
    vendor: 'google',
    tier: 2,
    efforts: ['low', 'medium', 'high'],
    is_default: true,
    sort_order: 20,
    min_plan: 'free',
    credits: 8,
  },
  {
    model_id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek - Pro',
    vendor: 'deepseek',
    tier: 2,
    efforts: ['off', 'high', 'xhigh'],
    is_default: false,
    sort_order: 40,
    min_plan: 'free',
    credits: 15,
  },
  {
    model_id: 'anthropic/claude-sonnet-5.5',
    label: 'Claude - Sonnet 5.5',
    vendor: 'anthropic',
    tier: 3,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    is_default: false,
    sort_order: 62,
    min_plan: 'plus',
    credits: 140,
  },
  {
    model_id: 'openai/gpt-6-astra',
    label: 'GPT - Astra',
    vendor: 'openai',
    tier: 3,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    is_default: false,
    sort_order: 50,
    min_plan: 'plus',
    credits: 60,
  },
];

let appState = {
  models: TEST_MODELS,
  plan: 'free',
  credits: { available: 5000 },
  openSheet: mockOpenSheet,
  closeSheet: mockCloseSheet,
  signedIn: true,
  isSample: true,
};

let chatState = {
  model: TEST_MODELS[0],
  modelId: TEST_MODELS[0].model_id,
  setModelId: mockSetModelId,
  efforts: ['low', 'medium', 'high'],
  effort: 'low',
  setEffort: mockSetEffort,
  turns: [{ id: 'turn-1', question: 'Explain section 9' }],
  attachments: [{ key: 'att-1', label: 'Document A' }],
  focus: 'law_orders',
};

vi.mock('../src/state/app.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useApp: () => appState,
  };
});

vi.mock('../src/state/chat.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useChat: () => chatState,
  };
});

describe('OpenRouter & AI Model Selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState = {
      models: TEST_MODELS,
      plan: 'free',
      credits: { available: 5000 },
      openSheet: mockOpenSheet,
      closeSheet: mockCloseSheet,
      signedIn: true,
      isSample: true,
    };
    chatState = {
      model: TEST_MODELS[0],
      modelId: TEST_MODELS[0].model_id,
      setModelId: mockSetModelId,
      efforts: ['low', 'medium', 'high'],
      effort: 'low',
      setEffort: mockSetEffort,
      turns: [{ id: 'turn-1', question: 'Explain section 9' }],
      attachments: [{ key: 'att-1', label: 'Document A' }],
      focus: 'law_orders',
    };
  });

  describe('Vendor helpers', () => {
    it('normalizes vendor keys correctly', () => {
      expect(vendorKey('google')).toBe('google');
      expect(vendorKey('gemini')).toBe('google');
      expect(vendorKey('~openai')).toBe('openai');
      expect(vendorKey('anthropic')).toBe('anthropic');
      expect(vendorKey('deepseek')).toBe('deepseek');
      expect(vendorKey('')).toBe('other');
    });

    it('returns human-readable vendor titles', () => {
      expect(vendorTitle('google')).toBe('Google');
      expect(vendorTitle('deepseek')).toBe('DeepSeek');
      expect(vendorTitle('openai')).toBe('OpenAI');
      expect(vendorTitle('~openai')).toBe('OpenAI');
      expect(vendorTitle('anthropic')).toBe('Anthropic');
    });

    it('returns distinctive vendor badge text', () => {
      expect(vendorBadge('google')).toBe('G');
      expect(vendorBadge('deepseek')).toBe('DS');
      expect(vendorBadge('openai')).toBe('OAI');
      expect(vendorBadge('anthropic')).toBe('CL');
    });
  });

  describe('Sample service models', () => {
    it('returns models with credits from sample service', async () => {
      const models = await sample.getModels();
      expect(models.length).toBeGreaterThan(0);
      const flash = models.find((m) => m.model_id === 'google/gemini-3.8-flash');
      expect(flash).toBeDefined();
      expect(flash.credits).toBe(8);
      expect(flash.min_plan).toBe('free');
    });
  });

  describe('Model sheet rendering and interaction', () => {
    it('renders dynamic model listing grouped by vendor with exact model_ids and labels', () => {
      render(<Model />);

      // Vendor group headings
      expect(screen.getByText('Google')).toBeTruthy();
      expect(screen.getByText('DeepSeek')).toBeTruthy();
      expect(screen.getByText('Anthropic')).toBeTruthy();
      expect(screen.getByText('OpenAI')).toBeTruthy();

      // Model display labels
      expect(screen.getByText('Gemini - Flash')).toBeTruthy();
      expect(screen.getByText('DeepSeek - Pro')).toBeTruthy();
      expect(screen.getByText('Claude - Sonnet 5.5')).toBeTruthy();
      expect(screen.getByText('GPT - Astra')).toBeTruthy();

      // Exact backend model_ids in mono
      expect(screen.getByText('google/gemini-3.8-flash')).toBeTruthy();
      expect(screen.getByText('deepseek/deepseek-v4-pro')).toBeTruthy();
      expect(screen.getByText('anthropic/claude-sonnet-5.5')).toBeTruthy();
      expect(screen.getByText('openai/gpt-6-astra')).toBeTruthy();

      // Credit estimates
      expect(screen.getByText('~8 cr')).toBeTruthy();
      expect(screen.getByText('~15 cr')).toBeTruthy();
      expect(screen.getByText('~140 cr')).toBeTruthy();
    });

    it('highlights the selected model', () => {
      render(<Model />);
      const defaultButton = screen.getByText('Gemini - Flash').closest('button');
      expect(defaultButton.classList.contains('selected')).toBe(true);
      expect(defaultButton.getAttribute('aria-pressed')).toBe('true');

      const deepseekButton = screen.getByText('DeepSeek - Pro').closest('button');
      expect(deepseekButton.classList.contains('selected')).toBe(false);
      expect(deepseekButton.getAttribute('aria-pressed')).toBe('false');
    });

    it('calls chat.setModelId with the exact model ID when an allowed model is clicked', () => {
      render(<Model />);
      const deepseekButton = screen.getByText('DeepSeek - Pro').closest('button');
      fireEvent.click(deepseekButton);

      expect(mockSetModelId).toHaveBeenCalledWith('deepseek/deepseek-v4-pro');
      expect(mockOpenSheet).not.toHaveBeenCalled();
      // Verifies chat history, attachments, and focus remain untouched in chat state
      expect(chatState.turns).toHaveLength(1);
      expect(chatState.attachments).toHaveLength(1);
      expect(chatState.focus).toBe('law_orders');
    });

    it('triggers openSheet("plans") when a locked/disallowed model is clicked', () => {
      render(<Model />);
      const sonnetButton = screen.getByText('Claude - Sonnet 5.5').closest('button');
      expect(sonnetButton.classList.contains('locked')).toBe(true);

      fireEvent.click(sonnetButton);
      expect(mockSetModelId).not.toHaveBeenCalled();
      expect(mockOpenSheet).toHaveBeenCalledWith('plans');
    });

    it('filters models dynamically by search query (by label, vendor, or model_id)', () => {
      render(<Model />);
      const searchInput = screen.getByLabelText('Search models');

      // Search by vendor name
      fireEvent.change(searchInput, { target: { value: 'deepseek' } });
      expect(screen.getByText('DeepSeek - Pro')).toBeTruthy();
      expect(screen.queryByText('Gemini - Flash')).toBeNull();
      expect(screen.queryByText('Claude - Sonnet 5.5')).toBeNull();

      // Search by model_id substring
      fireEvent.change(searchInput, { target: { value: 'claude-sonnet' } });
      expect(screen.getByText('Claude - Sonnet 5.5')).toBeTruthy();
      expect(screen.queryByText('DeepSeek - Pro')).toBeNull();

      // Empty results
      fireEvent.change(searchInput, { target: { value: 'nonexistent-model-xyz' } });
      expect(screen.getByText('No matching models')).toBeTruthy();
    });

    it('preserves reasoning effort selector and allows changing effort', () => {
      render(<Model />);
      expect(screen.getByText('REASONING EFFORT')).toBeTruthy();

      const mediumButton = screen.getByText('Medium');
      expect(mediumButton).toBeTruthy();
      fireEvent.click(mediumButton);
      expect(mockSetEffort).toHaveBeenCalledWith('medium');
    });
  });
});
