export function activeOn(date: string, start: string, end: string | null, active: boolean) {
  return active && start <= date && (!end || end >= date);
}

export function clientReadiness(active: boolean, hasAgreement: boolean, hasRepresentative: boolean) {
  return !active ? "INACTIVE" : hasAgreement && hasRepresentative ? "READY" : "INCOMPLETE";
}

export type AgreementTermPreset = "ONE_YEAR" | "TWO_YEARS" | "CUSTOM";

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function agreementExpiryFromTerm(start: string, term: AgreementTermPreset) {
  if (!start || term === "CUSTOM") return "";
  const expiry = parseIsoDate(start);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + (term === "TWO_YEARS" ? 2 : 1));
  expiry.setUTCDate(expiry.getUTCDate() - 1);
  return toIsoDate(expiry);
}

export function agreementCountdown(expiry: string | null, asOf = new Date().toISOString().slice(0, 10)) {
  if (!expiry) return { expired: false, totalDays: null, years: 0, months: 0, days: 0, label: "Open-ended", tone: "neutral" as const };
  const start = parseIsoDate(asOf);
  const end = parseIsoDate(expiry);
  const dayMs = 86_400_000;
  const signedDays = Math.floor((end.getTime() - start.getTime()) / dayMs);
  if (signedDays < 0) return { expired: true, totalDays: Math.abs(signedDays), years: 0, months: 0, days: 0, label: `Expired ${Math.abs(signedDays)} day${Math.abs(signedDays) === 1 ? "" : "s"} ago`, tone: "expired" as const };
  if (signedDays === 0) return { expired: false, totalDays: 0, years: 0, months: 0, days: 0, label: "Expires today", tone: "urgent" as const };

  const cursor = new Date(start);
  let years = end.getUTCFullYear() - cursor.getUTCFullYear();
  const yearCursor = new Date(cursor);
  yearCursor.setUTCFullYear(yearCursor.getUTCFullYear() + years);
  if (yearCursor > end) years -= 1;
  cursor.setUTCFullYear(cursor.getUTCFullYear() + years);

  let months = (end.getUTCFullYear() - cursor.getUTCFullYear()) * 12 + end.getUTCMonth() - cursor.getUTCMonth();
  const monthCursor = new Date(cursor);
  monthCursor.setUTCMonth(monthCursor.getUTCMonth() + months);
  if (monthCursor > end) months -= 1;
  cursor.setUTCMonth(cursor.getUTCMonth() + months);
  const days = Math.floor((end.getTime() - cursor.getTime()) / dayMs);
  const parts = [years ? `${years} year${years === 1 ? "" : "s"}` : "", months ? `${months} month${months === 1 ? "" : "s"}` : "", days ? `${days} day${days === 1 ? "" : "s"}` : ""].filter(Boolean);
  const tone = signedDays <= 30 ? "urgent" as const : signedDays <= 90 ? "warning" as const : "healthy" as const;
  return { expired: false, totalDays: signedDays, years, months, days, label: `${parts.join(", ")} left`, tone };
}

export function agreementDisplayStatus(status: string, start: string, end: string | null, asOf = new Date().toISOString().slice(0, 10)) {
  if (status !== "ACTIVE") return status;
  if (start > asOf) return "UPCOMING";
  const countdown = agreementCountdown(end, asOf);
  if (countdown.expired) return "EXPIRED";
  if (countdown.totalDays !== null && countdown.totalDays <= 90) return "EXPIRING_SOON";
  return "ACTIVE";
}
