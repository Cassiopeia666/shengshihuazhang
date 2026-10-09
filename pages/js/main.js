document.addEventListener('DOMContentLoaded', () => {

  /* 滚动进度条 */
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.appendChild(bar);

  /* 回到顶部按钮 */
  const toTop = document.createElement('button');
  toTop.className = 'to-top';
  toTop.type = 'button';
  toTop.title = '回到顶部';
  toTop.setAttribute('aria-label', '回到顶部');
  toTop.textContent = '↑';
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(toTop);

  /* 二级页页头光晕层 */
  const ph = document.querySelector('.page-hero');
  if (ph) {
    const l = document.createElement('div');
    l.className = 'ph-layer';
    l.setAttribute('data-parallax', '0.16');
    ph.insertBefore(l, ph.firstChild);
  }

  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) toggle.addEventListener('click', () => links.classList.toggle('open'));

  /* 当前页导航：进入时轻微上浮 */
  const activeNav = document.querySelector('.nav-links a.active');
  if (activeNav) {
    activeNav.classList.add('settling');
    requestAnimationFrame(() => requestAnimationFrame(() => activeNav.classList.remove('settling')));
  }

  /* 点击其它页面时，当前页下划线回缩成点再跳转 */
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      const cur = document.querySelector('.nav-links a.active');
      if (cur && cur !== a) {
        e.preventDefault();
        cur.classList.add('retract');
        setTimeout(() => { window.location.href = href; }, 200);
      }
    });
  });

  // 年份：跳过 <select>（投稿页的"拍摄年份"下拉也用了 #year），避免把选项清空
  document.querySelectorAll('#year, #year-copy, [data-year]').forEach(function (el) {
    if (el.tagName !== 'SELECT') el.textContent = new Date().getFullYear();
  });

  /* ---- 五大板块：注入金线 + 光扫层 ---- */
  const NS = 'http://www.w3.org/2000/svg';
  const animCards = Array.from(document.querySelectorAll('.board-grid .anim-card'));
  animCards.forEach(card => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'card-stroke');
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('pathLength', '100');
    svg.appendChild(rect);
    card.appendChild(svg);

    const sheen = document.createElement('div');
    sheen.className = 'card-sheen';
    card.appendChild(sheen);

    card.addEventListener('mousemove', (e) => {
      if (card.classList.contains('is-big')) return;   // 放大态的主卡不倾斜，小卡保留金光+倾斜
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.transition = 'transform .12s linear, box-shadow .35s ease';
      card.style.transform =
        'perspective(1000px) rotateX(' + ((0.5 - py) * 9).toFixed(2) + 'deg) rotateY(' +
        ((px - 0.5) * 11).toFixed(2) + 'deg) translateY(-6px)';
      card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    });
    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform .5s cubic-bezier(.2,.7,.3,1), box-shadow .5s ease';
      card.style.transform = '';
    });
  });

  /* 让金线贴合卡片真实尺寸 */
  // forced：可选的已知尺寸数组，传入时不再读 DOM（避免每帧强制同步布局）
  const fitStroke = (forced) => {
    animCards.forEach((card, ci) => {
      const svg = card.querySelector('.card-stroke');
      if (!svg) return;
      let W, H;
      if (forced && forced[ci]) { W = Math.round(forced[ci].w); H = Math.round(forced[ci].h); }
      else { W = card.offsetWidth; H = card.offsetHeight; }
      if (!W || !H) return;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('preserveAspectRatio', 'none');   // 关掉等比缩放，1:1 映射到盒子
      const rect = svg.querySelector('rect');
      rect.setAttribute('x', '1'); rect.setAttribute('y', '1');
      rect.setAttribute('width', Math.max(1, W - 2));
      rect.setAttribute('height', Math.max(1, H - 2));
      rect.setAttribute('rx', '13'); rect.setAttribute('ry', '13');
    });
  };
  fitStroke();

  /* ---- 渐入（位置检测：先批量读、再批量写）---- */
  let pending = Array.from(document.querySelectorAll('.reveal'));
  const revealInView = () => {
    if (!pending.length) return;
    const h = window.innerHeight;
    const hit = [];
    for (const el of pending) {
      if (el.getBoundingClientRect().top < h * 0.92) hit.push(el);
    }
    if (!hit.length) return;
    for (const el of hit) el.classList.add('in');
    pending = pending.filter(el => hit.indexOf(el) === -1);
  };

  /* 卡片错峰入场 */
  let pendingCards = animCards.slice();
  const cardsInView = () => {
    if (!pendingCards.length) return;
    const h = window.innerHeight;
    const hit = [];
    for (const el of pendingCards) {
      if (el.getBoundingClientRect().top < h * 0.9) hit.push(el);
    }
    if (!hit.length) return;
    hit.forEach((el, k) => setTimeout(() => el.classList.add('in'), k * 130));
    pendingCards = pendingCards.filter(el => hit.indexOf(el) === -1);
  };

  /* ---- 滚动视差集合 ---- */
  const px = Array.from(document.querySelectorAll('[data-parallax]'));
  const heroEl = document.querySelector('.hero');
  if (heroEl) requestAnimationFrame(() => requestAnimationFrame(() => heroEl.classList.add('ready')));

  /* ---- 统一的滚动处理：整页一个滚动监听 + 一个 rAF ---- */
  let ticking = false;
  const onScrollFrame = () => {
    const y = window.scrollY;
    const h = window.innerHeight;

    revealInView();
    cardsInView();

    const sp = h * 0.5;
    for (const el of px) {
      const k = parseFloat(el.dataset.parallax) || 0;
      const t = Math.max(-sp, Math.min(y * k, sp));
      el.style.transform = 'translate3d(0,' + t.toFixed(1) + 'px,0)';
    }

    const total = document.documentElement.scrollHeight - h;
    if (bar) bar.style.width = (total > 0 ? Math.min(100, (y / total) * 100) : 0) + '%';
    if (toTop) toTop.classList.toggle('show', y > h * 0.8);
    if (heroEl) heroEl.classList.toggle('phase2', y > h * 0.12);

    ticking = false;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScrollFrame);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { fitStroke(); onScroll(); });
  window.addEventListener('load', onScroll);
  onScrollFrame();

  /* 照片灯箱 */
  const lightbox = document.getElementById('lightbox');
  if (lightbox) {
    const img = lightbox.querySelector('img');
    const cap = lightbox.querySelector('.lb-cap');
    const close = lightbox.querySelector('.lb-close');
    document.querySelectorAll('.photo[data-src]').forEach(p => {
      p.addEventListener('click', () => {
        img.src = p.dataset.src;
        cap.textContent = p.dataset.caption || '';
        lightbox.classList.add('open');
      });
    });
    const hide = () => lightbox.classList.remove('open');
    close.addEventListener('click', hide);
    lightbox.addEventListener('click', e => { if (e.target === lightbox) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  }

  /* 投稿表单 —— ★ 2026-10-08 已移交 submit.html 自己的脚本处理。
     原因：原来这里用 Object.fromEntries(new FormData(form)) 取数据，
     图片字段拿到的是 File 对象，JSON.stringify 之后会变成 {} —— 照片整个丢失。
     而且写入的 'submissions' 键没有任何页面读取，等于存了个死数据。
     现在改成由 submit.html + js/submit-store.js 处理：
     照片先压缩成 dataURL 再入库存，见证页能直接读出来显示。
     这段旧逻辑保留注释仅作记录，不再执行。 */

  /* ==== 五大板块：点击聚拢展开（JS 逐帧插值，保证连贯生长） ==== */
  const grid = document.querySelector('.board-grid');
  const section = grid ? grid.closest('.section') : null;
  if (grid && animCards.length) {
    let expandedCard = null, savedRects = null, savedH = 0, rafId = null, safetyId = null, smallOn = false;

    animCards.forEach((card) => {
      const media = document.createElement('div');
      media.className = 'card-media';
      const img = document.createElement('img');
      img.alt = '';
      const src = card.getAttribute('data-img');
      if (src) img.src = src;                 // 有图就加载，没图则只显示占位
      const ph = document.createElement('span');
      ph.className = 'ph';
      if (!src) ph.textContent = '图片待补充';
      media.appendChild(img);
      media.appendChild(ph);
      card.appendChild(media);

      const enter = document.createElement('a');
      enter.className = 'card-enter';
      enter.textContent = '进入板块 →';
      enter.href = card.getAttribute('href') || '#';
      card.appendChild(enter);

      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-enter')) return;
        /* ★★★ 2026-10-09：原来这里有一道 window.innerWidth < 900 的守卫 ✗
           窄屏下直接 return ✗ 卡片点击放大 + 挤压的整套动效在手机上完全失效 ✗
           点上去只会跳转 ✗ 用户要求「和电脑浏览完全一样的效果」。
           现在把门槛降到 320px（比任何在用机型都窄 ✗ 等于不设限 ✓）。
           挤压动画本身是按 grid 的实际矩形算的 ✗ 与视口宽度无关 ✗ 所以能直接跑。 */
        if (window.innerWidth < 320) return;
        e.preventDefault();
        if (expandedCard === card) collapseAll();
        else expandCard(card);              // 已有放大卡时，直接切换并重新生长
      });
    });

    const roundRect = (r) => ({ left: Math.round(r.left), top: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height) });

    const rectOf = () => {
      const gr = grid.getBoundingClientRect();
      return animCards.map(c => roundRect({
        left: c.getBoundingClientRect().left - gr.left,
        top: c.getBoundingClientRect().top - gr.top,
        width: c.getBoundingClientRect().width,
        height: c.getBoundingClientRect().height
      }));
    };
    const setRects = (rects) => {
      animCards.forEach((c, i) => {
        const r = rects[i];
        c.style.left = r.left + 'px'; c.style.top = r.top + 'px';
        c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
      });
    };

    /* 五种落位：大卡等比放大（旁卡随之变窄），其余卡片更扁更窄并居中 */
    const K_BIG = 2.25;      // 中间卡放大时大卡的倍数（两侧夹击）
    const K_SIDE = 0.58;     // 旁卡目标宽度比例（越小旁卡越窄）
    const K_SMALL_W = 0.84;  // 底排卡片宽度比例
    const K_SMALL_H = 0.46;  // 底排卡片高度比例（很扁）

    const targets = (bigIdx, W, u, nh) => {
      /* ══════════════════════════════════════════════════════════════
         ★★★ 2026-10-09：窄容器专用布局
         ──────────────────────────────────────────────────────────────
         桌面那套算法建立在一个前提上：容器宽 W 远大于单元宽 u
         （桌面 W≈1100 ✗ u≈296 ✗ 侧卡占 0.58u=172 ✗ 大卡还剩 908 ✓）。
         但在手机上 ✗ .board-grid 的卡片会被 flex 拉满整行 ✗ u 等于 W ✗
         于是 sideTarget = 0.58W ✗ 大卡只剩 W-0.58W-20
         ✗ 342px 的容器算出 124px 的大卡 —— 比一张邮票大不了多少。

         窄容器（< 620px）改用一套简单得多的布局：
           大卡：整宽 ✗ 高度按原卡长宽比换算（不变形）
           小卡：两列 ✗ 依次往下排 ✗ 保持「扁」的观感
         动效本身完全不动 —— tween 只是把矩形从一个状态插值到另一个 ✓
         ══════════════════════════════════════════════════════════════ */
      const R0 = (l, t, w, h) => ({ left: Math.round(l), top: Math.round(t),
        width: Math.round(w), height: Math.round(h) });
      if (W < 620) {
        const gn = 14;
        const bigW = W;
        const bigH = Math.round(bigW * nh / u);      // 等比 ✗ 不变形
        const sw = Math.floor((W - gn) / 2);
        const sh = Math.max(72, Math.round(K_SMALL_H * nh));
        const outN = new Array(animCards.length);
        const flatN = [];
        outN[bigIdx] = R0(0, 0, bigW, bigH);
        const rest = [];
        for (let i = 0; i < animCards.length; i++) if (i !== bigIdx) rest.push(i);
        rest.forEach(function (ci, k) {
          const col = k % 2, rw = Math.floor(k / 2);
          outN[ci] = R0(col * (sw + gn), bigH + gn + rw * (sh + gn), sw, sh);
          flatN.push(ci);
        });
        return { rects: outN, gridH: bigH + gn + 2 * sh + gn, flat: flatN };
      }

      const g = 20;
      const sideTarget = Math.round(K_SIDE * u);
      // 中间卡放大时两侧夹击、大卡取固定倍数；其余情况旁卡定宽，大卡吃满剩余宽度
      const bigW = (bigIdx === 1)
        ? Math.min(Math.round(K_BIG * u), W - 2 * g)
        : Math.min(W - sideTarget - g, W - 2 * g);
      const bigH = Math.round(bigW * nh / u);        // 等比放大，长宽比不变
      const smallW = Math.round(K_SMALL_W * u);      // 更窄
      const smallH = Math.round(K_SMALL_H * nh);     // 更扁
      const R = (l, t, w, h) => ({ left: Math.round(l), top: Math.round(t), width: Math.round(w), height: Math.round(h) });
      const out = new Array(animCards.length);
      const inRow1 = bigIdx <= 2;
      const bigTop = inRow1 ? 0 : smallH + g;
      const smallTop = inRow1 ? bigH + g : 0;

      const flat = [];                               // 需要「扁卡排版」的卡片索引
      const row = (list) => {                        // 小卡居中排列
        const n = list.length;
        let l = (W - (n * smallW + (n - 1) * g)) / 2;
        list.forEach(i => { out[i] = R(l, smallTop, smallW, smallH); flat.push(i); l += smallW + g; });
      };
      const side = (l, i) => { out[i] = R(l, bigTop, W - bigW - g, bigH); };

      if (bigIdx === 0) {
        out[0] = R(0, 0, bigW, bigH);
        side(bigW + g, 1);
        row([2, 3, 4]);
      } else if (bigIdx === 1) {
        const sw = Math.max(70, Math.round((W - bigW - 2 * g) / 2));
        out[0] = R(0, 0, sw, bigH);
        out[1] = R(sw + g, 0, bigW, bigH);
        out[2] = R(sw + g + bigW + g, 0, sw, bigH);
        row([3, 4]);
      } else if (bigIdx === 2) {
        side(0, 0);
        out[2] = R(W - bigW, 0, bigW, bigH);
        row([1, 3, 4]);
      } else if (bigIdx === 3) {
        row([0, 1, 2]);
        out[3] = R(0, bigTop, bigW, bigH);
        side(bigW + g, 4);
      } else {
        row([0, 1, 2]);
        out[4] = R(W - bigW, bigTop, bigW, bigH);
        side(0, 3);
      }
      return { rects: out, gridH: Math.round(bigH + g + smallH), flat: flat };
    };

    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    /* JS 逐帧插值：位置 / 尺寸 / 容器高度 同步变化 */
    const tween = (from, to, fromH, toH, dur, onProgress, onDone) => {
      if (rafId) cancelAnimationFrame(rafId);
      if (safetyId) clearTimeout(safetyId);
      const t0 = performance.now();
      let done = false;
      grid.classList.add('animating');

      const finish = () => {                     // 安全落位：rAF 被节流也能保证终态
        if (done) return;
        done = true;
        rafId = null; safetyId = null;
        grid.classList.remove('animating');
        setRects(to);
        grid.style.height = toH + 'px';
        if (typeof fitStroke === 'function') fitStroke();
        if (onProgress) onProgress(1);
        if (onDone) onDone();
      };
      const step = (now) => {
        if (done) return;
        const p = Math.min(1, (now - t0) / dur);
        const e = easeOut(p);
        const sizes = new Array(animCards.length);
        animCards.forEach((c, i) => {
          const a = from[i], b = to[i];
          const w = Math.max(1, Math.round(a.width + (b.width - a.width) * e));   // 尺寸取整，减少文字逐像素重排
          const h = Math.max(1, Math.round(a.height + (b.height - a.height) * e));
          c.style.left = (a.left + (b.left - a.left) * e).toFixed(1) + 'px';
          c.style.top = (a.top + (b.top - a.top) * e).toFixed(1) + 'px';
          c.style.width = w + 'px';
          c.style.height = h + 'px';
          sizes[i] = { w: w, h: h };
        });
        grid.style.height = Math.round(fromH + (toH - fromH) * e) + 'px';
        if (typeof fitStroke === 'function') fitStroke(sizes);   // 金框跟随，且不再读 DOM
        if (onProgress) onProgress(e);
        if (p < 1) rafId = requestAnimationFrame(step);
        else finish();
      };
      rafId = requestAnimationFrame(step);
      safetyId = setTimeout(finish, dur + 320);
    };

    /* 展开 / 切换到另一张卡，两种都走完整的生长动画 */
    function expandCard(card) {
      const idx = animCards.indexOf(card);
      if (idx < 0 || expandedCard === card) return;

      let from, fromH;
      if (!expandedCard) {
        // 首次展开：先锁定常态位置，再切绝对定位
        animCards.forEach(c => { c.style.transform = ''; });
        savedRects = rectOf();
        savedH = Math.round(grid.getBoundingClientRect().height);
        grid.classList.add('expanded');
        if (section) section.classList.add('card-open');
        grid.style.height = savedH + 'px';
        setRects(savedRects);
        void grid.offsetHeight;
        from = savedRects;
        fromH = savedH;
      } else {
        // 已在展开态：不收起，直接从当前形态生长到新布局
        from = rectOf();
        fromH = Math.round(grid.getBoundingClientRect().height);
        expandedCard.classList.remove('is-big');
      }

      const u = savedRects[0].width;      // 常态单元宽（始终用首次记录的值）
      const nh = savedRects[0].height;
      const t = targets(idx, grid.clientWidth, u, nh);

      animCards.forEach(c => c.classList.remove('floaty'));
      card.classList.add('is-big');
      expandedCard = card;
      smallOn = false;

      // 被挤的卡片在动画进行到约 1/3 时才切换排版，避免开头文字先跳
      tween(from, t.rects, fromH, t.gridH, 700, (e) => {
        if (!smallOn && e > 0.34) {
          smallOn = true;
          animCards.forEach((c, i) => {
            if (c === card) { c.classList.remove('is-small', 'is-flat'); return; }
            c.classList.add('is-small');
            if (t.flat.indexOf(i) >= 0) c.classList.add('is-flat');
            else c.classList.remove('is-flat');
          });
        }
      }, () => {
        if (!expandedCard) return;
        animCards.forEach((c, i) => {
          if (c !== expandedCard) {
            c.style.animationDelay = (i * 0.42).toFixed(2) + 's';
            c.classList.add('floaty');
          }
        });
      });
    }

    function collapseAll() {
      if (!expandedCard) return;
      const card = expandedCard;
      expandedCard = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      animCards.forEach(c => c.classList.remove('floaty'));

      const cur = rectOf();
      const curH = Math.round(grid.getBoundingClientRect().height);
      smallOn = false;

      tween(cur, savedRects, curH, savedH, 620, (e) => {
        if (e > 0.42) animCards.forEach(c => c.classList.remove('is-big', 'is-small', 'is-flat'));
      }, () => {
        if (expandedCard) return;
        grid.classList.remove('expanded');
        if (section) section.classList.remove('card-open');
        grid.style.height = '';
        animCards.forEach(c => {
          ['left', 'top', 'width', 'height', 'animation-delay'].forEach(k => c.style.removeProperty(k));
        });
      });
    }

    document.addEventListener('click', (e) => {
      if (!expandedCard) return;
      if (e.target.closest('.board-grid .card')) return;
      collapseAll();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') collapseAll(); });
    window.addEventListener('pageshow', collapseAll);
    let lastGridW = grid.clientWidth;
    window.addEventListener('resize', () => {
      const w = grid.clientWidth;
      if (Math.abs(w - lastGridW) < 4) return;
      lastGridW = w;
      if (expandedCard) collapseAll();
    });

    window.__cards = { expand: (i) => expandCard(animCards[i]), collapse: collapseAll, isOpen: () => !!expandedCard };

    /* ══════════════════════════════════════════════════════════════════
       ★★★ 2026-10-10 窄屏：容器窄时摆成「一大四小」✗ 大卡是「我们的构想」
       ──────────────────────────────────────────────────────────────────
       窄屏下五张卡在常态是竖着一条排下来的 ✗ 要划好几屏才看得完 ✗
       而且「我们的构想」是最后一张 ✗ 永远在很下面。
       用户要求：小屏进来就是「最上面一张大卡 + 下面四张小的」这套布局 ✗
       大卡放「我们的构想」（它是五张里唯一不跳转的 ✗ 当封面最合适）。

       ★ 2026-10-10 补：原来只在加载时判断一次 ✗ 用户手动把窗口缩窄时
         布局不会跟着变 ✗ 而且下面那个 resize 监听器在宽度变化时只会
         collapseAll() ✗ 从来不重新展开 ✗ 所以缩窄后反而回到竖排一列。
         现在改成：宽度变化时重新判断 ✗ 并做 180ms 防抖 ✗
         这样拖动窗口边缘就能实时看到布局切换。
       ══════════════════════════════════════════════════════════════════ */
    (function narrowLayout(){
      var NARROW = 620;
      var state = null, timer = null, armed = false;

      function apply(){
        if (!armed) return;
        var narrow = grid.clientWidth < NARROW;
        if (narrow === state) return;
        state = narrow;
        if (narrow){
          if (!expandedCard && animCards.length){
            expandCard(animCards[animCards.length - 1]);   /* 「我们的构想」 */
          }
        } else {
          if (expandedCard) collapseAll();
        }
      }

      /* 首次：等布局稳定再判断 */
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        setTimeout(function(){ armed = true; apply(); }, 120);
      }); });

      /* 之后：窗口尺寸变化时重新判断（防抖 ✗ 免得拖窗口时反复触发展开动画） */
      window.addEventListener('resize', function(){
        clearTimeout(timer);
        timer = setTimeout(function(){
          /* 内置的 resize 监听器可能刚把展开态收掉了 ✗ 等它做完再判断 */
          requestAnimationFrame(apply);
        }, 180);
      });
    })();
  }

  window.__shReady = true;

  /* ==== 卷轴 · 全滚动驱动（群众活动页） ====
     不再点按钮自动展开。整段行程都靠滚动条位置推进：
       行程 [0, UNROLL_END]        卷轴宽度 + --unroll（卷轴与底图同速率展开）
       行程 [UNROLL_END, 1]        标题淡出 → 介绍浮现/淡出 → 黄河从左生长
     这样用户滚到哪儿，卷轴就展开到哪儿，可以随意来回搓。 */
  (function () {
    const story = document.getElementById('scroll-story');
    if (!story) return;
    const pin = story.querySelector('.scroll-pin');
    const stage = document.getElementById('scroll-stage');
    if (!pin || !stage) return;

    const isDesktop = () => window.innerWidth >= 900;
    const NAV_H = 81;
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const easeInOutQuart = (t) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    const easeUnroll = (t) => t < 0.18
      ? easeInOutQuart(t / 0.18) * 0.06
      : 0.06 + easeInOutQuart((t - 0.18) / 0.82) * 0.94;

    const CLOSED_W = 116;   /* ★ 与 CSS 同步：两根 58px 纸卷在 58 处相切，互不遮盖 */
    /* ★ 展开占整段行程的前 28%；其余留给叙事 */
    const UNROLL_END = 0.28;
    let openW = 0;

    const pgTitle = document.getElementById('pgTitle');
    const pgIntro = document.getElementById('pgIntro');

    /* 叙事断点（相对展开之后的进度 q，0~1） */
    const PH = {
      /* ★ 标题三段：浮现 → 停留 → 消失（不再是一边淡入一边淡出） */
      titleIn:  [0.03, 0.10],   // 淡入
      titleOut: [0.24, 0.34],   // 淡出（0.10~0.24 是停留段）
      introIn: [0.36, 0.42], introOut: [0.50, 0.58],
      /* ★ 黄河：把前面的阶段压紧，给河流留出最大区间。
           原来只有 [0.78, 0.96]（0.18），支流之间只隔 0.06~0.14，
           换算成时间几乎同时开始；现在是 0.42，慢了 2.3 倍。 */
      /* ★ 海岸线：介绍消失之后自己淡入 */
      coast: [0.58, 0.68],
      /* ★ 黄河：等海岸线淡入完成之后再开始生长 */
      /* ★ 黄河在 0.92 处就画完，留出最后 8% 的行程。
         原来写 [0.70, 1.00]，「画完」正好等于「滚到底」——所以黄河还没画完
         页面就已经往下走了，看着像最后一个粘滞没了。 */
      river: [0.66, 0.92]
    };

    const storyProgress = () => {
      const range = story.offsetHeight - pin.offsetHeight;
      if (range <= 0) return 0;
      return clamp01((window.scrollY - story.offsetTop + NAV_H) / range);
    };

    const fadeIn = (p, a, b) => clamp01((p - a) / (b - a));
    const fadeOut = (p, a, b) => 1 - clamp01((p - a) / (b - a));
    function seq(p, inA, inB, outA, outB) {
      if (p < inA) return { o: 0, d: 1 };
      if (p < inB) { const t = fadeIn(p, inA, inB); return { o: t, d: 1 - t }; }
      if (p < outA) return { o: 1, d: 0 };
      if (p < outB) { const t = fadeOut(p, outA, outB); return { o: t, d: -t }; }
      return { o: 0, d: -1 };
    }

    const placeNodes = () => {
      const gtBox = story.querySelector('.gt');
      /* ★★★ 2026-10-10 窄屏适配：去掉 isDesktop 限制
         光点位置是按黄河 SVG 的屏幕坐标算的（svg.getScreenCTM + data-map）✗
         这套算法与视口宽度、甚至与卷轴有没有旋转都无关 ✗ 任何布局下都成立。
         但原来这里有一道 !isDesktop() 的拦截 ✗ 窄屏下直接 return ✗
         于是六个光点一直停在【桌面布局时的初始位置】✗
         卷轴转了 90° 之后它们自然就全部错位了（用户反馈的"光点错位"）。
         去掉拦截即可 ✗ 算法本身一行没动。 */
      if (!gtBox) return;
      const svg = gtBox.querySelector('.gt-river');
      if (!svg) return;

      /* ★★★ 2026-10-10：改用 viewBox 线性映射 ✗ 不再用 getScreenCTM
         ──────────────────────────────────────────────────────────────
         原做法：
           var box = gtBox.getBoundingClientRect();        // .gt 的【屏幕】矩形
           var s = pt.matrixTransform(svg.getScreenCTM()); // data-map → 【屏幕】点
           n.style.left = (s.x - box.left) + 'px';         // 屏幕差当【局部】坐标
         桌面下 .scroll-stage 没有旋转 ✗ 局部坐标 = 屏幕坐标 − 盒子原点 ✗ 成立 ✓
         但窄屏把整根卷轴 rotate(90deg) 了 ✗ 局部坐标系跟着转了 90° ✗
         于是"屏幕差"和"局部坐标"不再相等 ✗ 光点全部错位（用户两次反馈）。

         新做法：黄河 SVG 上写的是 preserveAspectRatio="none" ✗
         也就是说 viewBox(0 0 2204 880) 到元素盒子之间是【纯线性缩放】✗
         没有任何保持比例的补偿 ✗ 那么坐标映射就是一次简单的按比例换算：
             left = vx / viewBox.width  × 盒子的 clientWidth
             top  = vy / viewBox.height × 盒子的 clientHeight
         这一步完全在【局部坐标系】里完成 ✗ 与视口宽度无关 ✗
         与卷轴转没转也无关 ✗ 任何布局下都精确 ✓ */
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height) return;
      const bw = gtBox.clientWidth, bh = gtBox.clientHeight;
      gtBox.querySelectorAll('.gt-node').forEach((n) => {
        const v = (n.dataset.map || '').split(' ');
        if (v.length !== 2) return;
        const vx = parseFloat(v[0]), vy = parseFloat(v[1]);
        if (isNaN(vx) || isNaN(vy)) return;
        n.style.left = (vx / vb.width  * bw).toFixed(1) + 'px';
        n.style.top  = (vy / vb.height * bh).toFixed(1) + 'px';
      });
    };

    const setOpenLayout = () => {
      /* ★★★ 2026-10-10 窄屏适配：卷轴旋转 90° 后 ✗ 宽度 = 视觉高度
         桌面取容器【宽度】✗ 因为卷轴横着铺开。
         窄屏 CSS 给 .scroll-stage 加了 rotate(90deg) ✗
         它被 JS 撑开的 width 在视觉上变成了【纵向高度】✗
         所以这里要取容器【高度】✗ 转完才是正好铺满一屏。
         实测不改这里的话 ✗ 窄屏 openW = 390 ✗
         转过来只有 390px 高 ✗ 卷轴还没展开就到底了。 */
      var _narrow = window.innerWidth < 900;
      openW = Math.round((_narrow ? pin.clientHeight : pin.clientWidth) || window.innerWidth);
      /* ★ 最终画心宽度 = 舞台全宽 − 左右画杆(52×2) − 左右留白(42×2)。
           底图按这个宽度渲染并居中，滚动时只被画心当取景窗逐步揭开，画面不缩放。 */
      /* ★ 全部整数化：底图宽度取偶数，避免半像素定位在快速滚动时来回舍入。 */
      const innerW = Math.max(0, (openW - 104 - 84) & ~1);
      story.style.setProperty('--inner-w', innerW + 'px');
    };

    /* ★ 行程长度一次给足：1 屏展开 + 4.2 屏叙事 */
    /* ★ 行程长度：5.2 → 8.0 屏。滚动距离越大，同一段动画分到的帧越多、越顺。 */
    const setHeight = () => { story.style.height = Math.round(pin.offsetHeight * 8.0) + 'px'; };

    /* ★ 唯一的驱动：滚动条位置 → 卷轴宽度/--unroll → 叙事 */
    const apply = () => {
      const p = storyProgress();
      const u = clamp01(p / UNROLL_END);
      const e = easeUnroll(u);
      /* ★ 撤销量化、并去掉取整：
           实测「量化到 2px 台阶」会让抖动回到最大（幅度跟着台阶大小走），
           说明那段抖动就是【几何每帧跳格】本身。
           所以反过来：宽度走亚像素（不 Math.round），每帧连续变化，
           卷纸/画心/卷边的边缘由浏览器抗锯齿，不再一格一格地跳。 */
      const curW = CLOSED_W + (openW - CLOSED_W) * e;
      if (openW) stage.style.width = curW.toFixed(2) + 'px';
      stage.style.setProperty('--unroll', e.toFixed(4));
      /* ★ 关键：也要写到 .scroll-story 上！
           我定义在 .scroll-story 上的那组变量（--b/--wa/--w/--wx/--comp）
           读的是【section 自己的】--unroll，而 section 的 inline style 恒为 0；
           只写 stage 的话那些变量永远是初始值，卷纸就不会随展开变化。 */
      story.style.setProperty('--unroll', e.toFixed(4));

      /* ★ 根治抖动：把「当前可见比例」写成 --vis，交给图片自己的 clip-path 开窗。
           父层不再 overflow 裁剪 -> 图片布局盒恒定 -> 位图可复用、不再每帧重新取样。
           可见宽 = 画心当前宽 / 画心最终宽。 */
      const paperNow = Math.max(0, curW - 104);
      const gapNow = Math.min(42, paperNow * 0.25);
      const innerNow = Math.max(0, paperNow - gapNow * 2);
      const innerFull = Math.max(1, (openW || 1) - 104 - 84);
      story.style.setProperty('--vis', Math.min(1, innerNow / innerFull).toFixed(4));

      /* ★ 厚度感系数 --thick：
           A 段（u 0→0.9）从 1 衰减到 0，速率「先慢后快」—— 用 1 - t^2.5 这条曲线：
             t=0.2 → 0.98（几乎没减）  t=0.5 → 0.82  t=0.8 → 0.43  t=1 → 0
           B 段（u ≥ 0.9）恒为 0 —— 只剩一层纸，不该有任何厚度阴影。
           两根杆共用这个值，所以左右不会有差异。 */
      const tt = Math.min(1, u / 0.9);
      const thick = 1 - Math.pow(tt, 2.5);
      story.style.setProperty('--thick', thick.toFixed(4));
      story.classList.toggle('entered', u >= 1);
      story.classList.toggle('opening', u > 0 && u < 1);

      const q = clamp01((p - UNROLL_END) / (1 - UNROLL_END));
      /* ★ 标题三段式：tin 从 0 升到 1（浮现），中间停留保持 1，tout 再从 0 升到 1（消失）。
           opacity = tin * (1 - tout) —— 停留段里 tin=1 且 tout=0，所以恒为全亮。 */
      const tin = clamp01((q - PH.titleIn[0]) / (PH.titleIn[1] - PH.titleIn[0]));
      const tout = clamp01((q - PH.titleOut[0]) / (PH.titleOut[1] - PH.titleOut[0]));
      const tOp = tin * (1 - tout);
      if (pgTitle) {
        if (q < PH.titleIn[0]) {
          /* 还没到浮现时机：清空 inline，回落到 CSS 的隐藏态 */
          pgTitle.style.opacity = ''; pgTitle.style.transform = ''; pgTitle.style.visibility = '';
        } else {
          pgTitle.style.opacity = tOp.toFixed(3);
          /* ★ 位移同时管浮现与淡出：
              浮现段 tin 0→1  →  y 从 +26 升到 0（从下方升上来）
              停留段 tin=1 tout=0 → y = 0（稳稳停住）
              淡出段 tout 0→1 →  y 从 0 继续升到 −26（向上飘走）
             合并成一条：y = 26 * (1 - tin - tout) */
          pgTitle.style.transform = 'translate(-50%,-50%) translateY(' + (26 * (1 - tin - tout)).toFixed(1) + 'px)';
          pgTitle.style.visibility = tOp <= 0.001 ? 'hidden' : 'visible';
        }
      }
      /* ★ 介绍文字：与标题同一套规则 —— 从下方升入、停留、再向上飘出 */
      const iin  = clamp01((q - PH.introIn[0])  / (PH.introIn[1]  - PH.introIn[0]));
      const iout = clamp01((q - PH.introOut[0]) / (PH.introOut[1] - PH.introOut[0]));
      const iOp  = iin * (1 - iout);
      if (pgIntro) {
        if (q < PH.introIn[0]) {
          pgIntro.style.opacity = ''; pgIntro.style.transform = ''; pgIntro.style.visibility = '';
        } else {
          pgIntro.style.opacity = iOp.toFixed(3);
          pgIntro.style.transform = 'translate(-50%,-50%) translateY(' + (26 * (1 - iin - iout)).toFixed(1) + 'px)';
          pgIntro.style.visibility = iOp <= 0.001 ? 'hidden' : 'visible';
        }
      }
      /* 海岸线淡入 */
      const coast = clamp01((q - PH.coast[0]) / (PH.coast[1] - PH.coast[0]));
      story.style.setProperty('--coast', coast.toFixed(3));
      /* 黄河生长（在海岸线之后） */
      const g = clamp01((q - PH.river[0]) / (PH.river[1] - PH.river[0]));
      story.style.setProperty('--grow', g.toFixed(3));
      story.classList.toggle('finished', p >= 0.995);

      /* ★ 每帧重排时间光点。
         原因：光点位置是用 getScreenCTM() 把 SVG 用户坐标换算成屏幕坐标的，
         而 .gt-river 的宽度随卷轴展开从 6px 变到上千 px（x 方向缩放 a 从 0.003 变到 ~0.5）。
         原来 placeNodes 只在 load/resize 时跑一次，那时卷轴还是关闭的，
         于是所有光点被算到最左边（left 只有 1.7~4.4px）且再也不会更新。
         放进 apply() 后就跟着展开实时对齐了（只有 5 个节点，开销可忽略）。 */
      placeNodes();
    };

    let ticking = false;
    /* ★★★ 2026-10-10：窄屏也要跑滚动逻辑
       原来这里一句 if (!isDesktop()) return; 把窄屏整个挡掉了 ✗
       于是 --unroll 永远是 HTML 里写死的 0 ✗ 竖向卷轴无从展开。
       现在窄屏走一条精简版：
         只算进度 → 只写 --unroll（CSS 用它驱动内容的纵向平移）
         桌面那些横向布局计算（setOpenLayout / setHeight / placeNodes）跳过 ✗
         因为窄屏 CSS 已经把布局改成竖向流式了 ✗ 不需要 JS 摆位。 */
    const narrowUnroll = () => {
      const p = storyProgress();
      /* 前 88% 的行程用来展开 ✗ 留一点余量让终态停稳 */
      const u = clamp01(p / 0.88);
      story.style.setProperty('--unroll', u.toFixed(4));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { apply(); ticking = false; });
    };

    const clearInline = () => {
      stage.style.width = '';
      stage.style.removeProperty('--unroll');
      story.style.removeProperty('--grow');
      story.style.height = '';
      [pgTitle, pgIntro].forEach((el) => {
        if (!el) return;
        el.style.opacity = ''; el.style.transform = ''; el.style.visibility = '';
      });
    };

    const onResize = () => {
      /* ★ 窄屏也重算：旋转后 openW 取的是容器高度 ✗ 窗口一变就必须更新 */
      clearInline();
      story.classList.add('open');
      story.classList.remove('finished', 'entered', 'opening');
      setOpenLayout();
      setHeight();
      placeNodes();
      apply();
    };

    /* ★★★ 2026-10-10：窄屏不再走"精简版" ✗ 和桌面走同一条路
       原来窄屏只调 narrowUnroll() ✗ 从不调 setOpenLayout / setHeight / apply ✗
       结果 openW 恒为 0 ✗ apply 里那句 if (openW) 永远不成立 ✗
       卷轴宽度动画从头到尾没跑过 —— 这就是"动效完全失效"的直接原因。
       现在两边统一：窄屏只是布局被 CSS 旋转了 ✗ 驱动逻辑一模一样。
       placeNodes() 内部自己会判断 ✗ 窄屏下会直接 return ✗ 不影响。 */
    story.classList.add('open');
    setOpenLayout();
    setHeight();
    placeNodes();
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('load', () => { if (isDesktop()) { setOpenLayout(); setHeight(); placeNodes(); apply(); } });
  })();

});


