export const BRIEFING_FIELDS = ["outlook", "macro", "flows", "sentiment", "onchain", "watch"];
export const BRIEFING_TTL_MS = 24 * 60 * 60_000;

export function validateBriefingReport(report) {
  if (!["zh", "en"].includes(report?.language)) return null;
  if (typeof report.checkedAt !== "string" || typeof report.generatedAt !== "string") return null;
  const checked = Date.parse(report.checkedAt);
  const generated = Date.parse(report.generatedAt);
  const expires = new Date(generated + BRIEFING_TTL_MS);
  if (!Number.isFinite(checked) || !Number.isFinite(expires.getTime()) || checked > generated) return null;
  const sections = {};
  for (const field of BRIEFING_FIELDS) {
    const value = report.sections?.[field];
    if (typeof value !== "string" || !value.trim() || value.length > 1500) return null;
    sections[field] = value.trim();
  }
  return {
    language: report.language, sections,
    checkedAt: new Date(checked).toISOString(), generatedAt: new Date(generated).toISOString(),
    expiresAt: expires.toISOString()
  };
}

export function briefingApiOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? value : null;
  } catch { return null; }
}
