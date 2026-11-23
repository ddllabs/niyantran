import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import {
  listFiles,
  uploadFile,
  deleteFile,
  retryIndexing,
  indexForAi,
  getFilePreview,
  getStorageUsage,
  formatBytes,
  formatRelativeDate,
  isPdfMimeType,
  resolvePreviewKind,
  normalizeFileManagerError,
} from '../services/fileManager.js';
import { parseCsvString } from '../lib/extractors/spreadsheetExtractor.js';
import Icon from '../ui/Icon.jsx';
import { Header, TabBar, Empty, Spinner } from '../ui/kit.jsx';

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'pdf', label: 'PDF' },
  { id: 'ready_for_ai', label: 'Ready for AI' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
];

/**
 * Returns human-readable format-aware metadata label (e.g. "4 worksheets", "12 slides", "24 pages").
 * @param {any} file
 * @returns {string | null}
 */
export function getFormatMetadataLabel(file) {
  if (!file) return null;
  if (file.page_count) {
    return `${file.page_count} page${file.page_count === 1 ? '' : 's'}`;
  }
  const wsCount = file.worksheet_count ?? file.metadata?.worksheet_count ?? file.metadata?.sheetCount;
  if (wsCount) {
    return `${wsCount} worksheet${wsCount === 1 ? '' : 's'}`;
  }
  const slideCount = file.slide_count ?? file.metadata?.slide_count ?? file.metadata?.slideCount;
  if (slideCount) {
    return `${slideCount} slide${slideCount === 1 ? '' : 's'}`;
  }
  const rowCount = file.row_count ?? file.metadata?.row_count ?? file.metadata?.totalRows;
  if (rowCount) {
    return `${rowCount} row${rowCount === 1 ? '' : 's'}`;
  }
  const secCount = file.section_count ?? file.metadata?.section_count;
  if (secCount) {
    return `${secCount} section${secCount === 1 ? '' : 's'}`;
  }
  return null;
}

function FileIcon({ file }) {
  const isPdf = isPdfMimeType(file.mime_type) || (file.name || '').toLowerCase().endsWith('.pdf');
  const isSheet = (file.mime_type || '').includes('spreadsheet') || (file.name || '').match(/\.(xlsx?|csv)$/i);
  const isWord = (file.mime_type || '').includes('wordprocessingml') || (file.name || '').endsWith('.docx');
  const isPres = (file.mime_type || '').includes('presentationml') || (file.name || '').endsWith('.pptx');

  if (isPdf) {
    return (
      <span className="fm-file-icon pdf">
        <Icon name="pdf" />
      </span>
    );
  }
  if (isSheet) {
    return (
      <span className="fm-file-icon sheet">
        <Icon name="sheet" />
      </span>
    );
  }
  if (isWord) {
    return (
      <span className="fm-file-icon word">
        <Icon name="word" />
      </span>
    );
  }
  if (isPres) {
    return (
      <span className="fm-file-icon pres">
        <Icon name="doc" />
      </span>
    );
  }
  return (
    <span className="fm-file-icon generic">
      <Icon name="file" />
    </span>
  );
}

function StatusBadge({ file }) {
  const indexStatus = file.index_status;
  const uploadStatus = file.upload_status;

  if (uploadStatus === 'uploading') {
    return <span className="pill purple">Uploading…</span>;
  }
  if (uploadStatus === 'upload_failed') {
    return <span className="pill red">Upload Failed</span>;
  }

  if (indexStatus === 'indexed' || indexStatus === 'ready_for_ai') {
    return <span className="pill live">✦ Ready for AI</span>;
  }
  if (['indexing_queued', 'indexing_extracting', 'indexing_chunking', 'processing'].includes(indexStatus)) {
    return <span className="pill purple">⟳ Ingesting / AI</span>;
  }
  if (indexStatus === 'indexing_failed' || indexStatus === 'failed') {
    return <span className="pill red">⚠ Index Failed</span>;
  }
  if (indexStatus === 'unsupported') {
    return <span className="pill grey">Stored</span>;
  }
  return <span className="pill amber">Not Indexed</span>;
}