/* ══════════════════════════════════════════════════════════════════════
   ★★★ 2026-10-10 窄屏：时间轴取景窗 —— 拖拽平移 + 点击选年
   ──────────────────────────────────────────────────────────────────────
   上一版有两个问题：
     ① 滚动加在 .bookwrap 上 ✗ 而书本画布 .stage 是它的兄弟 ✗
        横向拖动时整块区域一起动 ✗ 书也跟着跑。
        现在 .tl 有自己的取景窗 .tl-wrap ✗ 书在外面 ✗ 互不干扰。
     ② overflow-x:auto 对鼠标完全没有拖动方式（滚动条又被藏了）✗
        在电脑上用鼠标根本拖不动 ✗ 只有触屏能靠原生手势。
        所以现在自己实现拖动：pointerdown / move / up 直接写 scrollLeft ✗
        鼠标和手指都能拖。

   另外定下交互分工（用户要求「独立移动」）：
     拖动  = 只平移时间轴 ✗ 不翻书
     点击  = 选中该年份 ✗ 翻书
   实现上 ✗ 拖动时在【捕获阶段】拦下 pointermove 并 stopPropagation ✗
   timeline3d.js 里那个滑动选年的监听就收不到事件了 ✗ 两者不会打架。
   松手后如果发生过位移 ✗ 再把随后那次 click 也拦掉 ✗ 避免拖完顺手翻了书。
   ══════════════════════════════════════════════════════════════════════ */
