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
