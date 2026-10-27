import test from 'node:test';
import assert from 'node:assert/strict';
import {projectState, projectBtc, projectQuotes, accepts, sseDecoder} from './protocol.mjs';

const sample = () => ({start: 1800000000, end: 1800000300, slug: 'btc-updown-5m-1800000000',
  server_ms: 1800000002000, price: 80001, target: 80000, price_connected: true,
  price_event_ms: 1800000001000, price_received_ms: 1800000002000,
  price_lag_ms: 1000, book_connected: true, book_received_ms: 1800000001900,
  revision: 2, stream_id: 'boot1', unrelated: 'excluded'});

test('accepts only a matching finite market state, not unrelated source fields', () => {
  const state = projectState(sample());
  assert.equal(state.price, 80001);
  assert.equal('unrelated' in state, false);
  assert.equal(projectState({...sample(), slug: 'btc-updown-5m-1799999700'}), null);
  assert.equal(projectState({...sample(), end: 1800000301}), null);
  assert.equal(projectState({...sample(), revision: NaN}), null);
});
test('missing/invalid prices remain null, never a fabricated zero', () => {
  assert.equal(projectState({...sample(), target: null}).target, null);
  assert.equal(projectState({...sample(), price: Infinity}).price, null);
  assert.equal(projectState({...sample(), price: 0}).price, null);
});
test('older revisions, windows and source timestamps cannot replace a newer state', () => {
  const current = sample();
  assert.equal(accepts(current, {...sample(), revision: 1}), false);
  assert.equal(accepts(current, {...sample(), start: current.start - 300, revision: 3}), false);
  assert.equal(accepts(current, {...sample(), price_event_ms: current.price_event_ms - 1000, revision: 3}), false);
  assert.equal(accepts(current, {...sample(), revision: 3}), true);
});
test('a restarted service can start a new revision sequence', () => {
  assert.equal(accepts(sample(), {...sample(), stream_id: 'boot2', revision: 0}), true);
});
test('SSE messages survive arbitrary chunk boundaries and multiple frames per chunk', () => {
  const got = [], parse = sseDecoder(value => got.push(value));
  const stream = ': heartbeat\n\ndata: '+JSON.stringify({state: sample(), note: '上涨'})+'\n\ndata: {"second":true}\n\n';
  for (let i = 0; i < stream.length; i += 7) parse(stream.slice(i, i + 7));
  assert.equal(got.length, 2);
  assert.equal(got[0].note, '上涨'); assert.equal(got[1].second, true);
});

test('chart samples keep the rolling 15 minutes and reject stale, future and malformed prices', () => {
  const state = sample(), t = state.start * 1000;
  assert.deepEqual(projectBtc([[t, 80000], [t + 1000, 80001], [t - 300000, 79999],
    [t - 901000, 79000], [t + 9000, 81000], [t, null], [t, Infinity],
    [t, 0], ['bad', 80000], [t, 80000, 'extra'], null], state),
    [[t, 80000], [t + 1000, 80001], [t - 300000, 79999]]);
  assert.deepEqual(projectBtc(null, state), []);
  assert.deepEqual(projectBtc([[t, 80000]], null), []);
});

test('quote chart keeps only current-round real best asks and preserves disconnect gaps', () => {
  const state = sample(), t = state.start * 1000;
  assert.deepEqual(projectQuotes([[t, .33, .68], [t + 200, .34, null], [t + 400, null, null],
    [t - 1, .4, .6], [state.end * 1000, .5, .5], [t, 0, .5], [t, 1.1, .5],
    [t, Infinity, .5], [t, .5], null], state),
    [[t, .33, .68], [t + 200, .34, null], [t + 400, null, null]]);
  assert.deepEqual(projectQuotes(null, state), []);
  assert.deepEqual(projectQuotes([[t, .5, .5]], null), []);
});