(function timelinePan(){
  var wrap = document.getElementById('tlWrap');
  var tl = document.getElementById('tl');
  if (!wrap || !tl) return;

  var panning = false, moved = false, startX = 0, startScroll = 0, lastX = 0;

  function scrollable(){ return wrap.scrollWidth > wrap.clientWidth + 2; }
  function pos(e){ return e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0); }

  /* 加载后回到最左端 */
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ wrap.scrollLeft = 0; }); });

  wrap.addEventListener('pointerdown', function(e){
    if (e.button !== undefined && e.button !== 0) return;
    panning = true; moved = false;
    startX = lastX = pos(e);
    startScroll = wrap.scrollLeft;
  }, true);

  wrap.addEventListener('pointermove', function(e){
    if (!panning) return;
    var x = pos(e);
    var dx = x - startX;
    if (!moved && Math.abs(dx) > 4) { moved = true; wrap.classList.add('dragging'); }
    if (!moved) return;
    if (scrollable()) wrap.scrollLeft = startScroll - dx;
    lastX = x;
    e.stopPropagation();                 /* ★ 不让滑动选年插进来 */
    if (e.cancelable) e.preventDefault();
  }, true);

  function endPan(e){
    if (!panning) return;
    panning = false;
    wrap.classList.remove('dragging');
    if (moved){
      e.stopPropagation();
      /* 位移过就不算点击 ✗ 吞掉紧随其后的 click */
      var swallow = function(ev){ ev.stopPropagation(); ev.preventDefault(); wrap.removeEventListener('click', swallow, true); };
      wrap.addEventListener('click', swallow, true);
      setTimeout(function(){ wrap.removeEventListener('click', swallow, true); }, 350);
    }
    moved = false;
  }
  wrap.addEventListener('pointerup', endPan, true);
  wrap.addEventListener('pointercancel', endPan, true);
  window.addEventListener('pointerup', function(e){ if (panning) endPan(e); }, true);

  /* 选中关键年份后 ✗ 把它带到取景窗中间（拖动时不触发 ✗ 那时 .on 不变） */
  var lastY = null, armed = false;
  setTimeout(function(){ armed = true; }, 1600);
  setInterval(function(){
    if (!armed || !scrollable() || panning) return;
    var on = document.querySelector('.tl-lab.on');
    if (!on) return;
    var y = parseInt(on.textContent, 10);
    if (!y || y === lastY) return;
    lastY = y;
    var wr = wrap.getBoundingClientRect(), er = on.getBoundingClientRect();
    var x = er.left - wr.left + wrap.scrollLeft + er.width / 2;
    wrap.scrollTo({ left: Math.max(0, x - wrap.clientWidth / 2), behavior: 'smooth' });
  }, 260);
})();
