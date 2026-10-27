(() => {
  const money = value => '$' + value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const clock = value => new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(value);

  // Monotone cubic interpolation rounds the trace without averaging or inventing
  // extra samples. Flat sections stay flat and turns cannot overshoot their data.
  const smoothPath = (points, valueAt, xAt, yAt, maxGap = 5000) => {
    const segments = []; let segment = [], previousTime = null;
    const finish = () => { if (segment.length) segments.push(segment); segment = []; };
    for (const point of points) {
      const value = valueAt(point), time = point[0], px = xAt(time), py = value == null ? NaN : yAt(value);
      if (!Number.isFinite(px) || !Number.isFinite(py)) { finish(); previousTime = null; continue; }
      if (previousTime != null && (time - previousTime > maxGap || px <= segment.at(-1).x)) finish();
      segment.push({x: px, y: py}); previousTime = time;
    }
    finish();
    return segments.map(values => {
      if (values.length === 1) return `M${values[0].x.toFixed(2)},${values[0].y.toFixed(2)}`;
      const slopes = values.slice(0, -1).map((point, index) =>
        (values[index + 1].y - point.y) / (values[index + 1].x - point.x));
      const tangents = values.map((point, index) => {
        if (index === 0) return slopes[0];
        if (index === values.length - 1) return slopes.at(-1);
        return slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
      });
      for (let index = 0; index < slopes.length; index++) {
        if (slopes[index] === 0) { tangents[index] = 0; tangents[index + 1] = 0; continue; }
        const a = tangents[index] / slopes[index], b = tangents[index + 1] / slopes[index];
        const length = Math.hypot(a, b);
        if (length > 3) { const scale = 3 / length; tangents[index] *= scale; tangents[index + 1] *= scale; }
      }
      let path = `M${values[0].x.toFixed(2)},${values[0].y.toFixed(2)}`;
      for (let index = 0; index < values.length - 1; index++) {
        const current = values[index], next = values[index + 1], width = next.x - current.x;
        path += `C${(current.x + width / 3).toFixed(2)},${(current.y + tangents[index] * width / 3).toFixed(2)} ` +
          `${(next.x - width / 3).toFixed(2)},${(next.y - tangents[index + 1] * width / 3).toFixed(2)} ${next.x.toFixed(2)},${next.y.toFixed(2)}`;
      }
      return path;
    }).join('');
  };

  // One small SVG; no chart framework, timers or additional network connections.
  globalThis.BtcLocalChart = class {
    constructor() {
      this.element = document.createElement('section');
      this.element.id = 'btc-local-chart';
      this.element.style.cssText = 'display:block;position:relative;min-width:0;width:100%;flex:none;margin:0 0 20px;box-sizing:border-box;';
      this.root = this.element.attachShadow({mode: 'open'});
      this.mode = 'quotes'; this.range = 300; this.points = []; this.quotePoints = []; this.state = null; this.selected = null;
      this.root.innerHTML = `<style>
        :host{all:initial;display:block;color:#e8edf5;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
        *{box-sizing:border-box}[hidden]{display:none!important}
        .chart{padding:12px 0 8px;border-top:1px solid #34404d;border-bottom:1px solid #34404d;font-size:12px;line-height:1.4}
        .top,.readout,.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
        .heading{font-size:14px;font-weight:650}.source{color:#9cabbc;font-size:10px;margin-top:2px}
        .ranges{display:flex;gap:4px}button{font:inherit;min-height:36px;min-width:58px;border:1px solid #46515d;border-radius:6px;background:transparent;color:#b5c2d0;cursor:pointer;padding:5px 10px}
        button[aria-pressed=true]{background:#ffad21;color:#11151b;border-color:#ffad21;font-weight:650}
        button:focus-visible,svg:focus-visible{outline:2px solid #72caff;outline-offset:2px}
        .readout{justify-content:flex-start;margin:6px 0 0;min-height:29px;font-variant-numeric:tabular-nums}
        .price{color:#ffad21;font-size:20px;font-weight:650}.delta{font-size:22px;font-weight:750}.up{color:#27d995}.down{color:#fb6475}
        .quote{font-size:18px;font-weight:750}.quote+.quote{margin-left:10px}.btc-overlay{color:#ffad21;font-size:14px}
        .stale .data{opacity:.5}
        .plot{position:relative;height:180px;min-width:0}svg{display:block;width:100%;height:100%;touch-action:pan-y}
        svg text{font-family:inherit;font-size:10px;fill:#a9b6c5;font-variant-numeric:tabular-nums}
        .grid{stroke:#29333f;stroke-width:.75;shape-rendering:crispEdges}.target{stroke:#9eabbc;stroke-width:1;stroke-dasharray:5 5}
        .line{stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round}.btc-line{stroke:#ffad21}.up-line{stroke:#27d995}.down-line{stroke:#fb6475}
        svg text.series-label{font-size:11px;font-weight:750;paint-order:stroke;stroke:#0b0f14;stroke-width:4px;stroke-linejoin:round}.up-label{fill:#27d995}.down-label{fill:#fb6475}.btc-axis{fill:#ffad21}
        .empty{position:absolute;inset:20px 0 32px;display:grid;place-items:center;color:#9cabbc;font-size:12px;pointer-events:none}
        .tooltip{position:absolute;top:2px;left:8px;color:#e8edf5;background:#18212b;padding:4px 8px;border:1px solid #46515d;border-radius:4px;font-size:11px;pointer-events:none;font-variant-numeric:tabular-nums}
        .foot{font-size:10px;color:#9cabbc}.target-key{color:#c2ccda}
        a{color:#72caff;font-size:11px;text-decoration:none}a:hover{text-decoration:underline}a:focus-visible{outline:2px solid #ffad21}
        @media(max-width:540px){.plot{height:160px}button{min-height:40px}.top{gap:6px}}
      </style><section class="chart" aria-label="本机 BTC 实时曲线">
        <div class="top"><div><div class="heading" id="heading">Up / Down 最近60秒走势</div><div class="source" id="source">Polymarket 盘口 + Chainlink 60秒均价</div></div>
          <div class="ranges" role="group" aria-label="曲线类型和时间范围"><button type="button" data-mode="quotes" aria-pressed="true">Up / Down</button><button type="button" data-mode="btc" data-range="900" aria-pressed="false">15 分钟</button><button type="button" data-mode="btc" data-range="300" aria-pressed="false">5 分钟</button><button type="button" data-mode="btc" data-range="60" aria-pressed="false">60 秒</button></div></div>
        <div class="readout"><span class="price" id="price" hidden>—</span><strong class="quote up" id="up-quote">Up —</strong><strong class="quote down" id="down-quote">Down —</strong><strong class="quote btc-overlay" id="btc-overlay">BTC 60秒 —</strong><strong class="delta" id="delta">—</strong></div>
        <div class="plot"><svg id="chart" role="img" tabindex="0" aria-label="等待 Up/Down 盘口与 BTC 行情；左右方向键查看数据点"></svg><div class="empty" id="empty">等待本轮盘口数据</div><div class="tooltip" id="tooltip" hidden></div></div>
        <div class="foot"><span class="target-key" id="target" hidden>┄ 目标价 —</span></div>
        <a id="current-link" hidden>打开当前轮 ↗</a>
      </section>`;
      this.root.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        this.mode = button.dataset.mode; if (this.mode === 'btc') this.range = Number(button.dataset.range); this.selected = null;
        this.root.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(
          b.dataset.mode === this.mode && (this.mode === 'quotes' || Number(b.dataset.range) === this.range))));
        this.schedule();
      }));
      const svg = this.root.getElementById('chart');
      const inspect = event => {
        if (!this.plot?.points.length) return;
        const rect = svg.getBoundingClientRect(), {left, width, start, end, points} = this.plot;
        const time = start + ((event.clientX - rect.left - left) / width) * (end - start);
        this.selected = points.reduce((a, b) => Math.abs(a[0] - time) < Math.abs(b[0] - time) ? a : b)[0];
        this.schedule();
      };
      svg.addEventListener('pointermove', inspect); svg.addEventListener('pointerdown', inspect);
      svg.addEventListener('pointerleave', () => { this.selected = null; this.schedule(); });
      svg.addEventListener('blur', () => { this.selected = null; this.schedule(); });
      svg.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !this.plot?.points.length) return;
        event.preventDefault();
        const points = this.plot.points, index = points.findIndex(p => p[0] === this.selected);
        this.selected = points[Math.max(0, Math.min(points.length - 1, (index < 0 ? points.length - 1 : index) + (event.key === 'ArrowLeft' ? -1 : 1)))][0];
        this.schedule();
      });
      this.resize = new ResizeObserver(() => this.schedule()); this.resize.observe(this.element);
    }

    showQuotes() {
      this.mode = 'quotes'; this.range = 300; this.selected = null;
      this.root.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === 'quotes')));
      this.schedule();
    }

    update(state, points, quotePoints, status, fresh, bookFresh, currentSlug = '') {
      if (state?.slug !== this.state?.slug || state?.stream_id !== this.state?.stream_id) this.selected = null;
      this.state = state; this.points = points || []; this.quotePoints = quotePoints || [];
      this.status = status; this.fresh = fresh; this.bookFresh = bookFresh;
      const link = this.root.getElementById('current-link');
      link.hidden = !currentSlug;
      if (currentSlug) link.href = `https://polymarket.com/zh/event/${currentSlug}`;
      this.schedule();
    }

    schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      requestAnimationFrame(() => { this.scheduled = false; if (this.element.isConnected) this.draw(); });
    }

    draw() {
      const get = id => this.root.getElementById(id), state = this.state;
      const quoteMode = this.mode === 'quotes';
      get('heading').textContent = quoteMode ? 'Up / Down 最近60秒走势' : 'BTC 实时走势';
      get('source').textContent = quoteMode ? 'Polymarket 盘口 + Chainlink 60秒均价' : '本机采集 · Chainlink 60秒均价';
      get('price').hidden = quoteMode;
      get('up-quote').hidden = !quoteMode; get('down-quote').hidden = !quoteMode;
      get('btc-overlay').hidden = !quoteMode;
      get('target').hidden = quoteMode;
      this.root.querySelector('.chart').classList.toggle('stale', quoteMode ? !this.bookFresh : !this.fresh);
      const validPrice = state?.price != null && state.price_event_ms >= state.start * 1000 && state.price_event_ms < state.end * 1000;
      get('price').textContent = validPrice ? money(state.price) : '—';
      const diff = validPrice && state.target != null ? state.price - state.target : null;
      get('delta').textContent = diff == null ? '—' : `${diff >= 0 ? '↑' : '↓'} $${Math.abs(diff).toFixed(2)}`;
      get('delta').className = 'delta ' + (diff == null ? '' : diff >= 0 ? 'up' : 'down');
      get('target').textContent = state?.target == null ? '┄ 目标价 —' : `┄ 目标价 ${money(state.target)}`;
      const svg = get('chart'), W = Math.floor(svg.clientWidth), H = svg.clientHeight;
      if (W < 100) return;
      const right = 76, top = 20, bottom = 29, height = H - top - bottom;
      if (quoteMode) {
        const left = 76, width = W - left - right;
        const roundStart = state ? state.start * 1000 : 0, roundEnd = state ? state.end * 1000 : 60000;
        const roundQuotes = state ? this.quotePoints.filter(p => p[0] >= roundStart && p[0] < roundEnd)
          .sort((a, b) => a[0] - b[0]) : [];
        const roundBtc = state ? this.points.filter(p => p[0] >= roundStart && p[0] < roundEnd)
          .sort((a, b) => a[0] - b[0]) : [];
        const latestQuoteTime = roundQuotes.at(-1)?.[0] || 0, latestBtcPoint = roundBtc.at(-1);
        const sampleEnd = Math.max(latestQuoteTime, latestBtcPoint?.[0] || 0);
        const end = state ? Math.min(roundEnd, sampleEnd || Math.min(state.server_ms, roundEnd)) : 60000;
        const start = state ? Math.max(roundStart, end - 60000) : 0;
        const all = roundQuotes.filter(point => point[0] >= start && point[0] <= end);
        const btc = roundBtc.filter(point => point[0] >= start && point[0] <= end);
        const latestUp = [...all].reverse().find(p => p[1] != null)?.[1];
        const latestDown = [...all].reverse().find(p => p[2] != null)?.[2];
        get('up-quote').textContent = `Up ${latestUp == null ? '—' : Math.round(latestUp * 100) + '¢'}`;
        get('down-quote').textContent = `Down ${latestDown == null ? '—' : Math.round(latestDown * 100) + '¢'}`;
        get('btc-overlay').textContent = `BTC 60秒 ${latestBtcPoint ? money(latestBtcPoint[1]) : '—'}`;
        const values = all.flatMap(p => [p[1], p[2]]).filter(v => v != null).map(v => v * 100);
        let lo = values.length ? Math.max(0, Math.min(...values) - 5) : 0;
        let hi = values.length ? Math.min(100, Math.max(...values) + 5) : 100;
        if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 5); hi = Math.min(100, mid + 5); }
        const x = time => left + (time - start) / Math.max(1, end - start) * width;
        const y = value => top + (hi - value * 100) / Math.max(1, hi - lo) * height;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.dataset.start = start; svg.dataset.end = end; svg.dataset.points = all.length;
        svg.setAttribute('aria-label', `最近60秒 Up/Down 盘口走势与 BTC 曲线，${all.length}个盘口变动点、${btc.length}个 BTC 数据点，Up ${latestUp == null ? '暂无' : Math.round(latestUp * 100) + '美分'}、Down ${latestDown == null ? '暂无' : Math.round(latestDown * 100) + '美分'}；左右方向键查看数据点`);
        let html = `<defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs>`;
        for (let i = 0; i <= 3; i++) { const value = lo + (hi - lo) * i / 3, yy = top + (hi - value) / Math.max(1, hi - lo) * height;
          html += `<line class="grid" x1="${left}" y1="${yy}" x2="${left + width}" y2="${yy}"/><text x="${left + width + 8}" y="${yy + 3}">${Math.round(value)}¢</text>`; }
        const ticks = W < 500 ? 2 : 4;
        if (state) for (let i = 0; i <= ticks; i++) { const time = start + (end - start) * i / ticks;
          html += `<text x="${x(time)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${clock(time)}</text>`; }
        const quotePath = index => smoothPath(all, point => point[index], x, y);
        html += `<g class="data" clip-path="url(#plot)"><path class="line up-line" d="${quotePath(1)}"/><path class="line down-line" d="${quotePath(2)}"/></g>`;
        if (btc.length) {
          const btcValues = btc.map(point => point[1]), rawLo = Math.min(...btcValues), rawHi = Math.max(...btcValues);
          const btcPadding = Math.max(.5, (rawHi - rawLo) * .16), btcLo = rawLo - btcPadding, btcHi = rawHi + btcPadding;
          const btcY = value => top + (btcHi - value) / Math.max(.01, btcHi - btcLo) * height;
          for (let i = 0; i <= 2; i++) { const value = btcLo + (btcHi - btcLo) * i / 2, yy = btcY(value);
            html += `<text class="btc-axis" x="${left - 8}" y="${yy + 3}" text-anchor="end">${money(value)}</text>`; }
          const btcPath = smoothPath(btc, point => point[1], x, btcY);
          html += `<g class="data" clip-path="url(#plot)"><path class="line btc-line" d="${btcPath}"/></g>`;
        }
        const firstUp = all.find(point => point[1] != null), firstDown = all.find(point => point[2] != null);
        const labels = [
          firstUp && {name: 'Up', className: 'up-label', actualX: x(firstUp[0]), actualY: y(firstUp[1])},
          firstDown && {name: 'Down', className: 'down-label', actualX: x(firstDown[0]), actualY: y(firstDown[2])}
        ].filter(Boolean).map(label => ({...label, labelY: label.actualY}));
        if (labels.length === 2 && Math.abs(labels[0].labelY - labels[1].labelY) < 14) {
          const upper = labels[0].actualY <= labels[1].actualY ? labels[0] : labels[1];
          const lower = upper === labels[0] ? labels[1] : labels[0];
          const center = (upper.actualY + lower.actualY) / 2;
          upper.labelY = Math.max(top + 5, center - 7);
          lower.labelY = Math.min(top + height - 4, center + 7);
        }
        for (const label of labels) {
          html += `<text class="series-label ${label.className}" x="${Math.min(label.actualX + 5, left + 40)}" y="${label.labelY + 4}">${label.name}</text>`;
        }
        const selected = all.find(p => p[0] === this.selected);
        get('tooltip').hidden = !selected;
        if (selected) { html += `<line x1="${x(selected[0])}" y1="${top}" x2="${x(selected[0])}" y2="${top + height}" stroke="#8494a7" stroke-dasharray="3 3"/>`;
          const nearbyBtc = btc.reduce((best, point) => !best || Math.abs(point[0] - selected[0]) < Math.abs(best[0] - selected[0]) ? point : best, null);
          const btcText = nearbyBtc && Math.abs(nearbyBtc[0] - selected[0]) <= 5000 ? ` · BTC ${money(nearbyBtc[1])}` : '';
          get('tooltip').textContent = `${clock(selected[0])} · Up ${selected[1] == null ? '—' : Math.round(selected[1] * 100) + '¢'} · Down ${selected[2] == null ? '—' : Math.round(selected[2] * 100) + '¢'}${btcText}`; }
        svg.innerHTML = html; get('empty').hidden = all.length > 0 || btc.length > 0; get('empty').textContent = '等待最近60秒行情';
        this.plot = {left, width, start, end, points: all}; return;
      }
      const left = 4, width = W - left - right;
      const all = state ? this.points.slice().sort((a, b) => a[0] - b[0]) : [];
      const last = all.at(-1);
      // Follow sample time, not wall time: outages never invent a moving trace.
      const end = !state ? this.range * 1000 : Math.min(state.server_ms, (last?.[0] || state.server_ms) + 1000);
      const start = !state ? 0 : end - this.range * 1000;
      const points = all.filter(p => p[0] >= start && p[0] <= end), values = points.map(p => p[1]);
      if (state?.target != null) values.push(state.target);
      let lo = values.length ? Math.min(...values) : 0, hi = values.length ? Math.max(...values) : 1;
      const padding = Math.max(.5, (hi - lo) * .16); lo -= padding; hi += padding;
      const x = time => left + (time - start) / Math.max(1, end - start) * width;
      const y = value => top + (hi - value) / (hi - lo) * height;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.dataset.start = start; svg.dataset.end = end; svg.dataset.points = points.length;
      const rangeLabel = this.range === 900 ? '最近15分钟' : this.range === 300 ? '最近5分钟' : '最近60秒';
      svg.setAttribute('aria-label', `BTC ${rangeLabel}价格走势，${points.length}个真实数据点，${validPrice ? '当前' + money(state.price) : '等待行情'}；左右方向键查看数据点`);
      let html = `<defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs>`;
      if (points.length) for (let i = 0; i <= 3; i++) {
        const value = lo + (hi - lo) * i / 3, yy = y(value);
        html += `<line class="grid" x1="${left}" y1="${yy}" x2="${left + width}" y2="${yy}"/><text x="${left + width + 8}" y="${yy + 3}">${money(value)}</text>`;
      }
      const ticks = W < 500 ? 2 : 4;
      if (state) for (let i = 0; i <= ticks; i++) {
        const time = start + (end - start) * i / ticks;
        html += `<text x="${x(time)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${clock(time)}</text>`;
      }
      const targetStart = state ? Math.max(start, state.start * 1000) : 0;
      const targetEnd = state ? Math.min(end, state.end * 1000) : 0;
      const targetVisible = points.length && targetEnd > targetStart && state?.target != null && state.target >= lo && state.target <= hi;
      if (targetVisible) html += `<line class="target" x1="${x(targetStart)}" y1="${y(state.target)}" x2="${x(targetEnd)}" y2="${y(state.target)}"/>`;
      const path = smoothPath(points, point => point[1], x, y);
      html += `<g class="data" clip-path="url(#plot)"><path class="line btc-line" d="${path}"/>`;
      const final = points.at(-1);
      if (final) html += `<circle cx="${x(final[0])}" cy="${y(final[1])}" r="3" fill="#ffad21"/>`;
      html += '</g>';
      const selected = points.find(p => p[0] === this.selected);
      get('tooltip').hidden = !selected;
      if (selected) {
        html += `<line x1="${x(selected[0])}" y1="${top}" x2="${x(selected[0])}" y2="${top + height}" stroke="#8494a7" stroke-dasharray="3 3"/><circle cx="${x(selected[0])}" cy="${y(selected[1])}" r="4" fill="#ffad21"/>`;
        get('tooltip').textContent = `${clock(selected[0])} · ${money(selected[1])}`;
      }
      svg.innerHTML = html;
      get('empty').hidden = points.length > 0;
      get('empty').textContent = !state ? (this.status || '等待本机行情服务') : '等待本轮真实行情点';
      this.plot = {left, width, start, end, points};
    }
  };
})();
