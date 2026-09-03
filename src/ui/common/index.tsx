import type { ReactNode } from 'react';
import { useUiStore } from '../../store/uiStore';

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  title,
  active,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  active?: boolean;
  testId?: string;
}) {
  const base =
    'inline-flex items-center gap-1 rounded border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs';
  const variants = {
    default: active
      ? 'border-coral bg-coral-50 text-coral'
      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    primary: 'border-coral bg-coral text-white hover:opacity-90',
    ghost: active
      ? 'border-transparent bg-coral-50 text-coral'
      : 'border-transparent bg-transparent text-gray-600 hover:bg-gray-100',
    danger: 'border-gray-300 bg-white text-coral hover:bg-coral-50',
  }[variant];
  return (
    <button
      type="button"
      className={`${base} ${sizes} ${variants}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[#FF3B30]"
        data-testid={testId}
      />
      {label}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  testId?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-gray-700">
      <span className="shrink-0">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right font-mono text-[11px]"
          data-testid={testId}
        />
        {suffix ? <span className="w-6 text-gray-400">{suffix}</span> : null}
      </span>
    </label>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-gray-700">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[#FF3B30]"
      />
      <span className="w-10 text-right font-mono text-gray-500">{value.toFixed(2)}</span>
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-gray-300 bg-gray-50 px-1 font-mono text-[10px] text-gray-500">
      {children}
    </kbd>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
      <h2 className="text-[11px] font-bold tracking-wide text-coral uppercase">{children}</h2>
      {right}
    </div>
  );
}

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-sm rounded border px-3 py-2 text-left text-xs shadow-sm ${
            t.severity === 'error' || t.severity === 'fatal'
              ? 'border-coral bg-coral-50 text-coral'
              : 'border-gray-300 bg-white text-gray-700'
          }`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-gray-500">{title}</p>
      {children}
    </div>
  );
}
