/**
 * Feature F341: Capability 1 — Interactive Breadcrumb Navigation.
 *
 * Supports root navigation, multi-level hierarchy segments, overflow truncation past 4 levels,
 * and drag-and-drop targets for moving items into parent folders.
 */

import { useState } from 'react';
import { Home, ChevronRight, MoreHorizontal } from 'lucide-react';

/**
 * @param {{
 *   currentFolder?: { id: string | null, name: string, path?: string } | null,
 *   pathSegments?: Array<{ id: string | null, name: string }>,
 *   onNavigate: (folderId: string | null) => void,
 *   onDropOnFolder?: (e: React.DragEvent, folderId: string | null) => void
 * }} props
 */
export default function DriveBreadcrumbs({
  currentFolder = null,
  pathSegments = [],
  onNavigate,
  onDropOnFolder,
}) {
  const [showAll, setShowAll] = useState(false);

  // Build the complete list of breadcrumb items starting with Root
  const allSegments = [
    { id: null, name: 'All Files' },
    ...pathSegments,
  ];

  // Truncate if more than 4 levels unless showAll is toggled
  const needsTruncation = allSegments.length > 4 && !showAll;
  let visibleSegments = allSegments;

  if (needsTruncation) {
    // Keep root (0), ellipsis placeholder, second-to-last, and current (last)
    visibleSegments = [
      allSegments[0],
      { id: '__ellipsis__', name: '...' },
      allSegments[allSegments.length - 2],
      allSegments[allSegments.length - 1],
    ];
  }

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    onDropOnFolder?.(e, folderId);
  };

  return (
    <nav className="fm-breadcrumbs-bar" aria-label="Folder breadcrumbs">
      {visibleSegments.map((segment, index) => {
        const isLast = index === visibleSegments.length - 1;
        const isRoot = segment.id === null && index === 0;

        if (segment.id === '__ellipsis__') {
          return (
            <span key="ellipsis" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className="fm-crumb-btn"
                onClick={() => setShowAll(true)}
                title="Show full hierarchy"
                aria-label="Expand hidden parent folders"
              >
                <MoreHorizontal size={14} />
              </button>
              <ChevronRight size={13} className="fm-crumb-sep" aria-hidden="true" />
            </span>
          );
        }

        return (
          <span
            key={segment.id || 'root'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onDragOver={!isLast ? handleDragOver : undefined}
            onDrop={!isLast ? (e) => handleDrop(e, segment.id) : undefined}
          >
            {isLast ? (
              <span className="fm-crumb-current" aria-current="page">
                {isRoot && <Home size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />}
                {segment.name}
              </span>
            ) : (
              <button
                type="button"
                className="fm-crumb-btn"
                onClick={() => onNavigate(segment.id)}
              >
                {isRoot && <Home size={14} aria-hidden="true" />}
                <span>{segment.name}</span>
              </button>
            )}

            {!isLast && <ChevronRight size={13} className="fm-crumb-sep" aria-hidden="true" />}
          </span>
        );
      })}
    </nav>
  );
}
