import { useId } from 'react';
import './nyAiThinking.css';

/**
 * NyAiThinking (CR-13)
 * Reusable, accessible, polished AI thinking and loading state.
 * Renders [NyAI icon] NyAI is thinking... [animated processing indicator]
 */
export default function NyAiThinking({ model, lang = 'en', subtext }) {
  const uid = useId().replace(/:/g, '');
  const isHi = lang === 'hi';
  const label = isHi ? 'NyAI विचार कर रहा है' : 'NyAI is thinking';
  const displaySubtext = subtext || (model ? (isHi ? `${model} के साथ विश्लेषण जारी...` : `Analyzing with ${model}...`) : null);

  const gradId = `nyaiGrad_${uid}`;

  return (
    <div
      className="nyai-thinking-root"
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="nyai-thinking"
    >
      <div className="nyai-thinking-badge">
        <svg
          className="nyai-thinking-icon-svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#012ea1" />
              <stop offset="45%" stopColor="#38bdf8" />
              <stop offset="85%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>
          {/* Faceted neural diamond mark */}
          <path
            fill={`url(#${gradId})`}
            d="M12 2L15.2 8.8L22 12L15.2 15.2L12 22L8.8 15.2L2 12L8.8 8.8L12 2Z"
          />
        </svg>
      </div>

      <div className="nyai-thinking-content">
        <div className="nyai-thinking-header">
          <span className="nyai-thinking-text">{label}</span>
          <span className="nyai-thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {displaySubtext ? (
            <span className="nyai-thinking-subtext">· {displaySubtext}</span>
          ) : null}
        </div>
        <div className="nyai-thinking-wave" aria-hidden="true">
          <span className="nyai-wave-bar" />
          <span className="nyai-wave-bar" />
          <span className="nyai-wave-bar" />
          <span className="nyai-wave-bar" />
        </div>
      </div>
    </div>
  );
}
