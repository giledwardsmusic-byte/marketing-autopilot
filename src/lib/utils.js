export const nowIso = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${crypto.randomUUID()}`;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

export async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export function parseJSON(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

export function startOfWeekISO(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function endOfWeekISO(start) {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

export function addDaysISO(iso, days, hhmm = '12:00') {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  const [h, m] = hhmm.split(':').map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}

export async function sha256Hex(input) {
  const bytes = input instanceof ArrayBuffer ? input : new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch { return null; }
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
