import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiRequestError } from '../lib/api';

/** Small shared building blocks so every screen has the same states and spacing (spec §8.4). */

export function PageHeader({ title, actions, description }: { title: string; actions?: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
      <div className="min-w-0">
        <h1 className="text-[1.65rem] font-bold leading-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-slate-200 bg-white">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          {title && <h2 className="text-base font-bold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  // The orange is kept for the main action of a screen; everything else stays green or neutral.
  primary: 'bg-action-600 text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.18)] hover:bg-action-700',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50',
  danger: 'bg-danger-600 text-white hover:opacity-90',
  ghost: 'text-accent-700 hover:bg-accent-50',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
    />
  );
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-100 disabled:bg-slate-100';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

/** Translates an API error code (errors.<CODE>), falling back to the generic message. */
export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const code = error instanceof ApiRequestError ? error.code : 'GENERIC';
  return (
    <p role="alert" className="rounded-md border-l-4 border-danger-600 bg-red-50 px-3 py-2 text-sm text-danger-600">
      {t(`errors.${code}`, { defaultValue: t('common.errorGeneric') })}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="py-6 text-center text-sm text-slate-500">{t('common.loading')}</p>;
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-accent-50 text-accent-700',
    amber: 'bg-action-50 text-action-700',
    red: 'bg-red-50 text-danger-600',
    blue: 'bg-sky-50 text-sky-800',
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b-2 border-slate-200 text-slate-500">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-5 py-2 text-xs font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-slate-100 [&>tr:hover]:bg-slate-50 [&>tr:last-child]:border-0 [&_td]:px-5 [&_td]:py-2.5">{children}</tbody>
      </table>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
      {items.map((i) => (
        <button
          key={i.key}
          role="tab"
          type="button"
          aria-selected={value === i.key}
          onClick={() => onChange(i.key)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
            value === i.key ? 'border-action-600 font-semibold text-slate-900' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
          }`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
