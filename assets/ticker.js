// Live price ticker: proven two-group flex marquee.
// The whole strip is one GPU-composited layer, so icons + text move as one
// (no drift). The scroll animation is set ONCE and never interrupted; price
// refreshes only swap the numbers. Logos come live from your Finnhub feed
// (cached in the browser); ETFs/crypto without a logo use a glyph.
(function () {
  var track = document.getElementById('ticker-track');
  if (!track) return;
  var box = track.closest('.ticker');
  var message = (box && box.getAttribute('data-message')) || '';
  var FH = 'd7q3ok9r01qosaaqhbc0d7q3ok9r01qosaaqhbcg';
  var STOCKS = [['SPY','SPY'],['QQQ','QQQ'],['DIA','DIA'],['IWM','IWM'],['NVDA','NVDA'],['TSLA','TSLA'],['META','META'],['GOOG','GOOG'],['AMZN','AMZN'],['AAPL','AAPL'],['MSFT','MSFT'],['NFLX','NFLX'],['AMD','AMD'],['JPM','JPM'],['GLD','GLD'],['SLV','SLV'],['USO','USO'],['SPCX','SPCX']];
  var FALLBACK = { SPY:'📈', QQQ:'📈', DIA:'📈', IWM:'📈', GLD:'🥇', SLV:'🥈', USO:'🛢️', SPCX:'🚀', BTC:'₿', ETH:'Ξ' };
  var LOGOS = {};
  try { LOGOS = JSON.parse(localStorage.getItem('tah_logos') || '{}') || {}; } catch (e) { LOGOS = {}; }
  var built = false;

  function price(c) {
    return Number(c).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function iconHTML(label) {
    var url = LOGOS[label];
    if (url) return '<span class="tk-ic" style="background-image:url(' + url + ')"></span>';
    var g = FALLBACK[label];
    return g ? '<span class="tk-gl">' + g + '</span>' : '';
  }
  function itemHTML(label, c, dp) {
    var n = Number(dp); var t = n >= 0 ? 'b' : 'i'; var s = n >= 0 ? '+' : '';
    return '<span class="tk-it">' + iconHTML(label) +
      '<span class="tk-nm">' + label + ' ' + price(c) + '</span> ' +
      '<' + t + '>' + s + n.toFixed(2) + '%</' + t + '></span>';
  }

  function fetchLogos() {
    var missing = STOCKS.filter(function (it) { return !(it[0] in LOGOS); });
    if (!missing.length) return Promise.resolve();
    return Promise.all(missing.map(function (it) {
      return fetch('https://finnhub.io/api/v1/stock/profile2?symbol=' + it[1] + '&token=' + FH)
        .then(function (r) { return r.json(); })
        .then(function (p) { LOGOS[it[0]] = (p && p.logo) || ''; })
        .catch(function () { LOGOS[it[0]] = ''; });
    })).then(function () {
      try { localStorage.setItem('tah_logos', JSON.stringify(LOGOS)); } catch (e) {}
    });
  }

  function quoteJob(it) {
    return fetch('https://finnhub.io/api/v1/quote?symbol=' + it[1] + '&token=' + FH)
      .then(function (r) { return r.json(); })
      .then(function (q) { return (q && typeof q.dp === 'number' && q.c) ? itemHTML(it[0], q.c, q.dp) : null; })
      .catch(function () { return null; });
  }
  function krakenJob(pair, label) {
    return fetch('https://api.kraken.com/0/public/Ticker?pair=' + pair)
      .then(function (r) { return r.json(); })
      .then(function (j) { var t = j && j.result && Object.values(j.result)[0]; if (!t) return null; var c = Number(t.c[0]), o = Number(t.o); return itemHTML(label, c, o ? (c - o) / o * 100 : 0); })
      .catch(function () { return null; });
  }

  function render(items) {
    if (message) items.push('<span class="tk-it"><em>' + message + '</em></span>');
    var group = items.join('');
    // Two identical groups side by side; the CSS animates the track by -50%
    // (exactly one group width) for a seamless, drift-free loop.
    track.innerHTML = '<div class="tk-grp">' + group + '</div>' +
                      '<div class="tk-grp" aria-hidden="true">' + group + '</div>';
    if (!built) {
      track.style.animationDuration = Math.max(45, items.length * 5) + 's';
      built = true;
    }
  }

  function load() {
    var jobs = STOCKS.map(quoteJob);
    jobs.push(krakenJob('XBTUSD', 'BTC'));
    jobs.push(krakenJob('ETHUSD', 'ETH'));
    Promise.all(jobs).then(function (res) {
      var items = res.filter(Boolean);
      if (items.length) render(items);
    });
  }

  fetchLogos().then(load);
  setInterval(load, 60000);
})();
