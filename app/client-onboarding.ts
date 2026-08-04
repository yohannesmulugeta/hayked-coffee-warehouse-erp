export function activeOn(date: string, start: string, end: string | null, active: boolean) {
  return active && start <= date && (!end || end >= date);
}

export function clientReadiness(active: boolean, hasAgreement: boolean, hasRepresentative: boolean) {
  return !active ? "INACTIVE" : hasAgreement && hasRepresentative ? "READY" : "INCOMPLETE";
}
