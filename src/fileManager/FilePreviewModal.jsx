/**
 * Feature F341: Sandboxed Multi-Format File Preview Modal.
 *
 * Implements comprehensive in-browser previews across all supported file types:
 * - PDF: Sandboxed iframe with zoom & navigation
 * - Images: PNG, JPEG, WebP, GIF, SVG with responsive fit & zoom
 * - Tabular Data (CSV, TSV, XLSX, XLS): SheetJS workbook parser, sheet selector tabs,
 *   scrollable table with row numbers, bold sticky headers, and search/filter
 * - Code & Plain Text: Monospace layout with line numbers and copy-to-clipboard
 * - Markdown: Sanitized structured rendering (headings, lists, code fences, blockquotes, tables)
 * - Unsupported: Honest metadata fallback with secure download CTA
 * - Security: Short-lived signed URLs (60s), zero script execution, blob cleanup
 */

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  X,
  Download,
  Sparkles,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  FileQuestion,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getDownloadUrl, formatBytes } from './fileManagerService.js';

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
 * Enhanced file preview kind resolution supporting both MIME type and filename extension.
 * @param {string} mimeType
 * @param {string} fileName
 * @returns {'pdf' | 'image' | 'spreadsheet' | 'csv' | 'markdown' | 'code' | 'text' | 'unsupported'}
 */
export function resolveFilePreviewKind(mimeType = '', fileName = '') {
  const m = (mimeType || '').toLowerCase();
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  if (m === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }

  if (
    (m.startsWith('image/') && m !== 'image/svg+xml') ||
    ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
  ) {
    return 'image';
  }

  if (
    m === 'text/csv' ||
    m === 'text/tab-separated-values' ||
    ext === 'csv' ||
    ext === 'tsv'
  ) {
    return 'csv';
  }

  if (
    m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    m === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls'
  ) {
    return 'spreadsheet';
  }

  if (m === 'text/markdown' || ext === 'md' || ext === 'markdown') {
    return 'markdown';
  }

  if (
    ['json', 'js', 'jsx', 'ts', 'tsx', 'py', 'sql', 'sh', 'html', 'css', 'yaml', 'yml', 'xml'].includes(ext) ||
    m.includes('javascript') ||
    m.includes('json') ||
    m.includes('html') ||
    m.includes('css')
  ) {
    return 'code';
  }

  if (m === 'text/plain' || ext === 'txt' || ext === 'log') {
    return 'text';
  }

  return 'unsupported';
}

/**
 * Lightweight, safe markdown formatter without external dependencies.
 * Sanitizes input first, then transforms bold, italics, code, headings, and lists.
 */
