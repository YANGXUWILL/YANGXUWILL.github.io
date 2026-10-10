(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
  var pendingRoute = false;

  // 栏目页浏览状态缓存：{ 页面sid: { scroll:Number, open:[子栏目id...] } }
  // 从"正文"条目返回时，用于还原折叠状态与滚动位置
  var SEC_STATE = {};
  // 上一个页面（用于判断从哪个页面点进条目）
  var lastRoute = null;
  // 由上一次 render 得到的待还原滚动位置（渲染后由 restoreScroll 执行）
  var pendingScroll = null;

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
    return fetch('data/db.json').then(function (r) { return r.json(); }).then(function (d) {
      DB = d;
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
      return '<a href="#/' + (it.id === 'home' ? '' : 's/' + encodeURIComponent(it.id)) +
        '" data-nav="' + esc(it.id) + '">' + esc(it.name) + '</a>';
    }).join('');

    $('#footNote').textContent = '© ' + new Date().getFullYear() + ' ' + p.name;
  }

  function markNav(id) {
    var links = document.querySelectorAll('#nav a');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', links[i].getAttribute('data-nav') === id);
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
        '<p class="bio">' + esc(p.bio) + '</p></section>';
    }

    var f = (p.researchfields || []).filter(function (x) { return x && String(x).trim(); });
    if (f.length) {
      h += '<section class="blk"><h2 class="blk-h">研究方向</h2><ul class="chips">' +
        f.map(function (x) { return '<li class="chip">' + esc(x) + '</li>'; }).join('') +
        '</ul></section>';
    }

    var e = (p.education || []).filter(function (x) { return x && String(x).trim(); });
    if (e.length) {
      h += '<section class="blk"><h2 class="blk-h">教育经历</h2><ul class="edu">' +
        e.map(function (x) {
          var m = String(x).match(/^((?:19|20)\d{2}[^\u4e00-\u9fa5]{0,6}?(?:19|20)\d{2}[^　]*?)[　\s]+(.*)$/);
          if (m) {
            return '<li><span class="yr">' + esc(m[1].trim()) + '</span>' + esc(m[2].trim()) + '</li>';
          }
          return '<li>' + esc(x) + '</li>';
        }).join('') +
        '</ul></section>';
    }

    var rows = [
      ['职　务', p.title],
      ['单　位', p.affiliation],
      ['兼　职', p.center],
      ['办公地点', p.office],
      ['电子邮件', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : ''],
      ['微信公众号', '摩登语言学（ID：Modern_Linguistics）' +
        '<img class="qr" src="media/qrcode-modernling.jpg" alt="摩登语言学微信公众号二维码" loading="lazy">']
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

    return h;
  }

  function viewSection(sid) {
    var s = DB.sections.filter(function (x) { return x.id === sid; })[0];
    if (!s) return '<p class="empty">栏目不存在。</p>';
    markNav(navOf(sid));

    // 分组栏目（如"科研"）：子栏目渲染为可展开区块，默认全部展开
    if (s.type === 'group') {
      var kids = DB.sections.filter(function (x) { return x.parent === sid; });
      if (!kids.length) return '<p class="empty">暂无内容。</p>';
      var st = SEC_STATE[sid] || null;
      var openKids = st ? st.open : kids.map(function (k) { return k.id; });
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
    var pblob = [p.name, p.nameEn, p.bio, p.office, p.email, p.affiliation, (p.researchfields || []).join(' '),
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
    if (h.indexOf('/s/') === 0) return { kind: 'section', sid: decodeURIComponent(h.slice(3)) };
    return { kind: 'home' };
  }

  function route() {
    if (!DB) { pendingRoute = true; return; }   // 数据未到（深链/慢网）时先跳过，load() 完成后会补一次
    pendingRoute = false;
    var h = location.hash.replace(/^#/, '') || '/';
    var view = $('#view');
    var cur = parseHash(h);

    // 离开栏目页时，先记住其折叠状态与滚动位置
    if (lastRoute && lastRoute.kind === 'section') saveSecState(lastRoute.sid);

    // 从"正文"条目返回来源栏目页：还原折叠状态与滚动位置
    var restore = null;
    if (cur.kind === 'section' && lastRoute && lastRoute.kind === 'item') {
      restore = SEC_STATE[cur.sid] || null;
    }

    pendingScroll = restore ? restore.scroll : null;

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
      view.innerHTML = viewSection(cur.sid);
      lastRoute = cur;
      if (pendingScroll == null) window.scrollTo(0, 0);
      return;   // 有 pendingScroll 时由 restoreScroll() 在渲染完成后处理
    }
    markNav('home');
    view.innerHTML = viewHome();
    lastRoute = cur;
    window.scrollTo(0, 0);
  }

  // 渲染稳定后再定位，避免因布局未完成而滚错位置
  function restoreScroll() {
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
