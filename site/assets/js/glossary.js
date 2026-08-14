/* ============================================================================
   glossary.js — 詞彙 tooltip 的「增強」層
   ----------------------------------------------------------------------------
   注意 tooltip 本身是純 CSS（:hover / :focus-within）就能運作的，
   定義也已經由 build.mjs 烤進 HTML 裡。所以關掉 JS 一樣讀得到。

   這支檔案只做三件 CSS 做不到的事：
     1. 中／EN／雙語切換 + 記住選擇
     2. 觸控裝置的 tap-to-pin（觸控沒有 hover）
     3. 靠近視窗右緣時把 popover 翻回畫面內
   ============================================================================ */
/* eslint-env browser */
'use strict';

(function () {
  var H = document.documentElement;
  var TW = window.TW || {};

  /* ---- 1. 語言切換 ---------------------------------------------------- */

  function setLang(v) {
    if (['zh', 'en', 'both'].indexOf(v) < 0) v = 'zh';
    H.setAttribute('data-gloss', v);
    if (TW.progress) TW.progress.patch(function (s) {
      s.ui = s.ui || {}; s.ui.glossLang = v;
    });
    var btns = document.querySelectorAll('[data-gloss-btn]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed',
        String(btns[i].getAttribute('data-gloss-btn') === v));
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-gloss-btn]');
    if (b) setLang(b.getAttribute('data-gloss-btn'));
  });

  /* 開機時同步按鈕的 aria-pressed（值本身已由 shell 的 inline script 套好） */
  setLang(H.getAttribute('data-gloss') || 'zh');

  /* ---- 2. 觸控 tap-to-pin --------------------------------------------- */

  var hasHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;

  function unpinAll(except) {
    var pinned = document.querySelectorAll('.term[data-pinned="true"]');
    for (var i = 0; i < pinned.length; i++) {
      if (pinned[i] === except) continue;
      pinned[i].setAttribute('data-pinned', 'false');
      pinned[i].setAttribute('aria-expanded', 'false');
    }
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    /* 點在 popover 內部（例如「完整條目 →」）不要收合 */
    if (e.target.closest('.term__pop')) return;

    var t = e.target.closest('.term');
    unpinAll(t);
    if (!t) return;
    if (hasHover) return;          /* 桌機交給 CSS :hover */

    e.preventDefault();
    var on = t.getAttribute('data-pinned') !== 'true';
    t.setAttribute('data-pinned', String(on));
    t.setAttribute('aria-expanded', String(on));
    if (on) place(t);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') unpinAll(null);
  });

  /* 鍵盤操作：Enter / Space 也要能展開 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = document.activeElement;
    if (!t || !t.classList || !t.classList.contains('term')) return;
    e.preventDefault();
    var on = t.getAttribute('data-pinned') !== 'true';
    unpinAll(t);
    t.setAttribute('data-pinned', String(on));
    t.setAttribute('aria-expanded', String(on));
    if (on) place(t);
  });

  /* ---- 3. 邊緣翻轉 ----------------------------------------------------- */

  function place(term) {
    var pop = term.querySelector('.term__pop');
    if (!pop) return;
    /* 三個都要清掉。只清 left/top 的話，曾經往上翻過的 tooltip 會留著
       bottom，下一次就同時有 top 與 bottom —— 絕對定位的元素被兩邊拉住，
       高度會被撐開成一條，而且看起來只是「這個詞的說明框壞了」。 */
    pop.style.left = '';
    pop.style.top = '';
    pop.style.bottom = '';

    var r = pop.getBoundingClientRect();
    var pad = 8;

    if (r.right > window.innerWidth - pad) {
      pop.style.left = (window.innerWidth - pad - r.right) + 'px';
    }
    if (r.left < pad) {
      pop.style.left = (pad - r.left) + 'px';
    }
    /* 下方空間不足就翻到上方 */
    if (r.bottom > window.innerHeight - pad && r.height < term.getBoundingClientRect().top) {
      pop.style.top = 'auto';
      pop.style.bottom = 'calc(100% + .5em)';
    }
  }

  document.addEventListener('pointerover', function (e) {
    if (!e.target.closest) return;
    var t = e.target.closest('.term');
    if (t) place(t);
  }, { passive: true });

  document.addEventListener('focusin', function (e) {
    if (!e.target.closest) return;
    var t = e.target.closest('.term');
    if (t) place(t);
  });

})();
