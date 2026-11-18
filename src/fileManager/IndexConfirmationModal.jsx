/**
 * Feature F341 / Phase 10: AI Indexing Cost Confirmation Modal.
 *
 * Implements transparent pre-indexing confirmation:
 * - Calculates estimated page count & credit cost (40 credits / ₹0.40 per page).
 * - Queries user's live credit balance via `my_credits_cycle_v3()` or `my_credits()`.
 * - Prevents unconfirmed or under-funded job submissions with balance warnings and billing CTAs.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  X,
  AlertCircle,
  Coins,
  ExternalLink,
  Loader2,
  FileText,
} from 'lucide-react';
import { formatBytes, IS_INDEXING_BILLING_DEPLOYED } from './fileManagerService.js';
import { supabase } from '../lib/supabaseClient.js';

// Standard rate: 38 credits Mistral OCR + 2 credits OpenRouter embedding = 40 credits / ₹0.40 per page
const CREDITS_PER_PAGE = 40;
const BYTES_PER_ESTIMATED_PAGE = 60000; // ~60 KB/page heuristic if page_count is unset

export default function IndexConfirmationModal({
  file,
  isOpen,
  onClose,
  onConfirm,
  isBatch = false,
  batchFiles = [],
}) {
  const [balance, setBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [_balanceError, setBalanceError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, submitting]);

  // Fetch current user wallet balance
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setLoadingBalance(true);
    setBalanceError(null);

    async function fetchBalance() {
      try {
        const { data: cycleData, error: cycleErr } = await supabase.rpc('my_credits_cycle_v3');
        if (!cycleErr && cycleData && typeof cycleData.available === 'number') {
          if (isMounted) setBalance(cycleData.available);
          return;
        }

        // Fallback to my_credits
        const { data: creditsData, error: credErr } = await supabase.rpc('my_credits');
        if (!credErr && creditsData && typeof creditsData.available === 'number') {
          if (isMounted) setBalance(creditsData.available);
          return;
        }

        // Balance not available from cycle or credits RPC
        if (isMounted) setBalance(null);
      } catch (err) {
        if (isMounted) {
          setBalanceError(err.message || 'Unable to check live credit balance');
          setBalance(null);
        }
      } finally {
        if (isMounted) setLoadingBalance(false);
      }
    }

    fetchBalance();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Calculate pages and cost estimates
  const targets = useMemo(() => {
    if (isBatch) return batchFiles;
    return file ? [file] : [];
  }, [isBatch, batchFiles, file]);

  const { totalPages, totalCredits, totalPaise, totalBytes } = useMemo(() => {
    let pages = 0;
    let bytes = 0;
    for (const f of targets) {
      const pCount = f.page_count && f.page_count > 0
        ? f.page_count
        : Math.max(1, Math.ceil((f.size_bytes || 0) / BYTES_PER_ESTIMATED_PAGE));
      pages += pCount;
      bytes += (f.size_bytes || 0);
    }
    const credits = pages * CREDITS_PER_PAGE;
    return {
      totalPages: pages,
      totalCredits: credits,
      totalPaise: credits, // 1 credit = 1 paisa
      totalBytes: bytes,
    };
  }, [targets]);

  const hasSufficientCredits = balance === null || balance >= totalCredits;

  const handleConfirmClick = async () => {
    if (!IS_INDEXING_BILLING_DEPLOYED) return;
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } catch (_err) {
      // Handled by parent toast
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || targets.length === 0) return null;

  return (
    <div
      className="fm-modal-backdrop"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm AI Indexing"
    >
      <div className="fm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        {/* Head */}
        <div className="fm-modal-head" style={{ borderBottom: '1px solid var(--line, #e4ddd4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(1, 46, 161, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent, #012ea1)',
              }}
            >
              <Sparkles size={15} />
            </div>
            <span className="fm-modal-title">
              {isBatch ? `Index ${targets.length} PDF Documents` : 'Index Document for AI'}
            </span>
          </div>
          <button
            type="button"
            className="fm-btn fm-btn-icon"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 13, color: 'var(--text, #3d3a36)', lineHeight: 1.5, margin: 0 }}>
            Indexing extracts full OCR text and creates high-dimensional vector embeddings, enabling
            instant contextual retrieval and citations in AI Research.
          </p>

          {!IS_INDEXING_BILLING_DEPLOYED && (
            <div
              style={{
                marginTop: 12,
                marginBottom: 12,
                padding: '10px 14px',
                borderRadius: 'var(--radius, 8px)',
                background: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                color: '#854d0e',
                fontSize: 12,
                lineHeight: 1.4,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1, color: '#ca8a04' }} />
              <span>
                <strong>AI Indexing Temporarily Unavailable:</strong> Server-side credit reservation and indexing infrastructure is currently undergoing scheduled deployment. Upload, download, preview, and folder organization remain fully operational.
              </span>
            </div>
          )}

          {/* Document Summary Card */}
          <div
            style={{
              background: 'var(--bg, #f8f5f0)',
              borderRadius: 'var(--radius, 8px)',
              border: '1px solid var(--line, #e4ddd4)',
              padding: '12px 14px',
              margin: '14px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                <FileText size={14} className="text-muted" />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={isBatch ? `${targets.length} files` : targets[0].name}
                >
                  {isBatch ? `${targets.length} documents selected` : targets[0].name}
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                {formatBytes(totalBytes)}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--line, #e4ddd4)',
                fontSize: 12,
              }}
            >
              <div>
                <span style={{ color: 'var(--muted)' }}>Estimated Pages:</span>{' '}
                <strong>~{totalPages} pages</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted)' }}>Rate:</span>{' '}
                <strong>₹0.40 / page</strong>
              </div>
            </div>
          </div>

          {/* Cost & Balance Breakdown */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius, 8px)',
              background: hasSufficientCredits ? 'rgba(22, 163, 74, 0.06)' : 'rgba(220, 38, 38, 0.06)',
              border: `1px solid ${hasSufficientCredits ? 'rgba(22, 163, 74, 0.25)' : 'rgba(220, 38, 38, 0.25)'}`,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
                <Coins size={15} style={{ color: hasSufficientCredits ? '#16a34a' : '#dc2626' }} />
                <span>Estimated Indexing Cost</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {totalCredits.toLocaleString()} credits <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>(₹{(totalPaise / 100).toFixed(2)})</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Your Available Balance:</span>
              <span style={{ fontWeight: 600 }}>
                {loadingBalance ? (
                  <Loader2 size={12} className="animate-spin inline" />
                ) : balance !== null ? (
                  `${balance.toLocaleString()} credits`
                ) : (
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Balance check unavailable</span>
                )}
              </span>
            </div>

            {!hasSufficientCredits && !loadingBalance && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: '1px solid rgba(220, 38, 38, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b91c1c', fontSize: 12 }}>
                  <AlertCircle size={13} />
                  <span>Insufficient credits in wallet.</span>
                </div>
                <a
                  href="#/billing"
                  className="fm-btn fm-btn-secondary"
                  style={{ padding: '3px 8px', fontSize: 11, textDecoration: 'none' }}
                >
                  <ExternalLink size={11} /> Top Up
                </a>
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 16 }}>
            ✦ <strong>Zero-charge rule:</strong> Attaching an indexed file to future AI Research conversations costs <strong>0 additional indexing credits</strong>.
            <br />
            ✦ <strong>Reservation & Settlement:</strong> The 40 credits/page is an upfront reservation hold. At completion, your account is settled on exact provider cost (Mistral OCR + OpenRouter embedding) and any unused reservation is immediately refunded to your available balance.
          </div>

          {/* Action buttons */}
          <div className="fm-modal-actions">
            <button
              type="button"
              className="fm-btn"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>

            <button
              type="button"
              className="fm-btn fm-btn-primary"
              onClick={handleConfirmClick}
              disabled={!IS_INDEXING_BILLING_DEPLOYED || submitting || (!hasSufficientCredits && !loadingBalance)}
            >
              {!IS_INDEXING_BILLING_DEPLOYED ? (
                <span>Indexing Temporarily Unavailable</span>
              ) : submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Enqueueing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={13} />
                  <span>Confirm & Index</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
