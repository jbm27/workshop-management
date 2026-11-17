import {
  LINE_PROGRESS_STAGES,
  isStageDone,
  stageDoneAt,
  stageDoneBy,
  lineProgressPercent,
  jobProgressSummary,
  formatStageDate,
} from '../utils/lineProgress';

function progressTone(percent) {
  if (percent >= 100) return 'done';
  if (percent > 0) return 'active';
  return 'idle';
}

/** Collapsed view of one line's tracker: mini bar + percentage + chevron. Click to open the steps. */
export function LineProgressToggle({ item, open, onToggle, controlsId }) {
  const percent = lineProgressPercent(item);
  const tone = progressTone(percent);
  return (
    <button
      type="button"
      className={`line-progress-toggle tone-${tone}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controlsId}
      title={open ? 'Hide progress' : 'Show progress'}
    >
      <span className="line-progress-mini" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="line-progress-pct">{percent}%</span>
      <span className={`line-progress-chevron${open ? ' open' : ''}`} aria-hidden="true">▾</span>
    </button>
  );
}

/**
 * Expanded tracker: the five stages as tick boxes, delivery-tracker style.
 * `canTick(stageKey)` decides which boxes this viewer may change; `onTick(stageKey, done)` saves.
 */
export function LineProgressSteps({ id, item, canTick, onTick, busy, showWho = false }) {
  return (
    <ol className="line-progress-steps" id={id}>
      {LINE_PROGRESS_STAGES.map((stage) => {
        const done = isStageDone(item, stage.key);
        const editable = !busy && canTick?.(stage.key, done);
        const at = stageDoneAt(item, stage.key);
        const by = showWho ? stageDoneBy(item, stage.key) : null;
        const inputId = `${id}-${stage.key}`;
        return (
          <li key={stage.key} className={`line-progress-step${done ? ' done' : ''}`}>
            <span className="line-progress-dot" aria-hidden="true">{done ? '✓' : ''}</span>
            <label htmlFor={inputId} className={editable ? 'editable' : undefined}>
              <input
                id={inputId}
                type="checkbox"
                checked={done}
                disabled={!editable}
                onChange={(e) => onTick?.(stage.key, e.target.checked)}
              />
              <span className="line-progress-label">{stage.label}</span>
            </label>
            <span className="line-progress-meta">
              {done ? [formatStageDate(at), by].filter(Boolean).join(' · ') || 'Done' : stage.who}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Slim whole-job completion bar. Renders nothing when no lines are tracked. */
export function JobProgressBar({ items }) {
  const summary = jobProgressSummary(items);
  if (!summary) return null;
  const tone = progressTone(summary.percent);
  return (
    <div className={`job-progress tone-${tone}`}>
      <div className="job-progress-head">
        <span>Job progress</span>
        <span>
          <strong>{summary.percent}%</strong>
          <span className="job-progress-sub">
            {' · '}
            {summary.complete} of {summary.lines} {summary.lines === 1 ? 'item' : 'items'} complete
          </span>
        </span>
      </div>
      <div
        className="job-progress-track"
        role="progressbar"
        aria-label="Job progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={summary.percent}
      >
        <span style={{ width: `${summary.percent}%` }} />
      </div>
    </div>
  );
}
