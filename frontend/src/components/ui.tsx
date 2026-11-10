import type { CSSProperties, ReactNode } from 'react';

export function Icon({ name, size = 18, style, className }: {
  name: string; size?: number; style?: CSSProperties; className?: string;
}) {
  return (
    <span aria-hidden="true" className={`icon ${className ?? ''}`} style={{ fontSize: size, ...style }}>{name}</span>
  );
}

/** A button plus an anchored panel. Opening/closing is owned by the parent so only one is open at a time. */
export function Dropdown({ open, onToggle, trigger, children, align = 'left', width, className, triggerClassName, label }: {
  open: boolean;
  onToggle(): void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: number;
  className?: string;
  triggerClassName?: string;
  label?: string;
}) {
  return (
    <div className={`dropdown ${className ?? ''}`}>
      <button type="button" className={triggerClassName} onClick={onToggle} aria-expanded={open} aria-label={label}>
        {trigger}
      </button>
      {open && (
        <div className={`popover popover-${align}`} style={width ? { width } : undefined} role="dialog">
          {children}
        </div>
      )}
    </div>
  );
}

/** Each option is [value, label] or [value, label, leading icon name]. */
export function OptionList<T extends string>({ options, value, onPick }: {
  options: [T, string, string?][]; value: T; onPick(value: T): void;
}) {
  return (
    <div className="option-list">
      {options.map(([key, label, icon]) => (
        <button type="button" key={key} className={`option ${key === value ? 'is-selected' : ''}`} onClick={() => onPick(key)}>
          <span className="option-label">{icon && <Icon name={icon} className="muted" />}{label}</span>
          {key === value && <Icon name="check" className="accent" />}
        </button>
      ))}
    </div>
  );
}

export function ChipButton({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className={`chip ${active ? 'is-active' : ''}`} onClick={onClick}>{children}</button>
  );
}

export function PrimaryButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return <button type="button" className="primary-button" onClick={onClick}>{children}</button>;
}

/** Diameter of a DualRange thumb, in px; keep in step with styles.css. */
const THUMB_PX = 18;

/**
 * Where `value` sits along a range input of the full width, as a CSS length. A native
 * thumb's centre travels from half a thumb in from each end, not from edge to edge.
 */
export function sliderPosition(value: number, min: number, max: number): string {
  const fraction = max > min ? (value - min) / (max - min) : 0;
  return `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${fraction.toFixed(4)})`;
}

/** Two thumbs on one track, for picking an inclusive [low, high] range of whole numbers. */
export function DualRange({ min, max, low, high, onChange, lowLabel, highLabel, valueText, ticks = [] }: {
  min: number;
  max: number;
  low: number;
  high: number;
  onChange(low: number, high: number): void;
  lowLabel: string;
  highLabel: string;
  /** Read-out for screen readers, e.g. a date for a day index. */
  valueText?(value: number): string;
  /** Values to mark on the track, such as month boundaries. */
  ticks?: number[];
}) {
  return (
    <div className="dual-range">
      <div className="dual-range-track" />
      <div className="dual-range-fill" style={{
        left: sliderPosition(low, min, max),
        width: `calc((100% - ${THUMB_PX}px) * ${max > min ? ((high - low) / (max - min)).toFixed(4) : 0})`,
      }} />
      {ticks.map(tick => (
        <div key={tick} className="dual-range-tick" style={{ left: sliderPosition(tick, min, max) }} />
      ))}
      <input type="range" min={min} max={max} value={low} aria-label={lowLabel}
        aria-valuetext={valueText?.(low)}
        // When both thumbs sit at the right end, the low one must be on top to be draggable.
        className={low >= max ? 'is-top' : ''}
        onChange={e => onChange(Math.min(Number(e.target.value), high), high)} />
      <input type="range" min={min} max={max} value={high} aria-label={highLabel}
        aria-valuetext={valueText?.(high)}
        onChange={e => onChange(low, Math.max(Number(e.target.value), low))} />
    </div>
  );
}
