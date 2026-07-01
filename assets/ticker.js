// Live price ticker with instrument icons + white names.
// Logos come live from the Finnhub company-profile endpoint (your feed),
// cached in the browser so we don't refetch them every page. ETFs/BTC that
// have no logo fall back to a simple glyph.
(function () {
  var track = document.getElementById('ticker-track');
  if (!track) return;
  var box = track.closest('.ticker');
  var message = (box && box.getAttribute('data-message')) || '';
  var FH = 'd7q3ok9r01qosaaqhbc0d7q3ok9r01qosaaqhbcg';
  var STOCKS = [['SPY','SPY'],['QQQ','QQQ'],['DIA','DIA'],['IWM','IWM'],['NVDA','NVDA'],['TSLA','TSLA'],['META','META'],['GOOG','GOOG'],['AMZN','AMZN'],['AAPL','AAPL'],['MSFT','MSFT'],['NFLX','NFLX'],['AMD','AMD'],['JPM','JPM'],['GLD','GLD'],['SLV','SLV'],['USO','USO'],['SPCX','SPCX']];
  var FALLBACK = { SPY:'📈', QQQ:'📈', DIA:'📈', IWM:'📈', GLD:'🥇', SLV:'🥈', USO:'🛢️', SPCX:'🚀', BTC:'₿' };

  var LOGOS = {};
  try { LOGOS = JSON.parse(localStorage.getItem('tah_logos') || '{}') || {}; } catch (e) { LOGOS = {}; }

  function price(c) {
    return Number(c).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function icon(label) {
    var url = LOGOS[label];
    if (url) {
      return '<img src="' + url + '" alt="" style="height:18px;width:18px;border-radius:3px;object-fit:contain;vertical-align:middle;margin-right:5px;background:#fff;padding:1px" onerror="this.style.display=&#39;none&#39;">';
    }
    var g = FALLBACK[label];
    return g ? '<span style="margin-right:4px;vertical-align:middle;font-size:16px">' + g + '</span>' : '';
  }
  function part(label, c, dp) {
    var n = Number(dp); var t = n >= 0 ? 'b' : 'i'; var s = n >= 0 ? '+' : '';
    return icon(label) + '<span style="color:#fff">' + label + ' ' + price(c) + '</span> <' + t + '>' + s + n.toFixed(2) + '%</' + t + '>';
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

  function load() {
    var jobs = STOCKS.map(function (it) {
      return fetch('https://finnhub.io/api/v1/quote?symbol=' + it[1] + '&token=' + FH)
        .then(function (r) { return r.json(); })
        .then(function (q) { return (q && typeof q.dp === 'number' && q.c) ? part(it[0], q.c, q.dp) : null; })
        .catch(function () { return null; });
    });
    jobs.push(
      fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD')
        .then(function (r) { return r.json(); })
        .then(function (j) { var t = j && j.result && Object.values(j.result)[0]; if (!t) return null; var c = Number(t.c[0]), o = Number(t.o); return part('BTC', c, o ? (c - o) / o * 100 : 0); })
        .catch(function () { return null; })
    );
    Promise.all(jobs).then(function (res) {
      var parts = res.filter(Boolean); if (!parts.length) return;
      var u = parts.join(' &nbsp;&middot;&nbsp; ');
      if (message) u += ' &nbsp;&middot;&nbsp; <em>' + message + '</em>';
      u += ' &nbsp;&middot;&nbsp; ';
      track.innerHTML = u + u;
      track.style.animationDuration = Math.max(40, parts.length * 5) + 's';
    });
  }

  fetchLogos().then(load);
  setInterval(load, 60000);
})();
