(() => {
  if (globalThis.__btcLocalComparison) return;
  globalThis.__btcLocalComparison = true;
  let slug = '', state = null, received = 0, serverOffset = 0;
  let chart = null, btcPoints = [], quotePoints = [];
  let port = null, retry = null, status = 'connecting', pending = false, invalidated = false;
  const clock = value => new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(value);
  function connect() {
    if (port || invalidated || !slug) return;
    try {
      const currentPort = chrome.runtime.connect({name: 'btc-page'}); port = currentPort;
      port.onMessage.addListener(message => {
        if (port !== currentPort) return;
        if (message.type === 'state') {
          const next = message.state;
          if (state && state.stream_id === next.stream_id && next.revision < state.revision) return;
          state = next; btcPoints = message.btc || []; quotePoints = message.quotes || [];
          received = message.received_ms || Date.now(); serverOffset = next.server_ms - received; status = 'live';
        } else if (message.type === 'connection') status = message.status;
        render();
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port !== currentPort) return;
        port = null; status = 'offline'; render();
        clearTimeout(retry); if (slug) retry = setTimeout(connect, 1200);
      });
    } catch { invalidated = true; status = 'offline'; render(); }
  }

  function render() {
    if (!chart || !slug) return;
    const time = Date.now() + serverOffset;
    const same = state?.slug === slug;
    const fresh = status === 'live' && Date.now() - received < 5000 && state?.price_connected &&
      time - state.price_received_ms < 6000 && state.price_received_ms > 0;
    const bookFresh = status === 'live' && Date.now() - received < 5000 && state?.book_connected &&
      time - state.book_received_ms < 6000 && state.book_received_ms > 0;
    const validPrice = same && state.price_event_ms >= state.start * 1000 && state.price_event_ms < state.end * 1000;
    if (state && !same) {
      const ended = Number(slug.split('-').at(-1)) + 300 <= time / 1000;
      chart.update(null, [], [], ended ? '当前网页已结束' : '网页与本机轮次不同', false, false, state.slug);
      return;
    }
    const label = invalidated ? '插件已更新，请刷新网页' : !state ? '本机服务未连接' :
      time >= state.end * 1000 ? '本轮已结束' : !fresh ? '行情过期 · 重连中' :
      !validPrice ? '等待本轮行情' : `实时 · ${clock(state.price_event_ms)}`;
    chart.update(state, btcPoints, quotePoints, label, fresh && validPrice, bookFresh);
  }

  function placeChart() {
    // Desktop and mobile can coexist in the DOM; attach to the visible chart only.
    const native = [...document.querySelectorAll('[id="price-chart-container"]')]
      .find(el => el.getClientRects().length && el.getBoundingClientRect().width > 0);
    if (!native) { chart?.element.remove(); return; }
    if (!chart) chart = new globalThis.BtcLocalChart();
    let target = native.parentElement || native, wrapper = native.parentElement;
    // The site's outer chart frame owns its price toolbar and top padding.
    // Insert ahead of that frame so the absolute price toolbar stays with its own chart.
    for (let i = 0; wrapper && i < 5; i++, wrapper = wrapper.parentElement) {
      if (wrapper.style.minHeight) { target = wrapper; break; }
    }
    chart.element.style.marginBottom = target.style.minHeight ? '16px' : '76px';
    if (target.previousElementSibling !== chart.element) target.before(chart.element);
    chart.schedule();
  }

  function reconcile() {
    pending = false;
    const match = location.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?event\/(btc-updown-5m-\d+)(?:\/|$)/i);
    const next = match?.[1] || '';
    if (next !== slug) {
      slug = next; state = null; btcPoints = []; quotePoints = []; received = 0; status = 'connecting';
      clearTimeout(retry); const old = port; port = null; old?.disconnect();
      chart?.showQuotes();
      chart?.element.remove();
    }
    if (!slug) return;
    placeChart();
    connect(); render();
  }
  function schedule() {
    if (!pending) { pending = true; setTimeout(reconcile, 150); }
  }
  new MutationObserver(records => {
    if (records.some(record => record.target !== chart?.element && !chart?.element.contains(record.target))) schedule();
  }).observe(document.body, {childList: true, subtree: true});
  window.addEventListener('popstate', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('resize', schedule, {passive: true});
  setInterval(() => { reconcile(); }, 1000);
  reconcile();
})();
