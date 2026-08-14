/* ============================================================================
   glossary-page.js — 詞彙表頁的即時篩選
   ============================================================================ */
/* eslint-env browser */
'use strict';

(function () {
  var input = document.getElementById('gsearch');
  if (!input) return;

  var items = Array.prototype.slice.call(document.querySelectorAll('.gitem'));
  var index = items.map(function (el) {
    var g = (window.TW_GLOSSARY || {})[el.querySelector('h2').textContent.split(' ')[0]] || {};
    return {
      el: el,
      hay: (el.textContent + ' ' + (g.aka || []).join(' ')).toLowerCase()
    };
  });

  var empty = document.createElement('p');
  empty.className = 'note';
  empty.textContent = '沒有符合條件的術語。';
  empty.hidden = true;
  input.closest('.mhead').parentNode.appendChild(empty);

  function filter() {
    var q = input.value.trim().toLowerCase();
    var n = 0;
    index.forEach(function (it) {
      var hit = !q || it.hay.indexOf(q) >= 0;
      it.el.hidden = !hit;
      if (hit) n++;
    });
    empty.hidden = n > 0;
  }

  input.addEventListener('input', filter);

  /* 從 module 頁面點「完整條目 →」跳過來時，把該條目高亮一下 */
  function flash() {
    var id = location.hash.slice(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.style.transition = 'background .3s';
    el.style.background = 'var(--term-bg)';
    setTimeout(function () { el.style.background = ''; }, 1400);
  }
  window.addEventListener('hashchange', flash);
  flash();

})();
