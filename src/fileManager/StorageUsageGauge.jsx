/**
 * Feature F341: Capability 5 — Storage Usage Gauge Component.
 *
 * Renders real-time storage quota consumption, percentage bar, and subscription plan badge
 * ('free', 'plus', 'pro', 'max') according to normative limits.
 */

import { HardDrive, AlertTriangle } from 'lucide-react';
import { formatBytes } from './fileManagerService.js';

/**
 * @param {{
 *   quota?: {
 *     plan: string,
 *     quota_bytes: number,
 *     used_bytes: number,
 *     remaining_bytes: number,
 *     is_lapsed?: boolean
 *   },
 *   compact?: boolean
 * }} props
 */
export default function StorageUsageGauge({ quota, compact = false }) {
  const plan = quota?.plan || 'free';
  const used = quota?.used_bytes || 0;
  const total = quota?.quota_bytes || 524_288_000; // default 500 MB
  const isLapsed = !!quota?.is_lapsed;

  const percentUsed = Math.min(100, Math.round((used / total) * 100));

  let variant = 'normal';
  if (percentUsed >= 95) {
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
        aria-label={`${percentUsed}% storage used`}
      >
        <div
          className={`storage-progress-fill ${variant}`}
          style={{ width: `${percentUsed}%` }}
        />
      </div>

      <div className="storage-gauge-labels">
        <span>{formatBytes(used)} used</span>
        <span>{formatBytes(total)}</span>
      </div>

      {!compact && percentUsed >= 80 && (
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
