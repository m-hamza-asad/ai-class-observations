export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtBytes = (n: number | null | undefined) =>
  !n ? "—" : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;

/** Term whose date range contains today, else the most recent one. */
export function currentTerm<T extends { starts_on: string; ends_on: string }>(terms: T[]): T | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return terms.find((t) => t.starts_on <= today && today <= t.ends_on) ?? [...terms].sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0];
}
