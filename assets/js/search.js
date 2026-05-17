(function () {
  'use strict';

  var cfg        = document.getElementById('search-config').dataset;
  var INDEX_URL  = cfg.indexUrl;
  var NO_RESULTS = cfg.noResults;

  var input     = document.getElementById('search-input');
  var container = document.getElementById('search-results');
  var data      = null;
  var fuse      = null;

  function scopeKeys(scope) {
    if (scope === 'title')   return [{ name: 'title',   weight: 1 }];
    if (scope === 'content') return [{ name: 'content', weight: 1 }];
    return [
      { name: 'title',   weight: 0.7 },
      { name: 'content', weight: 0.3 },
    ];
  }

  function makeFuse(scope) {
    return new Fuse(data, {
      keys: scopeKeys(scope),
      includeScore: true,
      threshold: 0.2,
      minMatchCharLength: 2,
      ignoreLocation: true,
    });
  }

  function currentScope() {
    var el = document.querySelector('input[name="scope"]:checked');
    return el ? el.value : 'both';
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeHref(url) {
    return /^(https?:)?\//.test(String(url)) ? url : '#';
  }

  function renderResults(results) {
    if (!results.length) {
      container.innerHTML = '<p class="search-empty">' + NO_RESULTS + '</p>';
      return;
    }
    container.innerHTML = results.map(function (r) {
      var item = r.item;
      var tags = (item.tags || []).map(function (t) {
        return '<span class="search-result-tag">' + esc(t) + '</span>';
      }).join('');

      return '<article class="search-result">'
        + '<h2><a href="' + esc(safeHref(item.url)) + '">' + esc(item.title) + '</a></h2>'
        + '<span class="search-result-date">' + esc(item.date) + '</span>'
        + (item.summary ? '<p class="search-result-summary">' + esc(item.summary) + '</p>' : '')
        + (tags ? '<div class="search-result-tags">' + tags + '</div>' : '')
        + '</article>';
    }).join('');
  }

  function search() {
    var q = input.value.trim();
    if (!fuse || q.length < 2) {
      container.innerHTML = '';
      return;
    }
    renderResults(fuse.search(q, { limit: 10 }));
  }

  function rebuildAndSearch() {
    if (!data) return;
    fuse = makeFuse(currentScope());
    search();
  }

  fetch(INDEX_URL)
    .then(function (r) { return r.json(); })
    .then(function (json) {
      data = json;
      fuse = makeFuse('both');
      var params = new URLSearchParams(window.location.search);
      var q = params.get('q');
      if (q) { input.value = q; }
      search();
    });

  input.addEventListener('input', search);

  document.querySelectorAll('input[name="scope"]').forEach(function (el) {
    el.addEventListener('change', rebuildAndSearch);
  });
}());
