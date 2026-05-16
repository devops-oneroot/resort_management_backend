/** Calendar day as YYYY-MM-DD (server local date). */
function dateKeyFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return todayKey();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayKey() {
  return dateKeyFromDate(new Date());
}

function toDateKeyInput(value) {
  if (!value) return todayKey();
  const raw = String(value).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return todayKey();
  return dateKeyFromDate(parsed);
}

function toDateTimeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

module.exports = {
  dateKeyFromDate,
  todayKey,
  toDateKeyInput,
  toDateTimeLabel,
};
