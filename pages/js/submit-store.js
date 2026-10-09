/* ══════════════════════════════════════════════════════════════════════
 *  投稿存储 —— 投稿页写 ✗ 见证页读
 *  ══════════════════════════════════════════════════════════════════════
 *  存在 localStorage ✗ 键名固定。
 *  Chrome/Edge 下所有 file:// 页面共享同一个源 ✗
 *  所以投稿页写进去的数据 ✗ 见证页能直接读到 ✓
 *
 *  一条投稿长这样：
 *    { id, city, lon, lat, tier, author, text, time, photos: [ {d, w, h, cap} ] }
 *      d = 压缩后的 dataURL
 *
 *  用法：
 *    __SubmitStore.add({city:'昆山市', lon:120.98, lat:31.39, author:'', text:'…', photos:[…]})
 *    __SubmitStore.all()        // 全部投稿 ✗ 新的在前
 *    __SubmitStore.byCity('昆山市')
 *    __SubmitStore.remove(id)
 *    __SubmitStore.stat()       // {count, bytes, quota, used}
 * ══════════════════════════════════════════════════════════════════════ */
window.__SubmitStore = (function () {
  var KEY = 'shengshi_submissions_v1';
  var LIMIT = 5 * 1024 * 1024;      /* localStorage 大致上限 ✗ 用于提前预警 */

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { console.warn('[投稿] 读取失败', e); return []; }
  }
  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return { ok: true };
    } catch (e) {
      /* 配额爆了 ✗ 明确告诉上层 ✗ 不要静默失败 */
      return { ok: false, error: (e && e.name) || 'Error', list: list };
    }
  }
  function bytesOf(list) { try { return JSON.stringify(list).length; } catch (e) { return 0; } }

  return {
    KEY: KEY,
    LIMIT: LIMIT,

    all: function () { return read(); },

    byCity: function (city) {
    /* ★★ 2026-10-08：改成【后缀不敏感】匹配。
       原因：光点用的是 __CITIES 里的短名（上海 / 天水 / 阳泉）✗
       而投稿表单用的是 2210 目录里的全名（上海市 / 天水市 / 阳泉市）✗
       直接比字符串永远匹配不上 ✗ 卡片就关联不到投稿。
       这里两边都去掉末尾的市/县/区/旗再比 ✗ 两种写法都能命中。 */
    var norm = function (s) { return String(s || '').replace(/[市县区旗]$/, ''); };
    var target = norm(city);
    return read().filter(function (r) { return norm(r.city) === target; });
  },

    get: function (id) {
      var l = read();
      for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
      return null;
    },

    /* 新增一条 ✗ 返回 {ok, id} 或 {ok:false, error} */
    add: function (rec) {
      var list = read();
      var item = {
        id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        city: rec.city || '',
        lon: typeof rec.lon === 'number' ? rec.lon : null,
        lat: typeof rec.lat === 'number' ? rec.lat : null,
        tier: rec.tier || 4,
        author: (rec.author && rec.author.trim()) || '匿名',
        /* ★ 拍摄年份：选填 ✗ 用户选了才存 ✗ 卡片上会在署名框右侧显示「拍摄于xxxx年」 */
        year: (rec.year && String(rec.year).trim()) || '',
        text: (rec.text || '').trim(),
        time: rec.time || new Date().toISOString(),
        photos: (rec.photos || []).map(function (p, i) {
          return { d: p.d || p.dataUrl, w: p.w || 0, h: p.h || 0, cap: p.cap || (rec.city + ' · ' + (rec.author || '匿名')) };
        })
      };
      list.unshift(item);                     /* 新的排最前 */
      var r = write(list);
      if (!r.ok) return { ok: false, error: r.error, id: item.id };
      return { ok: true, id: item.id, bytes: bytesOf(list) };
    },

    remove: function (id) {
      var list = read().filter(function (r) { return r.id !== id; });
      var r = write(list);
      return { ok: r.ok, error: r.error, count: list.length };
    },

    clear: function () {
      try { localStorage.removeItem(KEY); return { ok: true }; }
      catch (e) { return { ok: false, error: e && e.name }; }
    },

    /* 统计 ✗ 用来在投稿页显示"还能存几张" */
    stat: function () {
      var list = read();
      var b = bytesOf(list);
      var n = 0;
      list.forEach(function (r) { n += (r.photos || []).length; });
      return {
        count: list.length, photos: n, bytes: b,
        limit: LIMIT, used: b / LIMIT,
        leftPhotos: Math.max(0, Math.floor((LIMIT - b) / 80000))   /* 按平均 80KB 估算 */
      };
    },

    /* 空间是否还够放一条新投稿 */
    canFit: function (photos) {
      var add = 0;
      (photos || []).forEach(function (p) { add += (p.d || p.dataUrl || '').length; });
      return (bytesOf(read()) + add) < LIMIT * 0.95;
    }
  };
})();
