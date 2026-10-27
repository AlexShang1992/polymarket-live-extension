// Only a narrow public-data projection crosses into the website.
export function projectState(raw) {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  if (!raw || !Number.isSafeInteger(raw.start) || raw.start % 300 !== 0 ||
      raw.end !== raw.start + 300 || raw.slug !== `btc-updown-5m-${raw.start}` ||
      !finite(raw.server_ms) || !finite(raw.price_event_ms) ||
      !finite(raw.price_received_ms) || !finite(raw.book_received_ms) || typeof raw.stream_id !== 'string' ||
      !Number.isSafeInteger(raw.revision)) return null;
  return {
    start: raw.start, end: raw.end, slug: raw.slug, server_ms: raw.server_ms,
    price: finite(raw.price) && raw.price > 0 ? raw.price : null,
    target: finite(raw.target) && raw.target > 0 ? raw.target : null,
    price_connected: raw.price_connected === true,
    price_event_ms: raw.price_event_ms, price_received_ms: raw.price_received_ms,
    price_lag_ms: finite(raw.price_lag_ms) ? raw.price_lag_ms : null,
    book_connected: raw.book_connected === true, book_received_ms: raw.book_received_ms,
    revision: raw.revision, stream_id: raw.stream_id
  };
}

export function accepts(previous, next) {
  return !previous || previous.stream_id !== next.stream_id ||
    (next.start >= previous.start && next.revision >= previous.revision &&
     next.price_event_ms >= previous.price_event_ms);
}

// Only real, finite samples from the latest rolling 15-minute window may be drawn.
export function projectBtc(points, state) {
  if (!Array.isArray(points) || !state) return [];
  return points.slice(-2000).filter(row => Array.isArray(row) && row.length === 2 &&
    Number.isFinite(row[0]) && row[0] >= state.server_ms - 15 * 60 * 1000 &&
    row[0] <= state.server_ms + 5000 && Number.isFinite(row[1]) && row[1] > 0)
    .map(([time, price]) => [time, price]);
}

// Up/Down rows are the current round's real best asks (buy prices), in dollars per share.
export function projectQuotes(points, state) {
  if (!Array.isArray(points) || !state) return [];
  const quote = value => value === null || (Number.isFinite(value) && value > 0 && value <= 1);
  return points.slice(-2000).filter(row => Array.isArray(row) && row.length === 3 &&
    Number.isFinite(row[0]) && row[0] >= state.start * 1000 && row[0] < state.end * 1000 &&
    row[0] <= state.server_ms + 5000 && quote(row[1]) && quote(row[2]))
    .map(([time, up, down]) => [time, up, down]);
}

export function sseDecoder(onData) {
  let pending = '';
  return chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n\n')) !== -1) {
      const block = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const data = block.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (data) onData(JSON.parse(data));
    }
    if (pending.length > 2_000_000) throw new Error('SSE frame too large');
  };
}
