import {projectState, projectBtc, projectQuotes, accepts, sseDecoder} from './protocol.mjs';

const clients = new Set();
let portNumber = 8765, controller = null, session = 0, last = null;
let connection = 'connecting', lastSentAt = 0, lastSeenAt = 0, signature = '';
const btc = new Map();
const points = () => [...btc].sort((a, b) => a[0] - b[0]);
const quotes = new Map();
const quotePoints = () => [...quotes.values()].sort((a, b) => a[0] - b[0]);
const ready = chrome.storage.local.get({port: 8765}).then(value => {
  if (Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535) portNumber = value.port;
});

function emit(message) {
  for (const port of clients) {
    try { port.postMessage(message); } catch { clients.delete(port); }
  }
}

async function run(id) {
  await ready;
  let delay = 1000;
  while (clients.size && id === session) {
    const abort = new AbortController(); controller = abort;
    connection = 'connecting'; emit({type: 'connection', status: connection});
    let lastFrame = Date.now();
    const watch = setInterval(() => { if (Date.now() - lastFrame > 6000) abort.abort(); }, 1000);
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/events`, {
        signal: abort.signal, cache: 'no-store', credentials: 'omit', redirect: 'error'
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Unavailable');
      const parse = sseDecoder(message => {
        const next = projectState(message.state);
        if (!next || !accepts(last, next)) return;
        if (message.kind === 'snapshot' || !last || last.stream_id !== next.stream_id || last.start !== next.start) {
          btc.clear(); quotes.clear();
        }
        let changed = false;
        const incoming = projectBtc(message.btc, next);
        if (next.price != null) incoming.push(...projectBtc([[next.price_event_ms, next.price]], next));
        for (const [time, price] of incoming) {
          if (btc.get(time) !== price) changed = true;
          btc.set(time, price);
        }
        if (btc.size > 2000) for (const [time] of points().slice(0, btc.size - 2000)) btc.delete(time);
        for (const row of projectQuotes(message.quotes, next)) {
          const previous = quotes.get(row[0]);
          if (!previous || previous[1] !== row[1] || previous[2] !== row[2]) changed = true;
          quotes.set(row[0], row);
        }
        if (quotes.size > 2000) for (const [time] of quotePoints().slice(0, quotes.size - 2000)) quotes.delete(time);
        lastFrame = Date.now(); lastSeenAt = lastFrame; delay = 1000;
        const key = JSON.stringify([next.stream_id, next.start, next.price, next.target,
          next.price_event_ms, next.price_received_ms, next.price_connected,
          next.book_received_ms, next.book_connected]);
        last = next; connection = 'live';
        // Price and quote changes go out immediately; publisher already coalesces bursts.
        if (changed || key !== signature || Date.now() - lastSentAt >= 1000) {
          signature = key; lastSentAt = Date.now();
          emit({type: 'state', state: next, btc: points(), quotes: quotePoints(), received_ms: lastSeenAt});
        }
      });
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      try {
        while (clients.size && id === session) {
          const {value, done} = await reader.read();
          if (done) throw new Error('Stream ended');
          parse(decoder.decode(value, {stream: true}));
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch {
      if (id !== session || !clients.size) break;
      connection = 'offline'; emit({type: 'connection', status: connection});
    } finally { clearInterval(watch); abort.abort(); if (controller === abort) controller = null; }
    if (clients.size && id === session) await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(5000, delay * 2);
  }
}

function restart() {
  session++; controller?.abort(); last = null; btc.clear(); quotes.clear(); signature = ''; lastSentAt = 0;
  if (clients.size) void run(session);
}

chrome.runtime.onConnect.addListener(port => {
  let allowed = false;
  try {
    const url = new URL(port.sender?.url || '');
    allowed = (port.name === 'btc-page' && url.protocol === 'https:' &&
      ['polymarket.com', 'www.polymarket.com'].includes(url.hostname) &&
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?event\/btc-updown-5m-\d+(?:\/|$)/i.test(url.pathname)) ||
      (port.name === 'btc-popup' && url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id);
  } catch {}
  if (!allowed || port.sender?.id !== chrome.runtime.id) { port.disconnect(); return; }
  clients.add(port);
  port.postMessage({type: 'connection', status: connection});
  if (last && connection === 'live' && Date.now() - lastSeenAt < 5000)
    port.postMessage({type: 'state', state: last, btc: points(), quotes: quotePoints(), received_ms: lastSeenAt});
  if (clients.size === 1) restart();
  port.onDisconnect.addListener(() => {
    clients.delete(port);
    if (!clients.size) { session++; controller?.abort(); last = null; btc.clear(); quotes.clear(); signature = ''; }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  const value = changes.port?.newValue;
  if (area === 'local' && Number.isInteger(value) && value >= 1024 && value <= 65535) {
    portNumber = value; restart();
  }
});
