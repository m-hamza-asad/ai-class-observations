import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 ${className}`}>
      {title && <h2 className="mb-3 font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

const buttonVariants = {
  primary: "bg-blue-800 text-white hover:bg-blue-900 disabled:bg-blue-800/50",
  secondary: "border border-neutral-300 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800",
  danger: "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
  ghost: "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
    />
  );
}

const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 dark:border-neutral-700 dark:bg-neutral-900";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${field} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${field} ${props.className ?? ""}`} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

const badgeTones = {
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  green: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">{children}</p>;
}

export function FormMessage({ state }: { state?: { error?: string; ok?: string } | null }) {
  if (!state) return null;
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}
