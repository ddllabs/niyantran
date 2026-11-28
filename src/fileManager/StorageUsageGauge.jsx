/**
 * Feature F341: Capability 5 — Storage Usage Gauge Component.
 *
 * Renders real-time storage quota consumption, percentage bar, and subscription plan badge
 * ('free', 'plus', 'pro', 'max') according to normative limits.
 */

import { HardDrive, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatBytes } from './fileManagerService.js';

/**
 * @param {{
 *   quota?: {
 *     plan: string,
 *     quota_bytes: number,
 *     used_bytes: number,
 *     remaining_bytes: number,
 *     is_lapsed?: boolean,
 *     unavailable?: boolean,
 *     error?: string | null
 *   },
 *   compact?: boolean,
 *   onRetry?: () => void
 * }} props
 */
export default function StorageUsageGauge({ quota, compact = false, onRetry }) {
  const isUnavailable = !!quota?.unavailable;
  const plan = quota?.plan || 'free';
  const used = quota?.used_bytes || 0;
  const total = quota?.quota_bytes || 524_288_000; // default 500 MB
  const isLapsed = !!quota?.is_lapsed;

  const percentUsed = isUnavailable ? 0 : Math.min(100, Math.round((used / total) * 100));

  let variant = 'normal';
  if (isUnavailable) {
    variant = 'unavailable';
  } else if (percentUsed >= 95) {
    variant = 'danger';
  } else if (percentUsed >= 80) {
    variant = 'warning';
  }

  const planLabel = `${plan.toUpperCase()}${isLapsed ? ' (LAPSED)' : ''}`;

  return (
    <div className="storage-gauge" aria-label="Storage capacity gauge">
      <div className="storage-gauge-header">
        <span className="storage-gauge-title">
          <HardDrive size={14} aria-hidden="true" />
          <span>Storage</span>
        </span>
        <span className={`storage-plan-badge ${plan}`}>{planLabel}</span>
      </div>

      <div
        className="storage-progress-bar"
        role="progressbar"
        aria-valuenow={percentUsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={isUnavailable ? 'Storage usage unavailable' : `${percentUsed}% storage used`}
      >
        <div
          className={`storage-progress-fill ${variant}`}
          style={{ width: `${percentUsed}%` }}
        />
      </div>

      <div className="storage-gauge-labels">
        <span>{isUnavailable ? 'Unavailable' : `${formatBytes(used)} used`}</span>
        <span>{formatBytes(total)}</span>
      </div>

      {!compact && isUnavailable && (
        <div className="storage-gauge-warning" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />
            {quota?.error || 'Storage usage is temporarily unavailable. Please retry.'}
          </div>
          {onRetry && (
            <button
              type="button"
              className="fm-btn fm-btn-secondary"
              onClick={onRetry}
              style={{ alignSelf: 'flex-start', padding: '3px 8px', fontSize: 11 }}
            >
              <RefreshCw size={11} style={{ marginRight: 4 }} />
              Retry
            </button>
          )}
        </div>
      )}

      {!compact && !isUnavailable && percentUsed >= 80 && (
        <div className="storage-gauge-warning" role="alert">
          <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />
          {percentUsed >= 100
            ? 'Storage quota exceeded. New uploads are blocked until items are deleted from Trash.'
            : 'Storage near limit. Move unneeded files to Trash and empty Trash to reclaim space.'}
        </div>
      )}
    </div>
  );
}
