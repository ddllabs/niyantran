/**
 * Feature F341: Capability 4 — Sandboxed File Preview Modal.
 *
 * Provides safe in-browser previews for approved formats (PDF, JPEG, PNG, WebP, Text, Markdown)
 * with 60-second short-lived signed URLs, sanitization against XSS, and download affordances.
 */

import { useEffect, useState } from 'react';
import {
  X,
  Download,
  Sparkles,
  FileText,
  FileQuestion,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { getDownloadUrl, formatBytes } from './fileManagerService.js';
import { resolvePreviewKind } from '../types/fileManager.ts';

/**
 * Escapes raw HTML to prevent XSS in text and markdown previews.
 */
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * @param {{
 *   file: any,
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onDownload?: (file: any) => void,
 *   onChatWithFile?: (file: any) => void
 * }} props
 */
export default function PdfPreviewModal({
  file,
  isOpen,
  onClose,
  onDownload,
  onChatWithFile,
}) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const previewKind = file ? resolvePreviewKind(file.mime_type) : 'unsupported';

  // Keyboard navigation: Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Fetch signed preview URL and content
  useEffect(() => {
    if (!isOpen || !file) {
      setSignedUrl(null);
      setTextContent('');
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    getDownloadUrl(file.id, { download: false, fileName: file.name })
      .then(async (url) => {
        if (!isMounted) return;
        setSignedUrl(url);

        // For plain text and markdown, fetch raw text payload to render in viewer
        if (previewKind === 'text' || previewKind === 'markdown') {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            if (isMounted) setTextContent(text);
          } catch (textErr) {
            console.error('Failed to load text preview content:', textErr);
          }
        }
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Failed to load preview');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, file, previewKind]);

  if (!isOpen || !file) return null;

  return (
    <div className="fm-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <div className="fm-modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="fm-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <FileText size={16} className="text-muted" aria-hidden="true" />
            <span className="fm-modal-title" title={file.name}>
              {file.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
              ({formatBytes(file.size_bytes)})
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onChatWithFile && (
              <button
                type="button"
                className="fm-btn fm-btn-primary"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => {
                  onClose();
                  onChatWithFile(file);
                }}
                title="Open contextual chat with this file attached"
              >
                <Sparkles size={13} />
                <span>✦ Ask AI</span>
              </button>
            )}

            <button
              type="button"
              className="fm-btn"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => onDownload?.(file)}
              title="Download file to device"
            >
              <Download size={13} />
              <span>Download</span>
            </button>

            <button
              type="button"
              className="fm-btn"
              style={{ padding: '4px 8px' }}
              onClick={onClose}
              title="Close preview"
              aria-label="Close preview modal"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="fm-modal-body">
          {loading ? (
            <div className="fm-empty-state" style={{ minHeight: 300 }}>
              <Loader2 size={32} className="animate-spin text-muted" />
              <div className="fm-empty-title">Loading preview...</div>
              <div className="fm-empty-desc">Generating secure short-lived viewing token.</div>
            </div>
          ) : error ? (
            <div className="fm-empty-state" style={{ minHeight: 300 }}>
              <AlertCircle size={32} style={{ color: '#b91c1c' }} />
              <div className="fm-empty-title">Preview Unavailable</div>
              <div className="fm-empty-desc">{error}</div>
            </div>
          ) : previewKind === 'pdf' && signedUrl ? (
            <iframe
              src={`${signedUrl}#toolbar=0`}
              title={file.name}
              className="fm-preview-frame"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : previewKind === 'image' && signedUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <img
                src={signedUrl}
                alt={file.name}
                className="fm-preview-image"
                loading="lazy"
              />
            </div>
          ) : (previewKind === 'text' || previewKind === 'markdown') && textContent ? (
            <div className="fm-preview-text">
              <div
                dangerouslySetInnerHTML={{
                  __html: escapeHtml(textContent),
                }}
              />
            </div>
          ) : (
            <div className="fm-empty-state" style={{ minHeight: 300 }}>
              <FileQuestion size={40} className="fm-empty-icon" />
              <div className="fm-empty-title">Inline Preview Not Supported</div>
              <div className="fm-empty-desc">
                Files with MIME type <code>{file.mime_type}</code> are stored securely but cannot be safely previewed in the browser. You can download the file directly.
              </div>
              <button
                type="button"
                className="fm-btn fm-btn-primary"
                onClick={() => onDownload?.(file)}
              >
                <Download size={14} /> Download {file.name}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