/**
 * Parses markdown table lines into headers and rows.
 * @param {string} text
 * @returns {{ headers: string[], rows: string[][] } | null}
 */
function parseMarkdownTable(text) {
  if (!text) return null;
  const lines = text.trim().split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|') && l.endsWith('|'));
  if (lines.length < 2) return null;
  const parseRow = (line) => line.slice(1, -1).split('|').map((c) => c.trim());
  const headers = parseRow(lines[0]);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    rows.push(parseRow(lines[i]));
  }
  return { headers, rows };
}

/**
 * Renders XLSX preview with worksheet switcher and scrollable table view.
 */
function XlsxRichPreview({ text }) {
  const [activeSheet, setActiveSheet] = useState(0);

  // Parse worksheets delimited by "## Worksheet: <Name>"
  const sheets = useMemo(() => {
    if (!text) return [];
    if (!text.includes('## Worksheet:')) {
      // Check if text itself is a markdown table or delimited rows
      const table = parseMarkdownTable(text);
      if (table) {
        return [{ name: 'Sheet 1', table }];
      }
      const { rows } = parseCsvString(text);
      if (rows.length > 0) {
        return [{ name: 'Sheet 1', table: { headers: rows[0], rows: rows.slice(1) } }];
      }
      return [];
    }

    const parts = text.split(/(?=## Worksheet:\s*)/);
    const parsed = [];
    for (const part of parts) {
      const match = /^## Worksheet:\s*(.*)$/m.exec(part);
      const name = match ? match[1].trim() : `Sheet ${parsed.length + 1}`;
      const tablePart = part.replace(/^## Worksheet:.*$/m, '').trim();
      const table = parseMarkdownTable(tablePart);
      if (table) {
        parsed.push({ name, table });
      } else {
        const { rows } = parseCsvString(tablePart);
        parsed.push({ name, table: { headers: rows[0] || [], rows: rows.slice(1) } });
      }
    }
    return parsed;
  }, [text]);

  if (sheets.length === 0) {
    return <pre>{text}</pre>;
  }

  const current = sheets[activeSheet] || sheets[0];
  const table = current?.table || { headers: [], rows: [] };

  return (
    <div className="fm-xlsx-preview">
      {sheets.length > 1 ? (
        <div className="fm-sheet-tabs" role="tablist" aria-label="Worksheets">
          {sheets.map((s, idx) => (
            <button
              key={s.name || idx}
              type="button"
              role="tab"
              aria-selected={activeSheet === idx}
              className={`fm-sheet-tab ${activeSheet === idx ? 'active' : ''}`}
              onClick={() => setActiveSheet(idx)}
            >
              <span>{s.name}</span>
              <span className="fm-filter-count">{s.table.rows.length} rows</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="fm-preview-toolbar">
        <span className="fm-preview-stats">
          Worksheet: <b>{current?.name}</b> · {table.rows.length} rows · {table.headers.length} columns
        </span>
      </div>

      <div className="fm-table-scroll">
        <table className="fm-data-table">
          <thead>
            <tr>
              <th className="fm-table-row-idx">#</th>
              {table.headers.map((h, i) => (
                <th key={i}>{h || `Col ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 150).map((row, rIdx) => (
              <tr key={rIdx}>
                <td className="fm-table-row-idx">{rIdx + 1}</td>
                {table.headers.map((_, cIdx) => (
                  <td key={cIdx}>{row[cIdx] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length > 150 ? (
        <div style={{ padding: '6px 0', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
          Showing first 150 of {table.rows.length} rows
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders CSV table preview with parsed rows and columns.
 */
function CsvRichPreview({ text }) {
  const parsed = useMemo(() => {
    if (!text) return null;
    const mdTable = parseMarkdownTable(text);
    if (mdTable) return mdTable;
    const { rows } = parseCsvString(text);
    if (rows.length === 0) return null;
    return { headers: rows[0], rows: rows.slice(1) };
  }, [text]);

  if (!parsed || parsed.rows.length === 0) {
    return <pre>{text}</pre>;
  }

  return (
    <div className="fm-csv-preview">
      <div className="fm-preview-toolbar">
        <span className="fm-preview-stats">
          {parsed.rows.length} rows · {parsed.headers.length} columns
        </span>
      </div>
      <div className="fm-table-scroll">
        <table className="fm-data-table">
          <thead>
            <tr>
              <th className="fm-table-row-idx">#</th>
              {parsed.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.rows.slice(0, 150).map((row, rIdx) => (
              <tr key={rIdx}>
                <td className="fm-table-row-idx">{rIdx + 1}</td>
                {parsed.headers.map((_, cIdx) => (
                  <td key={cIdx}>{row[cIdx] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders DOCX preview with structured headings and tables.
 */
function DocxRichPreview({ text }) {
  const blocks = useMemo(() => {
    if (!text) return [];
    return text.split(/\n\s*\n+/).filter(Boolean);
  }, [text]);

  return (
    <div className="fm-docx-container">
      {blocks.map((block, idx) => {
        const trimmed = block.trim();
        if (trimmed.startsWith('# ')) {
          return <h3 key={idx} className="fm-docx-h1">{trimmed.slice(2)}</h3>;
        }
        if (trimmed.startsWith('## ')) {
          return <h4 key={idx} className="fm-docx-h2">{trimmed.slice(3)}</h4>;
        }
        if (trimmed.startsWith('### ')) {
          return <h5 key={idx} className="fm-docx-h3">{trimmed.slice(4)}</h5>;
        }
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          const table = parseMarkdownTable(trimmed);
          if (table) {
            return (
              <div key={idx} className="fm-table-scroll" style={{ margin: '10px 0' }}>
                <table className="fm-data-table">
                  <thead>
                    <tr>
                      {table.headers.map((h, hIdx) => (
                        <th key={hIdx}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {table.headers.map((_, cIdx) => (
                          <td key={cIdx}>{row[cIdx] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
        }
        return <p key={idx} className="fm-docx-p">{trimmed}</p>;
      })}
    </div>
  );
}

/**
 * Renders PPTX presentation slide preview.
 */
function PptxRichPreview({ text }) {
  const [activeSlide, setActiveSlide] = useState(0);

  const slides = useMemo(() => {
    if (!text) return [];
    if (!text.includes('## Slide')) {
      return [{ slideNumber: 1, title: 'Slide 1', raw: text }];
    }
    const parts = text.split(/(?=## Slide\s*\d+:)/);
    const result = [];
    for (const part of parts) {
      const match = /^## Slide\s*(\d+):\s*(.*)$/m.exec(part);
      if (match) {
        const slideNumber = parseInt(match[1], 10);
        const title = match[2].trim();
        const body = part.replace(/^## Slide.*$/m, '').trim();

        // Extract speaker notes
        const notesMatch = /> \*\*Speaker Notes:\*\*\s*(.*)$/m.exec(body);
        const notes = notesMatch ? notesMatch[1] : null;
        const cleanBody = body.replace(/> \*\*Speaker Notes:.*$/m, '').trim();

        // Extract bullet lines
        const lines = cleanBody.split('\n').filter(Boolean);
        const bullets = [];
        for (const line of lines) {
          const bulletMatch = /^(\s*)-\s+(.*)$/.exec(line);
          if (bulletMatch) {
            const indent = bulletMatch[1].length;
            bullets.push({ text: bulletMatch[2], level: Math.floor(indent / 2) });
          }
        }
        result.push({ slideNumber, title, bullets, notes, raw: cleanBody });
      }
    }
    return result;
  }, [text]);

  if (slides.length === 0) {
    return <pre>{text}</pre>;
  }

  const current = slides[activeSlide] || slides[0];

  return (
    <div className="fm-pptx-preview">
      {slides.length > 1 ? (
        <div className="fm-sheet-tabs" role="tablist" aria-label="Slides">
          {slides.map((s, idx) => (
            <button
              key={s.slideNumber || idx}
              type="button"
              role="tab"
              aria-selected={activeSlide === idx}
              className={`fm-sheet-tab ${activeSlide === idx ? 'active' : ''}`}
              onClick={() => setActiveSlide(idx)}
            >
              <span>Slide {s.slideNumber}</span>
              <span className="fm-filter-count">{s.bullets.length} bullets</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="fm-slide-card">
        <div className="fm-slide-head">
          <span className="fm-slide-badge">SLIDE {current.slideNumber}</span>
          <b className="fm-slide-title">{current.title}</b>
        </div>

        {current.bullets.length > 0 ? (
          <ul className="fm-slide-bullets">
            {current.bullets.map((b, bIdx) => (
              <li
                key={bIdx}
                className="fm-bullet-item"
                style={{ paddingLeft: `${b.level * 16}px` }}
              >
                <span className="fm-bullet-dot">●</span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>{current.raw || 'No slide text content.'}</p>
        )}

        {current.notes ? (
          <div className="fm-slide-notes">
            <b>Speaker Notes:</b> {current.notes}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Unified multi-format document preview component.
 */
function DocumentPreview({ file, previewData }) {
  const [showRaw, setShowRaw] = useState(false);
  const text = previewData?.text || '';
  const kind = resolvePreviewKind(file.mime_type, file.name);

  // If format is PDF or simple plain text with no structure, or if raw view toggled
  if (showRaw) {
    return (
      <div className="fm-preview-content">
        <div className="fm-preview-toolbar">
          <span className="fm-preview-stats">Raw text extract</span>
          <button type="button" className="fm-preview-toggle-btn" onClick={() => setShowRaw(false)}>
            Formatted View
          </button>
        </div>
        <pre>{text}</pre>
      </div>
    );
  }

  const isSpreadsheet = kind === 'spreadsheet' || (file.name || '').match(/\.(xlsx?)$/i);
  const isCsv = kind === 'csv' || (file.name || '').match(/\.(csv|tsv)$/i);
  const isWord = kind === 'word' || (file.name || '').endsWith('.docx');
  const isPres = (file.name || '').endsWith('.pptx');

  if (isSpreadsheet) {
    return (
      <div className="fm-preview-content">
        <div className="fm-preview-toolbar">
          <span className="fm-preview-stats">Excel Spreadsheet Preview</span>
          <button type="button" className="fm-preview-toggle-btn" onClick={() => setShowRaw(true)}>
            Raw View
          </button>
        </div>
        <XlsxRichPreview text={text} />
      </div>
    );
  }

  if (isCsv) {
    return (
      <div className="fm-preview-content">
        <div className="fm-preview-toolbar">
          <span className="fm-preview-stats">CSV Tabular Preview</span>
          <button type="button" className="fm-preview-toggle-btn" onClick={() => setShowRaw(true)}>
            Raw View
          </button>
        </div>
        <CsvRichPreview text={text} />
      </div>
    );
  }

  if (isWord) {
    return (
      <div className="fm-preview-content">
        <div className="fm-preview-toolbar">
          <span className="fm-preview-stats">Word Document Preview</span>
          <button type="button" className="fm-preview-toggle-btn" onClick={() => setShowRaw(true)}>
            Raw View
          </button>
        </div>
        <DocxRichPreview text={text} />
      </div>
    );
  }

  if (isPres) {
    return (
      <div className="fm-preview-content">
        <div className="fm-preview-toolbar">
          <span className="fm-preview-stats">Presentation Deck Preview</span>
          <button type="button" className="fm-preview-toggle-btn" onClick={() => setShowRaw(true)}>
            Raw View
          </button>
        </div>
        <PptxRichPreview text={text} />
      </div>
    );
  }

  // Standard/PDF/Text preview
  return (
    <div className="fm-preview-content">
      <pre>{text}</pre>
    </div>
  );
}

export default function FileManager() {
  const { setTab, toast } = useApp();
  const chat = useChat();

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [storage, setStorage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const fileInputRef = useRef(null);

  // Load files and storage stats
  const refresh = useCallback(async () => {
    try {
      const [list, usage] = await Promise.all([
        listFiles({ filter: 'all' }),
        getStorageUsage().catch(() => null),
      ]);
      setFiles(list || []);
      if (usage) setStorage(usage);
    } catch (err) {
      toast(normalizeFileManagerError(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Handle file upload
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 52_428_800) {
      toast('File exceeds the 50 MB upload limit.');
      return;
    }

    setUploading(true);
    setUploadFileName(file.name);
    setUploadProgress(10);

    try {
      await uploadFile(file, (p) => {
        setUploadProgress(p.percent || 50);
      });
      toast(`Uploaded ${file.name}`);
      await refresh();
    } catch (err) {
      toast(normalizeFileManagerError(err));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadFileName('');
    }
  };

  // Ask AI about this file
  const handleAskAi = (file) => {
    chat.attach({
      key: `user_file_${file.id}`,
      type: 'user_file',
      file_id: file.id,
      title: file.name,
      label: file.name,
      name: file.name,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      text: file.preview_text || `[Document Attachment: ${file.name}]`,
      icon: 'doc',
    });
    setTab('ask');
    toast(`Attached "${file.name}" to Ask AI`);
  };

  // Preview file
  const handlePreview = async (file) => {
    setPreviewFile(file);
    setPreviewLoading(true);
    try {
      const data = await getFilePreview(file.id);
      setPreviewData(data);
    } catch (err) {
      toast(normalizeFileManagerError(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewData(null);
  };

  // Retry or start AI indexing
  const handleRetryIndex = async (file) => {
    try {
      toast(`Initiating AI indexing for "${file.name}"…`);
      await retryIndexing(file.id);
      await refresh();
      toast(`AI indexing started for "${file.name}"`);
    } catch (err) {
      toast(normalizeFileManagerError(err));
    }
  };

  const handleIndexForAi = async (file) => {
    try {
      toast(`Indexing "${file.name}" for AI…`);
      await indexForAi(file.id);
      await refresh();
      toast(`AI indexing queued for "${file.name}"`);
    } catch (err) {
      toast(normalizeFileManagerError(err));
    }
  };

  // Delete file
  const handleDelete = async (fileId) => {
    try {
      await deleteFile(fileId);
      toast('File moved to trash');
      setDeleteConfirmId(null);
      await refresh();
    } catch (err) {
      toast(normalizeFileManagerError(err));
    }
  };

  // Filtered files
  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (f.deleted_at) return false;
      if (q && !f.name.toLowerCase().includes(q)) return false;

      if (filter === 'pdf') {
        return isPdfMimeType(f.mime_type) || f.name.toLowerCase().endsWith('.pdf');
      }
      if (filter === 'ready_for_ai') {
        return f.index_status === 'indexed' || f.index_status === 'ready_for_ai';
      }
      if (filter === 'processing') {
        return ['indexing_queued', 'indexing_extracting', 'indexing_chunking', 'processing'].includes(f.index_status) || f.upload_status === 'uploading';
      }
      if (filter === 'failed') {
        return f.index_status === 'indexing_failed' || f.index_status === 'failed' || f.upload_status === 'upload_failed';
      }
      return true;
    });
  }, [files, search, filter]);

  // Tab counts
  const counts = useMemo(() => {
    const nonDeleted = files.filter((f) => !f.deleted_at);
    return {
      all: nonDeleted.length,
      pdf: nonDeleted.filter((f) => isPdfMimeType(f.mime_type) || f.name.toLowerCase().endsWith('.pdf')).length,
      ready_for_ai: nonDeleted.filter((f) => f.index_status === 'indexed' || f.index_status === 'ready_for_ai').length,
      processing: nonDeleted.filter((f) => ['indexing_queued', 'indexing_extracting', 'indexing_chunking', 'processing'].includes(f.index_status) || f.upload_status === 'uploading').length,
      failed: nonDeleted.filter((f) => f.index_status === 'indexing_failed' || f.index_status === 'failed' || f.upload_status === 'upload_failed').length,
    };
  }, [files]);

  return (
    <div className="view push fm-view">
      <Header back title="File Manager" sub="STORAGE & AI INDEXING" />

      <div className="body">
        {/* Storage Bar Card */}
        <div className="fm-storage-card">
          <div className="fm-storage-head">
            <span className="k">STORAGE USAGE</span>
            <span className="pill grey">{storage?.plan ? `${storage.plan.toUpperCase()} PLAN` : '500 MB QUOTA'}</span>
          </div>
          <div className="fm-storage-figures">
            <b>{storage ? storage.formattedUsed : '0 B'}</b>
            <span>of {storage ? storage.formattedQuota : '500 MB'} used</span>
          </div>
          <div className="fm-storage-bar">
            <i
              style={{
                width: `${storage?.percentUsed ?? 5}%`,
                backgroundColor: (storage?.percentUsed || 0) > 90 ? 'var(--red)' : (storage?.percentUsed || 0) > 75 ? 'var(--amber)' : 'var(--accent)',
              }}
            />
          </div>
        </div>

        {/* Action Bar: Search & Upload CTA */}
        <div className="fm-actions-bar">
          <div className="fm-search-wrap">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search files"
            />
            {search ? (
              <button type="button" className="fm-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="pbtn sm fm-upload-cta"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Upload File"
          >
            <Icon name="upload" />
            <span>Upload</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.pptx,application/pdf"
            style={{ display: 'none' }}
          />
        </div>

        {/* Upload in progress banner */}
        {uploading ? (
          <div className="fm-upload-indicator">
            <div className="fm-upload-info">
              <span className="fm-upload-name"><Icon name="upload" /> {uploadFileName}</span>
              <span className="fm-upload-pct">{uploadProgress}%</span>
            </div>
            <div className="fm-upload-bar">
              <i style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : null}

        {/* Filter Pills */}
        <div className="fm-filter-scroll">
          {FILTER_TABS.map((tab) => {
            const count = counts[tab.id] ?? 0;
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`fm-filter-pill ${active ? 'active' : ''}`}
                onClick={() => setFilter(tab.id)}
                aria-pressed={active}
              >
                <span>{tab.label}</span>
                <span className="fm-filter-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* File Cards List */}
        <div className="fm-list">
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <Spinner label="Loading stored files…" />
            </div>
          ) : filteredFiles.length > 0 ? (
            filteredFiles.map((file) => {
              const isPdf = isPdfMimeType(file.mime_type) || file.name.toLowerCase().endsWith('.pdf');
              const isReady = file.index_status === 'indexed' || file.index_status === 'ready_for_ai';
              const isFailed = file.index_status === 'indexing_failed' || file.index_status === 'failed';
              const isProcessing = ['indexing_queued', 'indexing_extracting', 'indexing_chunking', 'processing'].includes(file.index_status);
              const isNotIndexed = file.index_status === 'not_indexed' && isPdf;
              const formatLabel = getFormatMetadataLabel(file);

              return (
                <div key={file.id} className="fm-card">
                  <div className="fm-card-main">
                    <FileIcon file={file} />
                    <div className="fm-card-info">
                      <div className="fm-card-title-row">
                        <b className="fm-card-title" title={file.name}>{file.name}</b>
                      </div>
                      <div className="fm-card-meta">
                        <span>{formatBytes(file.size_bytes)}</span>
                        <span>·</span>
                        <span>{formatRelativeDate(file.created_at)}</span>
                        {formatLabel ? (
                          <>
                            <span>·</span>
                            <span>{formatLabel}</span>
                          </>
                        ) : null}
                      </div>
                      <div className="fm-card-badge-row">
                        <StatusBadge file={file} />
                      </div>
                      {file.index_error ? (
                        <div className="fm-card-error">
                          {file.index_error}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="fm-card-actions">
                    {isReady ? (
                      <button
                        type="button"
                        className="fm-act-btn ask-ai"
                        onClick={() => handleAskAi(file)}
                        title="Ask AI about this file"
                      >
                        <Icon name="sparkle" size={15} />
                        <span>Ask AI</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="fm-act-btn"
                      onClick={() => handlePreview(file)}
                      title="Preview document"
                    >
                      <Icon name="doc" size={15} />
                      <span>Preview</span>
                    </button>

                    {isFailed ? (
                      <button
                        type="button"
                        className="fm-act-btn retry"
                        onClick={() => handleRetryIndex(file)}
                        title="Retry AI Indexing"
                      >
                        <Icon name="rerun" size={15} />
                        <span>Retry</span>
                      </button>
                    ) : null}

                    {isNotIndexed && !isProcessing ? (
                      <button
                        type="button"
                        className="fm-act-btn index"
                        onClick={() => handleIndexForAi(file)}
                        title="Index for AI search"
                      >
                        <Icon name="sparkle" size={15} />
                        <span>Index</span>
                      </button>
                    ) : null}

                    {deleteConfirmId === file.id ? (
                      <div className="fm-delete-confirm">
                        <span>Delete?</span>
                        <button type="button" className="fm-confirm-yes" onClick={() => handleDelete(file.id)}>Yes</button>
                        <button type="button" className="fm-confirm-no" onClick={() => setDeleteConfirmId(null)}>No</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="fm-act-btn danger"
                        onClick={() => setDeleteConfirmId(file.id)}
                        aria-label={`Delete ${file.name}`}
                        title="Delete file"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <Empty
              title={search ? 'No matching files' : filter !== 'all' ? `No files in "${filter}"` : 'No stored files yet'}
              action={
                <button
                  type="button"
                  className="pbtn sm sec"
                  onClick={() => {
                    if (search || filter !== 'all') {
                      setSearch('');
                      setFilter('all');
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  {search || filter !== 'all' ? 'Reset Filters' : 'Upload your first file'}
                </button>
              }
            >
              {search
                ? `No documents matching "${search}" were found.`
                : 'Upload private contracts, petitions, or reports to store them securely and query them with AI.'}
            </Empty>
          )}
        </div>
      </div>

      {/* File Preview Modal Sheet */}
      {previewFile ? (
        <div className="fm-modal-backdrop" onClick={closePreview}>
          <div className="fm-modal-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="fm-modal-handle" />
            <div className="fm-modal-header">
              <div className="fm-modal-title-col">
                <b>{previewFile.name}</b>
                <span>{formatBytes(previewFile.size_bytes)} · {formatRelativeDate(previewFile.created_at)}</span>
              </div>
              <button type="button" className="ib" onClick={closePreview} aria-label="Close Preview">
                <Icon name="close" />
              </button>
            </div>

            <div className="fm-modal-body">
              <div className="fm-modal-status-strip">
                <StatusBadge file={previewFile} />
                {getFormatMetadataLabel(previewFile) ? <span>{getFormatMetadataLabel(previewFile)}</span> : null}
              </div>

              {previewLoading ? (
                <div style={{ padding: '30px 0', textAlign: 'center' }}>
                  <Spinner label="Loading preview…" />
                </div>
              ) : previewData?.text ? (
                <DocumentPreview file={previewFile} previewData={previewData} />
              ) : (
                <div className="fm-preview-fallback">
                  <p>Binary preview is ready.</p>
                  {previewData?.url ? (
                    <a
                      href={previewData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pbtn sm"
                      style={{ marginTop: 12 }}
                    >
                      <Icon name="download" /> Open / Download File
                    </a>
                  ) : (
                    <p style={{ color: 'var(--muted)', fontSize: 13 }}>Preview text is unavailable for this format.</p>
                  )}
                </div>
              )}
            </div>

            <div className="fm-modal-footer">
              {(previewFile.index_status === 'indexed' || previewFile.index_status === 'ready_for_ai') ? (
                <button
                  type="button"
                  className="pbtn"
                  onClick={() => {
                    closePreview();
                    handleAskAi(previewFile);
                  }}
                >
                  <Icon name="sparkle" /> Ask AI about this file
                </button>
              ) : (
                <button type="button" className="pbtn sec" onClick={closePreview}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <TabBar />
    </div>
  );
}