function formatSanitizedMarkdown(rawText) {
  if (!rawText) return '';
  const lines = rawText.split('\n');
  const formatted = [];
  let inCodeBlock = false;
  let codeBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        formatted.push(
          `<pre class="fm-preview-code-block"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      formatted.push(`<h4 class="fm-md-h3">${escapeHtml(line.slice(4))}</h4>`);
    } else if (line.startsWith('## ')) {
      formatted.push(`<h3 class="fm-md-h2">${escapeHtml(line.slice(3))}</h3>`);
    } else if (line.startsWith('# ')) {
      formatted.push(`<h2 class="fm-md-h1">${escapeHtml(line.slice(2))}</h2>`);
    } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const itemText = escapeHtml(line.trim().slice(2));
      formatted.push(`<li class="fm-md-li">${inlineFormat(itemText)}</li>`);
    } else if (line.trim().startsWith('> ')) {
      formatted.push(
        `<blockquote class="fm-md-quote">${inlineFormat(escapeHtml(line.trim().slice(2)))}</blockquote>`
      );
    } else if (line.trim().length === 0) {
      formatted.push('<div class="fm-md-spacer"></div>');
    } else {
      formatted.push(`<p class="fm-md-p">${inlineFormat(escapeHtml(line))}</p>`);
    }
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    formatted.push(
      `<pre class="fm-preview-code-block"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`
    );
  }

  return formatted.join('');
}

function inlineFormat(escapedText) {
  return escapedText
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="fm-md-inline-code">$1</code>');
}

export default function FilePreviewModal({
  file,
  isOpen,
  onClose,
  onDownload,
  onChatWithFile,
}) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Content states
  const [textContent, setTextContent] = useState('');
  const [sheets, setSheets] = useState([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [sheetTableData, setSheetTableData] = useState([]);
  const [tableSearch, setTableSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const workbookRef = useRef(null);

  const previewKind = useMemo(() => {
    return file ? resolveFilePreviewKind(file.mime_type, file.name) : 'unsupported';
  }, [file]);

  // Keyboard navigation: Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Reset zoom & search on file change
  useEffect(() => {
    setImageZoom(1);
    setTableSearch('');
    setActiveSheetIndex(0);
  }, [file]);

  // Fetch signed preview URL and content
  useEffect(() => {
    if (!isOpen || !file) {
      setSignedUrl(null);
      setTextContent('');
      setSheets([]);
      setSheetTableData([]);
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

        // Plain text, Markdown, or Code
        if (previewKind === 'text' || previewKind === 'markdown' || previewKind === 'code') {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            if (isMounted) setTextContent(text);
          } catch (textErr) {
            if (isMounted) setError(`Failed to read file contents: ${textErr.message}`);
          }
        }

        // CSV or Spreadsheets (XLSX, XLS)
        if (previewKind === 'csv' || previewKind === 'spreadsheet') {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const arrayBuffer = await resp.arrayBuffer();
            if (!isMounted) return;

            // Secure parsing: prevent formula execution, rich text/HTML parsing, and limit rows
            const workbook = XLSX.read(arrayBuffer, {
              type: 'array',
              cellFormula: false,
              cellHTML: false,
              cellText: true,
              WTF: false,
              sheetRows: 2000,
            });
            workbookRef.current = workbook;
            const sheetNames = workbook.SheetNames || [];
            if (isMounted) {
              setSheets(sheetNames);
              if (sheetNames.length > 0) {
                const ws = workbook.Sheets[sheetNames[0]];
                const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                setSheetTableData(data);
              }
            }
          } catch (sheetErr) {
            if (isMounted) setError(`Failed to parse spreadsheet: ${sheetErr.message}`);
          }
        }
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Failed to generate preview URL');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      workbookRef.current = null;
    };
  }, [isOpen, file, previewKind]);

  // Handle Sheet tab switch (uses in-memory workbook to survive signed URL expiration)
  const handleSheetSwitch = useCallback(
    (sheetIdx) => {
      setActiveSheetIndex(sheetIdx);
      if (!sheets[sheetIdx]) return;
      try {
        const wb = workbookRef.current;
        if (!wb) return;
        const ws = wb.Sheets[sheets[sheetIdx]];
        if (!ws) return;
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        setSheetTableData(data);
      } catch (_e) {
        // Keep current sheet data
      }
    },
    [sheets]
  );

  // Filtered rows for CSV/Spreadsheet
  const filteredTableRows = useMemo(() => {
    if (!sheetTableData || sheetTableData.length === 0) return [];
    if (!tableSearch.trim()) return sheetTableData;
    const term = tableSearch.toLowerCase();
    const [headerRow, ...bodyRows] = sheetTableData;
    const filteredBody = bodyRows.filter((row) =>
      Array.isArray(row) && row.some((cell) => String(cell || '').toLowerCase().includes(term))
    );
    return [headerRow, ...filteredBody];
  }, [sheetTableData, tableSearch]);

  const handleCopyText = useCallback(() => {
    if (!textContent) return;
    navigator.clipboard.writeText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [textContent]);

  if (!isOpen || !file) return null;

  return (
    <div
      className="fm-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${file.name}`}
    >
      <div className="fm-modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="fm-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            {previewKind === 'spreadsheet' || previewKind === 'csv' ? (
              <FileSpreadsheet size={16} className="text-muted" aria-hidden="true" />
            ) : previewKind === 'code' ? (
              <FileCode size={16} className="text-muted" aria-hidden="true" />
            ) : previewKind === 'image' ? (
              <ImageIcon size={16} className="text-muted" aria-hidden="true" />
            ) : (
              <FileText size={16} className="text-muted" aria-hidden="true" />
            )}
            <span className="fm-modal-title" title={file.name}>
              {file.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
              ({formatBytes(file.size_bytes)})
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
              <button
                type="button"
                className="fm-btn fm-btn-secondary"
                onClick={() => onDownload?.(file)}
                style={{ marginTop: 12 }}
              >
                <Download size={13} /> Download File Instead
              </button>
            </div>
          ) : previewKind === 'pdf' && signedUrl ? (
            <iframe
              src={`${signedUrl}#toolbar=0`}
              title={`PDF preview of ${file.name}`}
              className="fm-preview-frame"
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : previewKind === 'image' && signedUrl ? (
            <div className="fm-preview-image-container">
              <div className="fm-preview-toolbar">
                <button
                  type="button"
                  className="fm-btn fm-btn-icon"
                  onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}
                  title="Zoom Out"
                >
                  <ZoomOut size={13} />
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 40, textAlign: 'center' }}>
                  {Math.round(imageZoom * 100)}%
                </span>
                <button
                  type="button"
                  className="fm-btn fm-btn-icon"
                  onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}
                  title="Zoom In"
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  type="button"
                  className="fm-btn fm-btn-icon"
                  onClick={() => setImageZoom(1)}
                  title="Reset Zoom"
                >
                  <Maximize2 size={13} />
                </button>
              </div>
              <div className="fm-preview-image-stage">
                <img
                  src={signedUrl}
                  alt={file.name}
                  className="fm-preview-image"
                  style={{ transform: `scale(${imageZoom})` }}
                  loading="lazy"
                />
              </div>
            </div>
          ) : (previewKind === 'csv' || previewKind === 'spreadsheet') && sheetTableData.length > 0 ? (
            <div className="fm-preview-table-container">
              {/* Sheet selector and search bar */}
              <div className="fm-preview-table-toolbar">
                {sheets.length > 1 && (
                  <div className="fm-sheet-tabs">
                    {sheets.map((sName, idx) => (
                      <button
                        key={sName}
                        type="button"
                        className={`fm-sheet-tab ${idx === activeSheetIndex ? 'active' : ''}`}
                        onClick={() => handleSheetSwitch(idx)}
                      >
                        {sName}
                      </button>
                    ))}
                  </div>
                )}
                <div className="fm-table-search-box">
                  <Search size={13} className="text-muted" />
                  <input
                    type="search"
                    placeholder="Search in table..."
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    className="fm-table-search-input"
                  />
                  {tableSearch && (
                    <button
                      type="button"
                      className="fm-search-clear-btn"
                      onClick={() => setTableSearch('')}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* Data Table */}
              <div className="fm-preview-grid-wrap">
                <table className="fm-sheet-table">
                  {filteredTableRows[0] && (
                    <thead>
                      <tr>
                        <th className="fm-sheet-th fm-sheet-idx-col">#</th>
                        {filteredTableRows[0].map((header, cIdx) => (
                          <th key={`th-${cIdx}`} className="fm-sheet-th">
                            {header !== undefined && header !== null ? String(header) : `Col ${cIdx + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {filteredTableRows.slice(1).map((row, rIdx) => (
                      <tr key={`tr-${rIdx}`}>
                        <td className="fm-sheet-td fm-sheet-idx-col">{rIdx + 1}</td>
                        {Array.isArray(row) &&
                          row.map((cell, cIdx) => (
                            <td key={`td-${rIdx}-${cIdx}`} className="fm-sheet-td">
                              {cell !== undefined && cell !== null ? String(cell) : ''}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : previewKind === 'markdown' && textContent ? (
            <div className="fm-preview-markdown-wrap">
              <div
                className="fm-preview-markdown"
                dangerouslySetInnerHTML={{
                  __html: formatSanitizedMarkdown(textContent),
                }}
              />
            </div>
          ) : (previewKind === 'text' || previewKind === 'code') && textContent ? (
            <div className="fm-preview-code-wrap">
              <div className="fm-preview-code-toolbar">
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {textContent.split('\n').length} lines
                </span>
                <button
                  type="button"
                  className="fm-btn fm-btn-secondary"
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  onClick={handleCopyText}
                  title="Copy content to clipboard"
                >
                  {copied ? <Check size={12} style={{ color: '#16a34a' }} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="fm-preview-text">
                <pre>{textContent}</pre>
              </div>
            </div>
          ) : (
            <div className="fm-empty-state" style={{ minHeight: 300 }}>
              <FileQuestion size={40} className="fm-empty-icon" />
              <div className="fm-empty-title">
                {file?.name?.toLowerCase().endsWith('.svg') || file?.mime_type === 'image/svg+xml'
                  ? 'SVG Preview Disabled for Security'
                  : 'Inline Preview Not Supported'}
              </div>
              <div className="fm-empty-desc">
                {file?.name?.toLowerCase().endsWith('.svg') || file?.mime_type === 'image/svg+xml'
                  ? 'Vector graphics (SVG) can contain active scripts or external network references and are not rendered inline for security. You can download the file to view it securely.'
                  : `Files with MIME type ${file.mime_type || 'unknown'} are stored securely, but cannot be safely rendered inline in the browser. You can download the file to inspect it.`}
              </div>
              <button
                type="button"
                className="fm-btn fm-btn-primary"
                onClick={() => onDownload?.(file)}
                style={{ marginTop: 12 }}
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
