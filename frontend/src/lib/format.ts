// Dates come from the API as UTC ISO strings. Intl formats them in the viewer's own
// timezone and language, so an Indian user sees IST without any extra code.

const dateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

// "in 5 minutes", "3 hours ago", "yesterday"
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds >= 0 ? 'in a few seconds' : 'just now';
  if (abs < 45 * 60) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 22 * 3600) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

// Value for <input type="datetime-local">: local time, no timezone, minute precision.
export function toDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
