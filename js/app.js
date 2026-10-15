(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  /* 简介等文本：转义后仅放行 <em>/<i>/<strong> 三种行内标记 */
  var richText = function (s) {
    return esc(s)
      .replace(/&lt;(\/?)(em|i|strong)&gt;/g, '<$1$2>')
      .replace(/\n/g, '<br>');
  };
  var hl = function (text, q) {
    var t = esc(text);
    if (!q) return t;
    var parts = q.split(/\s+/).filter(Boolean).map(function (p) {
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    if (!parts.length) return t;
    try {
      return t.replace(new RegExp('(' + parts.join('|') + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) { return t; }
  };

  /* ---------------- 极简 Markdown ---------------- */
  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (u.charAt(0) === '/' && u.charAt(1) !== '/') return u;
    return '';
  }
  function mdInline(t) {
    // t 已经是转义后的文本
    t = t.replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; });
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, function (m, alt, url) {
      var u = safeUrl(url);
      if (!u) return esc(alt);
      return '<img src="' + u + '" alt="' + alt + '" loading="lazy">';
    });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, url) {
      var u = safeUrl(url);
      if (!u) return txt;
      var ext = !/^#/.test(u) && /^https?:/i.test(u);
      return '<a href="' + u + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + txt + '</a>';
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    return t;
  }
  function md(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], buf = [], inCode = false, codeLang = '';

    function flush() {
      if (!buf.length) return;
      var para = buf.join('\n');
      out.push('<p>' + mdInline(para).replace(/\n/g, '<br>') + '</p>');
      buf = [];
    }
    function flushList(type, items) {
      if (!items.length) return;
      var tag = type === 'ol' ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map(function (x) { return '<li>' + mdInline(x) + '</li>'; }).join('') + '</' + tag + '>');
    }

    var listType = null, listItems = [];
    function endList() { flushList(listType, listItems); listType = null; listItems = []; }

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^\s*```/.test(ln)) {
        if (inCode) { out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); buf = []; inCode = false; }
        else { flush(); endList(); inCode = true; }
        continue;
      }
      if (inCode) { buf.push(ln); continue; }
      if (!ln.trim()) { flush(); endList(); continue; }
      var h = ln.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flush(); endList();
        var lv = Math.min(h[1].length, 6);
        out.push('<h' + lv + '>' + mdInline(esc(h[2])) + '</h' + lv + '>');
        continue;
      }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(ln)) { flush(); endList(); out.push('<hr>'); continue; }
      var q = ln.match(/^&gt;|^\s*&gt;\s?/);
      if (/^\s*>\s?/.test(ln)) {
        flush(); endList();
        out.push('<blockquote>' + mdInline(esc(ln.replace(/^\s*>\s?/, ''))) + '</blockquote>');
        continue;
      }
      void q;
      var li = ln.match(/^\s*[-*+]\s+(.*)$/);
      if (li) { flush(); if (listType !== 'ul') { endList(); listType = 'ul'; } listItems.push(esc(li[1])); continue; }
      var oi = ln.match(/^\s*\d+[.、)]\s+(.*)$/);
      if (oi) { flush(); if (listType !== 'ol') { endList(); listType = 'ol'; } listItems.push(esc(oi[1])); continue; }
      endList();
      buf.push(esc(ln));
    }
    if (inCode) out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
    else flush();
    endList();
    return out.join('\n');
  }

  var DB = null;
  var PHOTOS = null;        // data/photos.json：相册清单（可能与 db 分开维护）
  var pendingRoute = false;

  // 栏目页浏览状态缓存：{ 页面sid: { scroll:Number, open:[子栏目id...] } }
  // 从"正文"条目返回时，用于还原折叠状态与滚动位置
  var SEC_STATE = {};
  // 上一个页面（用于判断从哪个页面点进条目）
  var lastRoute = null;
  // 由上一次 render 得到的待还原滚动位置（渲染后由 restoreScroll 执行）
  var pendingScroll = null;
  // 二级菜单点入分组页时，待定位的子栏目 id（渲染后滚到该分组顶部）
  var pendingKid = null;

  // 当前页面被点击的条目所属栏目 sid → 其所在页面的 sid（分组页用父级）
  // 例：科研分组页里点开 talks 的正文 → 页面是 research
  function pageSidOf(sid) {
    var s = DB && DB.sections.filter(function (x) { return x.id === sid; })[0];
    if (!s) return sid;
    return s.parent ? s.parent : sid;
  }

  function saveSecState(pageSid) {
    if (!pageSid) return;
    var open = [];
    var ds = document.querySelectorAll('#view details.grp');
    for (var i = 0; i < ds.length; i++) {
      if (ds[i].open) {
        var k = ds[i].getAttribute('data-kid');
        if (k) open.push(k);
      }
    }
    SEC_STATE[pageSid] = { scroll: window.scrollY, open: open };
  }

  /* ---------------- load ---------------- */
  function load() {
    // 相册数据与主数据并行拉取；相册缺失（404/异常）时全站其余功能照常
    var photos = fetch('data/photos.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });

    return Promise.all([
      fetch('data/db.json').then(function (r) { return r.json(); }),
      photos
    ]).then(function (res) {
      DB = res[0];
      PHOTOS = res[1];
      renderChrome();
      route();                                  // 若之前因数据未到被跳过，这里会补上
      restoreScroll();
    }).catch(function () {
      $('#view').innerHTML = '<div class="empty">数据加载失败，请刷新页面重试。</div>';
    });
  }

  /* ---------------- chrome ---------------- */
  function renderChrome() {
    var p = DB.profile;
    document.title = p.tabTitle || (p.name + ' 学术主页');
    $('#siteName').innerHTML = esc(p.name) + (p.nameEn ? '<span class="name-en">' + esc(p.nameEn) + '</span>' : '');
    var bits;
    if (p.headline && String(p.headline).trim()) {
      bits = [String(p.headline).trim()];
    } else {
      bits = [p.affiliation, p.title].filter(function (x) { return x && String(x).trim(); });
      if (p.center) bits.push(p.center);
    }
    $('#siteAffil').textContent = bits.join(' · ');

    var nav = $('#nav');
    var top = DB.sections.filter(function (s) { return !s.parent; });
    var items = [{ id: 'home', name: '首页' }].concat(top.map(function (s) {
      return { id: s.id, name: s.name };
    }));
    nav.innerHTML = items.map(function (it) {
      var href = '#/' + (it.id === 'home' ? '' : 's/' + encodeURIComponent(it.id));
      var link = '<a href="' + href + '" data-nav="' + esc(it.id) + '">' + esc(it.name) + '</a>';
      var kids = DB.sections.filter(function (s) { return s.parent === it.id; });
      if (!kids.length) return link;
      // 有子栏目的顶级栏目：悬停/聚焦展开二级菜单，点击本身仍进入该栏目页
      // 二级项链接到父栏目页并定位到该分组（?to=kid），这样上下滚动还能看到相邻栏目
      return '<div class="nav-item">' + link +
        '<div class="nav-menu">' + kids.map(function (k) {
          return '<a href="#/s/' + encodeURIComponent(it.id) + '?to=' + encodeURIComponent(k.id) +
            '" data-nav="' + esc(k.id) + '">' + esc(k.name) + '</a>';
        }).join('') + '</div></div>';
    }).join('');

    $('#footNote').textContent = '© ' + new Date().getFullYear() + ' ' + p.name;
  }

  function markNav(id) {
    var raw = location.hash.replace(/^#/, '');
    var m = raw.match(/^\/s\/([^/?]+)/);
    var cur = m ? decodeURIComponent(m[1]) : '';
    var tm = raw.match(/[?&]to=([^&]*)/);            // 分组页里被定位的子栏目也高亮
    var to = tm ? decodeURIComponent(tm[1]) : '';
    var active = to || cur;
    var links = document.querySelectorAll('#nav a');
    for (var i = 0; i < links.length; i++) {
      var d = links[i].getAttribute('data-nav');
      var on = d === id || (active && d === active);  // 顶级栏目高亮（子栏目页高亮其父栏目）+ 当前子栏目
      links[i].classList.toggle('active', on);
    }
  }

  // 子栏目页 / 子栏目条目页归属到父导航（如 论文 → 科研）
  function navOf(sid) {
    var s = DB.sections.filter(function (x) { return x.id === sid; })[0];
    return (s && s.parent) ? s.parent : sid;
  }

  function secName(sid) {
    var s = DB.sections.filter(function (x) { return x.id === sid; })[0];
    return s ? s.name : '';
  }

  /* ---------------- item helpers ---------------- */
  function entryHtml(it, idx, q, sid) {
    var label = hl(it.title, q) || '<em style="color:var(--muted)">（无标题）</em>';
    var inner = null, tag = '';
    var lt = it.linkType || 'none';
    if (lt === 'text') {
      inner = '<a href="#/t/' + encodeURIComponent(sid) + '/' + encodeURIComponent(it.id) + '">' + label + '</a>';
      tag = '<span class="tag text">正文</span>';
    } else if ((lt === 'pdf' || lt === 'url') && it.url) {
      inner = '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + label + '</a>';
      tag = lt === 'pdf' ? '<span class="tag pdf">PDF</span>' : '<span class="tag link">链接</span>';
    }
    return '<li class="entry">' +
      '<span class="entry-no">' + (idx + 1) + '.</span>' +
      '<span class="entry-b">' +
        '<span class="entry-t">' + (inner || label) + tag + '</span>' +
        (it.note ? '<span class="entry-n">' + hl(it.note, q) + '</span>' : '') +
      '</span>' +
      '<span class="entry-y">' + (it.year ? esc(it.year) : '') + '</span>' +
    '</li>';
  }

  /* ---------------- views ---------------- */
  function viewHome() {
    var p = DB.profile;
    var h = '';

    if (p.bio) {
      h += '<section class="blk"><h2 class="blk-h">个人简介</h2>' +
        '<p class="bio">' + richText(p.bio) + '</p></section>';
    }

    var f = (p.researchfields || []).filter(function (x) { return x && String(x).trim(); });
    if (f.length) {
      h += '<section class="blk"><h2 class="blk-h">研究方向</h2><ul class="chips">' +
        f.map(function (x) { return '<li class="chip">' + esc(x) + '</li>'; }).join('') +
        '</ul></section>';
    }

    var rows = [
      ['办公地点', p.office],
      ['电子邮件', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : ''],
      ['微信公众号', '摩登语言学（ID：Modern_Linguistics）' +
        '<img class="qr" src="media/qrcode-modernling.jpg" alt="摩登语言学微信公众号二维码" loading="lazy">'],
      ['小红书', '摩登语言学（ID：HomoloquensLab）' +
        '<img class="qr" src="media/qrcode-xiaohongshu.jpg" alt="小红书二维码" loading="lazy">']
    ];
    var ls = (p.links || []).filter(function (l) { return l && l.url && String(l.url).trim(); });
    if (ls.length) {
      rows.push(['在线主页', ls.map(function (l) {
        return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label || l.url) + '</a>';
      }).join('　·　')]);
    }
    rows = rows.filter(function (r) { return r[1] && String(r[1]).trim(); });
    if (rows.length) {
      h += '<section class="blk"><h2 class="blk-h">联系方式</h2><dl class="kv">' +
        rows.map(function (r) {
          return '<div><dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd></div>';
        }).join('') + '</dl></section>';
    }

    // 右栏：三本著作封面（图片即超链接，链到豆瓣书页）
    var books = [
      { img: 'media/book-chatgpt.jpg', href: 'https://book.douban.com/subject/36791452/', alt: '《ChatGPT来了：语言科学如何看待ChatGPT》（杨旭 [美]罗仁地 主编，上海教育出版社）' },
      { img: 'media/book-mind.jpg', href: 'https://book.douban.com/subject/34926002/', alt: '《思维是平的》（[英]尼克·查特 著，杨旭 译，中信出版集团）' },
      { img: 'media/book-3.jpg', href: 'https://book.douban.com/subject/37238649/', alt: '杨旭著作封面' }
    ];
    var side = '<aside class="home-side">' + books.map(function (b) {
      return '<a class="book-link" href="' + esc(b.href) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(b.img) + '" alt="' + esc(b.alt) + '" loading="lazy"></a>';
    }).join('') + '</aside>';

    // 首页双栏：左 2/3（简介/研究方向/联系方式），右 1/3（著作封面）
    return '<div class="home-grid"><div class="home-main">' + h + '</div>' + side + '</div>';
  }

  /* ---------------- 摄影（相册：展示框 + 全部照片网格） ---------------- */
  function photoList() {
    return (PHOTOS && PHOTOS.items) || [];
  }

  function viewPhotos() {
    var items = photoList();
    if (!items.length) return '<p class="empty">相册暂无照片。</p>';
    var cells = items.map(function (p, i) {
      return '<button class="gal-cell" type="button" data-i="' + i + '" aria-label="查看第 ' + (i + 1) + ' 张照片">' +
        '<img src="' + esc(p.thumb) + '" alt="杨旭摄影作品" loading="lazy"></button>';
    }).join('');
    return '<div class="gal">' +
      '<div class="gal-stage" id="galStage">' +
        '<a class="gal-brand" href="#/" title="返回主页">杨旭摄影</a>' +
        '<img class="gal-img" id="galImg" src="' + esc(items[0].mid || items[0].full) + '" alt="杨旭摄影作品">' +
        '<button class="gal-arrow gal-prev" id="galPrev" type="button" aria-label="上一张">‹</button>' +
        '<button class="gal-arrow gal-next" id="galNext" type="button" aria-label="下一张">›</button>' +
        '<button class="gal-play" id="galPlay" type="button" aria-label="暂停轮播" title="暂停/播放">⏸</button>' +
        '<button class="gal-full" id="galFull" type="button" aria-label="全屏查看" title="全屏">⛶</button>' +
      '</div>' +
      '<div class="gal-grid" id="galGrid">' + cells + '</div>' +
    '</div>';
  }

  // 当前相册运行时状态
  var GAL = null;

  function shuffleIdx(n) {
    var a = [], i, j, t;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) {           // Fisher–Yates
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function initGallery() {
    var items = photoList();
    var stage = $('#galStage'), img = $('#galImg');
    if (!items.length || !stage || !img) return;

    var grid = $('#galGrid');
    var lb = null, lbImg = null;

    // 展示框/灯箱默认用中图（约 200KB，翻页即时）；真正全屏时才换高清大图
    function viewSrc(p) { return p.mid || p.full; }
    function maxSrc(p) { return p.full || p.mid; }
    function thumbSrc(p) { return p.thumb || p.mid || p.full; }

    GAL = {
      items: items,
      order: shuffleIdx(items.length),   // 随机顺序，从头到尾走完一遍才重新洗牌
      pos: 0,
      timer: null,
      playing: true,
      hiIdx: -1,             // 当前已在预加载/已应用高清图的照片下标（-1 表示用中图）
      pre: {},               // 预加载缓存：中图
      preFull: {},           // 预加载缓存：高清大图（灯箱/全屏时用）
      curFull: false,        // 当前 img 展示的是否为高清大图
      interval: Math.max(3, (PHOTOS && PHOTOS.interval) || 7) * 1000
    };
    var playBtn = $('#galPlay');
    function setPlayBtn() {
      if (!playBtn) return;
      playBtn.textContent = GAL.playing ? '⏸' : '▶';
      playBtn.setAttribute('aria-label', GAL.playing ? '暂停轮播' : '播放轮播');
    }

    function curIdx() { return GAL.order[GAL.pos]; }

    // 预加载当前位置前后各 N 张（含灯箱所需的图），鼠标点箭头时图已在缓存里，立刻出图
    var PRE = 6;
    var preWarm = false;          // 进相册后是否已做过一次全量后台预热
    function preload() {
      var n = GAL.order.length, d, k, i2, p;
      var big = (lb && lb.classList.contains('open')) || !!document.fullscreenElement || GAL.curFull;
      var pre = big ? GAL.preFull : GAL.pre;
      for (d = -PRE; d <= PRE; d++) {
        k = ((GAL.pos + d) % n + n) % n;
        i2 = GAL.order[k];
        if (i2 === GAL.hiIdx) continue;
        if (!pre[i2]) {
          p = items[i2];
          var im = new Image();
          im.decoding = 'async';
          im.src = big ? maxSrc(p) : viewSrc(p);
          pre[i2] = im;
        }
      }
      // 控制缓存规模，避免几十张图常驻内存
      var keys = Object.keys(pre);
      if (keys.length > PRE * 4) {
        if (big) GAL.preFull = {}; else GAL.pre = {};
      }
    }

    // 后台把所有中图预热进浏览器缓存：首次访问后，之后翻页基本是瞬时
    // 串行 + 空闲时段执行，避免抢占首屏与相邻图的带宽
    function warmAll() {
      if (preWarm) return;
      preWarm = true;
      var qi = GAL.order.slice(), qi2 = 0;
      function step() {
        if (!GAL) return;
        if (qi2 >= qi.length) return;
        var p = items[qi[qi2++]];
        var im = new Image();
        im.decoding = 'async';
        im.src = viewSrc(p);
        // 网络空闲时继续，否则让路
        var idle = window.requestIdleCallback
          ? function (fn) { window.requestIdleCallback(fn, { timeout: 2500 }); }
          : function (fn) { setTimeout(fn, 400); };
        im.onload = im.onerror = function () { idle(step); };
        setTimeout(step, 3000);   // 兜底：3 秒内没回调也继续
      }
      setTimeout(step, 2500);     // 等首屏与相邻图先出来
    }

    // 当前展示的照片索引对应的高清图是否已在缓存（用于决定是否直接上大图）
    function curReady() { return !!GAL.preFull[curIdx()] && GAL.preFull[curIdx()].complete; }

    function highlight() {
      var idx = curIdx();
      var cells = grid ? grid.querySelectorAll('.gal-cell') : [];
      for (var i = 0; i < cells.length; i++) {
        cells[i].classList.toggle('active', Number(cells[i].getAttribute('data-i')) === idx);
      }
    }

    // 点击/自动切换时立即出图：优先用已缓存的中图；
    // 若中图还没到，先用缩略图顶上（瞬间可见），中图到达后再无缝替换
    var wantIdx = -1, wantFull = false;
    function render() {
      var idx = curIdx(), p = items[idx];
      var big = (lb && lb.classList.contains('open')) || !!document.fullscreenElement || GAL.curFull;
      var src = big ? maxSrc(p) : viewSrc(p);
      wantIdx = idx; wantFull = big;
      GAL.curFull = big;

      img.src = src;
      if (lbImg) lbImg.src = src;

      // 缩略图兜底：大图尚未加载好时先显示缩略图，避免空白
      if (!img.complete || img.naturalWidth === 0) {
        var t = thumbSrc(p);
        if (img.getAttribute('data-ph') !== t) {
          img.setAttribute('data-ph', t);
          var probe = new Image();
          probe.onload = function () {
            // 兜底图先上，仅当用户还停在这张、且正式图仍未就绪时
            if (wantIdx === idx && (!img.complete || img.naturalWidth === 0)) {
              img.src = t;
            }
          };
          probe.src = t;
        }
      } else {
        img.removeAttribute('data-ph');
      }
      highlight();
      preload();
    }

    function next(manual) {
      GAL.pos++;
      if (GAL.pos >= GAL.order.length) {          // 一轮看完 → 重新洗牌
        GAL.order = shuffleIdx(items.length);
        GAL.pos = 0;
      }
      render();
      if (manual) restartTimer();
    }

    function prev() {
      GAL.pos = (GAL.pos - 1 + GAL.order.length) % GAL.order.length;
      render();
      restartTimer();
    }

    function goto(i) {                            // 点网格里的某张
      var p = GAL.order.indexOf(i);
      GAL.pos = p >= 0 ? p : 0;
      render();
      restartTimer();
    }

    function stopTimer() { if (GAL && GAL.timer) { clearInterval(GAL.timer); GAL.timer = null; } }
    function startTimer() {
      stopTimer();
      GAL.timer = setInterval(function () {
        if (!document.hidden && GAL.playing && !(lb && lb.classList.contains('open'))) next(false);
      }, GAL.interval);
    }
    function restartTimer() { startTimer(); }

    /* --- 全屏 --- */
    function toggleFull(el) {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
      } else if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    }

    // 全屏时才用高清大图（平时用中图，翻页才快）；退出全屏回到中图
    function applyHiRes() {
      var idx = curIdx(), p = items[idx];
      GAL.hiIdx = idx;
      img.src = maxSrc(p);
      if (lbImg) lbImg.src = maxSrc(p);
    }
    function dropHiRes() {
      var p = items[curIdx()];
      GAL.hiIdx = -1;
      img.src = viewSrc(p);
      if (lbImg) lbImg.src = viewSrc(p);
    }
    document.addEventListener('fullscreenchange', function () {
      if (!GAL) return;
      if (document.fullscreenElement) applyHiRes(); else dropHiRes();
    });

    /* --- 灯箱（点网格图片 → 全屏查看器） --- */
    function buildLightbox() {
      var d = document.createElement('div');
      d.className = 'lightbox';
      d.id = 'lightbox';
      d.innerHTML =
        '<button class="lb-close" type="button" aria-label="关闭">×</button>' +
        '<button class="lb-arrow lb-prev" type="button" aria-label="上一张">‹</button>' +
        '<img class="lb-img" id="lbImg" src="" alt="杨旭摄影作品">' +
        '<button class="lb-arrow lb-next" type="button" aria-label="下一张">›</button>' +
        '<button class="lb-full" type="button" aria-label="全屏查看" title="全屏">⛶</button>';
      document.body.appendChild(d);
      lb = d;
      lbImg = d.querySelector('#lbImg');

      d.querySelector('.lb-close').addEventListener('click', closeLightbox);
      d.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); prev(); });
      d.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); next(true); });
      d.querySelector('.lb-full').addEventListener('click', function (e) { e.stopPropagation(); toggleFull(d); });
      d.addEventListener('click', function (e) { if (e.target === d) closeLightbox(); });
    }

    function openLightbox(i) {
      if (!lb) buildLightbox();
      if (typeof i === 'number') goto(i);
      lb.classList.add('open');
      document.body.classList.add('lb-open');
      stopTimer();
      applyHiRes();               // 灯箱里看的是大图，这里才加载高清
      preload();                  // 预取相邻大图，灯箱内翻页也顺
    }

    function closeLightbox() {
      if (lb) lb.classList.remove('open');
      document.body.classList.remove('lb-open');
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      GAL.preFull = {};           // 释放高清缓存
      dropHiRes();
      startTimer();
    }

    /* --- 事件 --- */
    $('#galPrev').addEventListener('click', prev);
    $('#galNext').addEventListener('click', function () { next(true); });
    $('#galFull').addEventListener('click', function () { toggleFull(stage); });
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        GAL.playing = !GAL.playing;
        setPlayBtn();
        if (GAL.playing) startTimer(); else stopTimer();
      });
    }

    if (grid) {
      grid.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.gal-cell') : null;
        if (btn) openLightbox(Number(btn.getAttribute('data-i')));
      });
    }

    stage.addEventListener('mouseenter', stopTimer);   // 鼠标停在展示框上时暂停自动换片
    stage.addEventListener('mouseleave', function () { if (GAL.playing) startTimer(); });

    setPlayBtn();

    GAL.onKey = function (e) {
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (e.key === 'ArrowLeft') { prev(); }
      if (e.key === 'ArrowRight') { next(true); }
    };
    document.addEventListener('keydown', GAL.onKey);
    GAL.onVis = function () { if (!document.hidden && GAL && !GAL.timer) startTimer(); };
    document.addEventListener('visibilitychange', GAL.onVis);

    render();
    startTimer();
    warmAll();
  }

  function teardownGallery() {
    if (!GAL) return;
    if (GAL.timer) clearInterval(GAL.timer);
    if (GAL.onKey) document.removeEventListener('keydown', GAL.onKey);
    if (GAL.onVis) document.removeEventListener('visibilitychange', GAL.onVis);
    var lb = document.querySelector('#lightbox');
    if (lb && lb.parentNode) lb.parentNode.removeChild(lb);
    document.body.classList.remove('lb-open');
    GAL = null;
  }

  function viewSection(sid, to) {
    var s = DB.sections.filter(function (x) { return x.id === sid; })[0];
    if (!s) return '<p class="empty">栏目不存在。</p>';
    markNav(navOf(sid));

    // 相册栏目（摄影）：顶部展示框 + 全部照片网格
    if (s.type === 'gallery') return viewPhotos();

    // 分组栏目（如"科研"）：子栏目渲染为可展开区块，默认全部展开
    if (s.type === 'group') {
      var kids = DB.sections.filter(function (x) { return x.parent === sid; });
      if (!kids.length) return '<p class="empty">暂无内容。</p>';
      var st = SEC_STATE[sid] || null;
      // 从二级菜单点进来（to）：全展开，确保上下滚动能看到相邻栏目
      var openKids = to ? kids.map(function (k) { return k.id; })
        : (st ? st.open : kids.map(function (k) { return k.id; }));
      var g = '<div class="grps">' + kids.map(function (k) {
        var isOpen = openKids.indexOf(k.id) >= 0;
        return '<details class="grp" data-kid="' + esc(k.id) + '"' + (isOpen ? ' open' : '') + '>' +
          '<summary><span class="car">▸</span><span class="grp-name">' + esc(k.name) + '</span>' +
          '<span class="cnt">共 ' + k.items.length + ' 条</span></summary>' +
          '<div class="grp-body">' +
            (k.items.length
              ? '<ul class="entries">' + k.items.map(function (it, i) {
                  return entryHtml(it, i, '', k.id);
                }).join('') + '</ul>'
              : '<p class="empty">暂无内容。</p>') +
          '</div>' +
        '</details>';
      }).join('') + '</div>';
      return g;
    }

    var h = '<p class="page-meta">共 ' + s.items.length + ' 条</p><div class="rule"></div>';
    if (!s.items.length) {
      h += '<p class="empty">暂无内容。</p>';
      return h;
    }
    h += '<ul class="entries">' + s.items.map(function (it, i) {
      return entryHtml(it, i, '', sid);
    }).join('') + '</ul>';
    return h;
  }

  function viewItem(sid, iid) {
    var s = DB.sections.filter(function (x) { return x.id === sid; })[0];
    if (!s) return '<p class="empty">栏目不存在。</p>';
    var it = s.items.filter(function (x) { return x.id === iid; })[0];
    if (!it) return '<p class="empty">条目不存在。</p>';
    markNav(navOf(sid));
    // 返回目标 = 实际来源页面（可能是父级分组页，如从"科研"页点开"报告"里的条目）
    var backSid = (lastRoute && lastRoute.kind === 'section') ? lastRoute.sid : pageSidOf(sid);
    var h = '<p class="page-meta"><a class="back" href="#/s/' + encodeURIComponent(backSid) +
      '">← 返回</a></p>';
    h += '<h1 class="item-title">' + esc(it.title) + '</h1>';
    var sub = [];
    if (it.year) sub.push(esc(it.year));
    if (it.note) sub.push(esc(it.note));
    if (sub.length) h += '<p class="page-meta">' + sub.join('　·　') + '</p>';
    h += '<div class="rule"></div><article class="md">' + md(it.text || '') + '</article>';
    return h;
  }

  function viewSearch(q) {
    q = (q || '').trim();
    if (!q) return '<h1 class="page-title">搜索</h1><p class="empty">请输入关键词。</p>';
    var lower = q.toLowerCase();
    var uniq = {};
    var HITS = {};
    var total = 0;

    function add(gname, title, url, extra, sid, iid, lt) {
      var key = gname + '||' + title;
      if (uniq[key]) return;
      uniq[key] = 1;
      (HITS[gname] = HITS[gname] || []).push({
        title: title, url: url, extra: extra, sid: sid, iid: iid, lt: lt
      });
    }

    DB.sections.forEach(function (s) {
      var matchSec = s.name.toLowerCase().indexOf(lower) >= 0;
      s.items.forEach(function (it) {
        var blob = [it.title, it.note, it.year, it.text].join(' ').toLowerCase();
        if (matchSec || blob.indexOf(lower) >= 0) {
          add(s.name, it.title, (it.linkType && it.linkType !== 'none') ? it.url : '',
            it.year ? String(it.year) : '', s.id, it.id, it.linkType);
          total++;
        }
      });
    });

    var p = DB.profile;
    var pblob = [p.name, p.nameEn, String(p.bio || '').replace(/<[^>]+>/g, ''), p.office, p.email, p.affiliation, (p.researchfields || []).join(' '),
      (p.education || []).join(' ')].join(' ').toLowerCase();
    if (pblob.indexOf(lower) >= 0) {
      add('主页信息', p.name + '　' + p.affiliation, '', '个人简介 · 研究方向 · 联系方式');
      total++;
    }

    if (!total) {
      return '<h1 class="page-title">搜索结果</h1>' +
        '<p class="page-meta">关键词：' + esc(q) + '　未找到匹配内容</p>' +
        '<div class="rule"></div><p class="empty">没有找到相关条目，换个关键词试试。</p>';
    }

    var h = '<h1 class="page-title">搜索结果</h1>' +
      '<p class="page-meta">关键词：' + esc(q) + '　共 ' + total + ' 条</p><div class="rule"></div>';

    Object.keys(HITS).forEach(function (g) {
      h += '<section class="result-grp"><h3>' + esc(g) + '</h3><ul class="entries">' +
        HITS[g].map(function (r, i) {
          var yr = /^(?:19|20)\d{2}$/.test(r.extra) ? r.extra : '';
          var extra = yr ? '' : r.extra;
          var it = {
            id: r.iid, title: r.title, note: extra, year: yr || null,
            linkType: r.lt || (r.url ? (/\.pdf(\?|$)/i.test(r.url) ? 'pdf' : 'url') : 'none'),
            url: r.url
          };
          return entryHtml(it, i, q, r.sid);
        }).join('') + '</ul></section>';
    });
    return h;
  }

  /* ---------------- router ---------------- */
  function parseHash(h) {
    if (h.indexOf('/search') === 0) return { kind: 'search', q: decodeURIComponent(h.split('?q=')[1] || '') };
    if (h.indexOf('/t/') === 0) {
      var tp = h.slice(3).split('/');
      return { kind: 'item', sid: decodeURIComponent(tp[0]), iid: decodeURIComponent(tp[1] || '') };
    }
    if (h.indexOf('/s/') === 0) {
      var rest = h.slice(3);
      var qi = rest.indexOf('?');                       // 形如 /s/research?to=talks
      var sid = decodeURIComponent(qi < 0 ? rest : rest.slice(0, qi));
      var to = '';
      if (qi >= 0) {
        var mm = rest.slice(qi + 1).match(/(?:^|&)to=([^&]*)/);
        if (mm) to = decodeURIComponent(mm[1]);
      }
      return { kind: 'section', sid: sid, to: to };
    }
    return { kind: 'home' };
  }

  function route() {
    if (!DB) { pendingRoute = true; return; }   // 数据未到（深链/慢网）时先跳过，load() 完成后会补一次
    pendingRoute = false;
    var h = location.hash.replace(/^#/, '') || '/';
    var view = $('#view');
    var cur = parseHash(h);

    teardownGallery();   // 离开相册页时清掉轮播定时器与灯箱

    // 沉浸式相册（摄影）：隐藏页头页脚、纯黑背景；离开本页自动恢复
    document.body.classList.toggle('immersive',
      cur.kind === 'section' && cur.sid === 'photos');

    // 离开栏目页时，先记住其折叠状态与滚动位置
    if (lastRoute && lastRoute.kind === 'section') saveSecState(lastRoute.sid);

    // 二级菜单点入分组页（?to=kid）：定位到该分组；此时不还原旧滚动位置
    var jumpKid = (cur.kind === 'section' && cur.to) ? cur.to : null;
    // 从"正文"条目返回来源栏目页：还原折叠状态与滚动位置
    var restore = null;
    if (!jumpKid && cur.kind === 'section' && lastRoute && lastRoute.kind === 'item') {
      restore = SEC_STATE[cur.sid] || null;
    }

    pendingScroll = restore ? restore.scroll : null;
    pendingKid = jumpKid;

    if (cur.kind === 'search') {
      markNav('__none');
      view.innerHTML = viewSearch(cur.q);
      $('#searchInput').value = cur.q;
      lastRoute = cur;
      window.scrollTo(0, 0);
      return;
    }
    if (cur.kind === 'item') {
      view.innerHTML = viewItem(cur.sid, cur.iid);
      lastRoute = cur;
      window.scrollTo(0, 0);
      return;
    }
    if (cur.kind === 'section') {
      view.innerHTML = viewSection(cur.sid, cur.to);
      lastRoute = cur;
      var sec = DB.sections.filter(function (x) { return x.id === cur.sid; })[0];
      if (sec && sec.type === 'gallery') initGallery();
      if (pendingScroll == null && !pendingKid) window.scrollTo(0, 0);
      return;   // 有 pendingScroll / pendingKid 时由 restoreScroll() 在渲染完成后处理
    }
    markNav('home');
    view.innerHTML = viewHome();
    lastRoute = cur;
    window.scrollTo(0, 0);
  }

  // 渲染稳定后再定位，避免因布局未完成而滚错位置
  function restoreScroll() {
    // 二级菜单定位到某个分组：把该分组标题滚到视口顶部附近
    if (pendingKid) {
      var kid = pendingKid;
      pendingKid = null;
      var put = function () {
        var head = document.querySelector('.site-head');
        // 页头是 sticky 固定在顶部的，必须留出它的厚度，栏目标题才会露在页头下方
        var off = (head ? head.offsetHeight : 0) + 12;
        var ds = document.querySelectorAll('#view details.grp');
        for (var i = 0; i < ds.length; i++) {
          if (ds[i].getAttribute('data-kid') === kid) {
            var y = ds[i].getBoundingClientRect().top + window.scrollY - off;
            window.scrollTo(0, y < 0 ? 0 : y);
            return true;
          }
        }
        return false;
      };
      requestAnimationFrame(function () {
        put();
        requestAnimationFrame(function () { put(); });
        setTimeout(put, 180);            // 图片/懒加载可能改变高度，再校一次
      });
      return;
    }
    if (pendingScroll == null) return;
    var y = pendingScroll;
    pendingScroll = null;
    requestAnimationFrame(function () {
      window.scrollTo(0, y);
      requestAnimationFrame(function () { window.scrollTo(0, y); });
    });
  }

  /* ---------------- events ---------------- */
  window.addEventListener('hashchange', function () { route(); restoreScroll(); });

  // 二级菜单：点击"科研"或其中任一项后立即收起；鼠标/焦点离开该项后解除收起状态
  (function bindNavMenu() {
    var nav = $('#nav');
    var blurring = false;                       // 屏蔽由 blur() 触发的 focusout

    function release(e) {
      if (blurring) return;
      var item = e.target && e.target.closest ? e.target.closest('.nav-item') : null;
      if (!item) return;
      if (e.relatedTarget && item.contains(e.relatedTarget)) return;  // 仍在该项内（含二级菜单）
      item.classList.remove('menu-closed');
    }

    nav.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a || !nav.contains(a)) return;
      var item = a.closest('.nav-item');
      if (item) item.classList.add('menu-closed');
      if (document.activeElement === a) {       // 清掉 :focus-within，否则焦点停留会让菜单常驻
        blurring = true;
        a.blur();
        blurring = false;
      }
    });

    nav.addEventListener('mouseout', release);
    nav.addEventListener('focusout', release);
  })();

  // 手动折叠/展开子栏目时同步进缓存，保证返回后状态一致
  document.addEventListener('toggle', function (e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains('grp') && lastRoute && lastRoute.kind === 'section') {
      var s = SEC_STATE[lastRoute.sid] || (SEC_STATE[lastRoute.sid] = { scroll: 0, open: [] });
      var kid = el.getAttribute('data-kid');
      if (!kid) return;
      var i = s.open.indexOf(kid);
      if (el.open && i < 0) s.open.push(kid);
      if (!el.open && i >= 0) s.open.splice(i, 1);
    }
  }, true);

  $('#searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('#searchInput').value.trim();
    if (!q) { location.hash = '#/'; return; }
    location.hash = '#/search?q=' + encodeURIComponent(q);
  });

  load();
})();
