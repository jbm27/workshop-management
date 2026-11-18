import {
  LINE_PROGRESS_STAGES,
  isStageDone,
  stageInfo,
  lineProgressPercent,
  jobProgressSummary,
  formatStageDate,
} from '../utils/lineProgress';

function progressTone(percent) {
  if (percent >= 100) return 'done';
  if (percent > 0) return 'active';
  return 'idle';
}

/** Collapsed view of one line's tracker: mini bar + percentage + chevron. Click to open the tick boxes. */
export function LineProgressToggle({ item, open, onToggle, controlsId }) {
  const percent = lineProgressPercent(item);
  const tone = progressTone(percent);
  return (
    <button
      type="button"
      className={`lp-toggle lp-tone-${tone}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controlsId}
      title={open ? 'Hide progress' : 'Show progress'}
    >
      <span className="lp-mini" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="lp-pct">{percent}%</span>
      <span className={`lp-chevron${open ? ' open' : ''}`} aria-hidden="true">▾</span>
    </button>
  );
}

/**
 * Expanded tracker: the five stages as tick boxes, delivery-tracker style.
 * `canTick(stageKey, stage)` decides which boxes this viewer may change; `onTick(stageKey, done)` saves.
 * `showWho` (staff) adds who ticked it, and notes stages filled in from the LPO/IPR.
 */
export function LineProgressSteps({ id, item, canTick, onTick, busy, showWho = false, children }) {
  return (
    <div className="lp-panel" id={id}>
      <ol className="lp-steps">
        {LINE_PROGRESS_STAGES.map((stage) => {
          const info = stageInfo(item, stage.key) || {};
          const done = isStageDone(item, stage.key);
          const editable = !busy && !!canTick?.(stage.key, info);
          const inputId = `${id}-${stage.key}`;
          const fromRecords = showWho && info.auto && stage.key !== 'approved';
          const meta = done
            ? [formatStageDate(info.at), showWho ? info.by : null, fromRecords ? 'from LPO/IPR' : null]
                .filter(Boolean)
                .join(' · ') || 'Done'
            : stage.who;
          return (
            <li key={stage.key} className={`lp-step${done ? ' done' : ''}`}>
              <span className="lp-dot" aria-hidden="true">{done ? '✓' : ''}</span>
              <label htmlFor={inputId} className={editable ? 'editable' : undefined}>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={done}
                  disabled={!editable}
                  onChange={(e) => onTick?.(stage.key, e.target.checked)}
                />
                <span className="lp-label">{stage.label}</span>
              </label>
              <span className="lp-meta">{meta}</span>
            </li>
          );
        })}
      </ol>
      {children}
    </div>
  );
}

/**
 * "Vehicle tested": one tick for the whole job, shown next to the quote total.
 * Staff pass `onChange` to make it tickable; customers see it read-only.
 */
export function VehicleTestedTick({ at, by, onChange, busy, id = 'vehicle-tested' }) {
  const done = !!at;
  const editable = !!onChange && !busy;
  return (
    <div className={`lp-vt${done ? ' done' : ''}`}>
      <label htmlFor={id} className={editable ? 'editable' : undefined}>
        <input
          id={id}
          type="checkbox"
          checked={done}
          disabled={!editable}
          onChange={(e) => onChange?.(e.target.checked)}
        />
        <span className="lp-vt-label">Vehicle tested</span>
      </label>
      <span className="lp-vt-meta">
        {done ? [formatStageDate(at), by].filter(Boolean).join(' · ') : 'Not yet — final road test after the work'}
      </span>
    </div>
  );
}

/** Slim whole-job completion bar (line stages + job tasks + vehicle tested). Renders nothing when there is nothing to track. */
export function JobProgressBar({ items, tasks, vehicleTested = false }) {
  const summary = jobProgressSummary(items, tasks, vehicleTested);
  if (!summary) return null;
  const tone = progressTone(summary.percent);
  const bits = [];
  if (summary.lines) bits.push(`${summary.complete} of ${summary.lines} ${summary.lines === 1 ? 'item' : 'items'} complete`);
  if (summary.tasks) bits.push(`${summary.tasksDone} of ${summary.tasks} ${summary.tasks === 1 ? 'task' : 'tasks'} done`);
  bits.push(summary.vehicleTested ? 'vehicle tested ✓' : 'not yet tested');
  return (
    <div className={`lp-job lp-tone-${tone}`}>
      <div className="lp-job-head">
        <span className="lp-job-title">Job progress</span>
        <span>
          <strong>{summary.percent}%</strong>
          {bits.length > 0 && <span className="lp-job-sub"> · {bits.join(' · ')}</span>}
        </span>
      </div>
      <div
        className="lp-job-track"
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
