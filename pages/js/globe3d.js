/* ============================================================================
   3D 地球（由独立项目 3D-Earth 整体迁移而来，参数与特性完全保留）
   ----------------------------------------------------------------------------
   ★ 掩膜为什么必须是页面内联的 data URI（这是原项目内嵌 base64 的真正原因）：
     `file:` 打开的页面里，每个文件都被浏览器当作**独立安全源**
     （控制台会写 "'file:' URLs are treated as unique security origins"）。于是：
       · 直接 <img src="assets/land_mask.png"> 交给 WebGL
         → SecurityError: Failed to execute 'texSubImage2D' ... cross-origin data
       · fetch / XHR 去读这个 PNG
         → 被 CORS 拦死（"Cross origin requests are only supported for protocol
           schemes: chrome, ..., data, http, https, ..."，file 不在允许列表里）
     两条都不通，纹理就永远停在 1×1 黑 → 掩膜全 0 → 着色器 step(0.5, h) 恒假
     → 只剩 sea #bcbcbc → 整颗球是纯灰色（自转/拖拽/缩放照常，因为那些纯属 JS）。
     唯一出路是 data URI：源为 null、不跨源。所以掩膜写在 gallery.html 的
     <img id="maskPreload" src="data:image/png;base64,..."> 上，本文件直接取用。

   其余迁入改动：
     1. 画布尺寸由「铺满窗口」改为「铺满 #globe3d 容器」，并在布局稳定后重算
        （首帧曾量到 375×187 —— CSS 还没生效就取尺寸了）
     2. 容器不存在时直接返回
   保留的特性（数值与原版逐字一致）：
     · 顶点位移的陆地浮雕 + 四邻域梯度伪造厚度 / 坡度着色
     · 自转（autoY += dt * 0.038）
     · 拖拽旋转（带 0.92 惯性衰减）
     · 滚轮缩放（2.4 ~ 12）
   已改动的特性：
     · **只能绕赤道左右转**：拖拽与自转都只改绕 Y 轴的角度，
       原版的垂直倾斜（tilt，±1.35）已移除，球体极轴永远竖直、不会上下翻
     · 画布透明、球外像素 alpha=0（原版是浅灰底），让页面蓝黑渐变透出来
     · 洋面透明（SEA_ALPHA）、中国区域涂大红（china 掩膜）、球外光晕压弱偏蓝
   ========================================================================= */
(function () {
  /* ★ 版本标记：用于确认浏览器加载的是不是最新文件（不是缓存的旧版）。
     打开控制台应该看到 [3D 地球] 版本 20261008-1。看不到就是缓存没刷新。 */
  window.__GLOBE_VER = '20261008-1';
  console.log('[3D 地球] 版本 20261008-1');

  'use strict';

  /* ---------- 容器与画布 ---------- */
  var container = document.getElementById('globe3d');
  if (!container) return;

  var SphereGeo = THREE.SphereGeometry || THREE.SphereBufferGeometry;

  /* ============ 配色 ============ */
  var SEA    = [188/255, 188/255, 188/255];   // #bcbcbc 海洋（略压深，与顶面拉开）
  var LAND   = [231/255, 231/255, 231/255];   // #e7e7e7 陆地顶面
  var SIDE   = [185/255, 185/255, 185/255];   // #b9b9b9 突起侧面
  /* ============ 配色 ============ */
  /* 球体本身仍是独立项目的原设定：灰海 #bcbcbc + 白色板块 #e7e7e7 + 灰侧壁 #b9b9b9。
     但**不画自己的浅灰底**（原 BG #e9e9e9 已弃用）：画布全透明、球外像素 alpha=0，
     于是屏幕上只剩一个球，蓝黑渐变透出来。
     球面本身仍是不透明实体面（alpha 恒 1），不会透出背景色。 */
  var SEA    = [188/255, 188/255, 188/255];   // #bcbcbc 海洋（略压深，与顶面拉开）
  var LAND   = [231/255, 231/255, 231/255];   // #e7e7e7 陆地顶面
  var SIDE   = [185/255, 185/255, 185/255];   // #b9b9b9 突起侧面
  var RELIEF = 0.0075;                        // 突起高度（半径的比例）

  /* ★ 中国（含港澳台）**边境线**的高亮色。
★ 2026-10-08 改版：从「大红实线」换成**卷轴页黄河主干道的那套三层金色发光材质**
   （对应 parade.css 的 .rv-halo / .rv-body / .rv-shine 三层）。
   原来只有一层纯色，现在拆成 halo（外圈柔光）+ body（主体金）+ core（中心亮芯）。
   颜色取自黄河那条 <linearGradient id="rvBody">：#ffe9b0 → #f7c85e → #e8a63c
   以及 rv-shine 的近白 #fffdf4。 */
var CN_LINE  = [0xd8 / 255, 0x14 / 255, 0x22 / 255];  // 旧值备查，已不使用
var CN_GOLD  = [0.969, 0.784, 0.369];   // #f7c85e 主体金
var CN_HALO  = [1.000, 0.745, 0.353];   // #ffbe5a 外圈暖金柔光
var CN_CORE  = [1.000, 0.992, 0.957];   // #fffdf4 中心亮芯

  /* ★ 海洋透明度：0 = 洋面完全透明（只看到陆地板块浮着，透出蓝黑渐变）
     1 = 洋面是不透明的灰 #bcbcbc。中间值就是"半透的海"。
     陆地板（掩膜 h ≥ 0.5）始终是不透明的实心面。 */
  var SEA_ALPHA = 0.0;

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });   /* alpha：不画底色 */
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearAlpha(0);
  container.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.background = null;                    /* 留空：让蓝黑渐变透出来 */
  var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 5.4);

  var sunDirWorld = new THREE.Vector3(3.4, 1.5, 5.2).normalize();

  /* ============ 掩膜：直接用页面内联的 data URI ============ */
  var pre = document.getElementById('maskPreload');
  var preCn = document.getElementById('chinaMaskPreload');   /* 中国（含港澳台）区域掩膜 */
  /* ★ 2026-10-08 新增：中国省界掩膜（Natural Earth 50m admin-1 boundary 栅格化）。
     与 china_mask 同为 8192×4096 等距圆柱，可直接用同一个 vUv 采样。
     默认隐藏（着色器里 provOn = 0），需要时把 window.__globeProvince.on 置 true。 */
  var prePv = document.getElementById('provinceMaskPreload');

  /* 取掩膜地址。优先用 <img src> 上的 data URI —— 这是 file:// 下唯一可行的方式：
     · 直接引用 assets/land_mask.png → WebGL 判为跨源，texSubImage2D 报 SecurityError
     · fetch/XHR 读取该 PNG → file:// 下被 CORS 拦死（只允许 http/https/data 等协议）
     所以掩膜必须是 data URI（源为 null，不跨源）。若将来改成有服务器托管，
     只要给 <img> 加 data-mask 指向外部文件即可自动切换。 */
  function srcOf(el, fallback) {
    return (el && /^data:/.test(el.src || '') && el.src) ||
           (el && el.getAttribute('data-mask')) || fallback;
  }
  var maskSrc = srcOf(pre, 'assets/land_mask.png');

  /* 只有 http(s) 才可能 fetch 成功；file:// 下直接跳过，免得刷一堆 CORS 红字 */
  function canFetch(src) {
    return window.fetch && /^https?:/i.test(new URL(src, location.href).href);
  }

  function toDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error('FileReader 失败')); };
      fr.readAsDataURL(blob);
    });
  }

  /* 三条路兜底：data URI（本页当前走这条）/ http(s) fetch→blob→dataURI / 直连图片 */
  function loadMask(src) {
    if (/^data:/.test(src) || !canFetch(src)) return waitImage(src);
    return fetch(src)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(toDataURL)
      .then(function (dataUrl) { return waitImage(dataUrl); })
      .catch(function (err) {
        console.warn('3D 地球：掩膜 fetch 失败，退回直连图片（' +
          (err && err.message ? err.message : err) + '）');
        return waitImage(src);
      });
  }

  function waitImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        if (!img.naturalWidth) { reject(new Error('图片尺寸为空')); return; }
        if (img.decode) { img.decode().then(function () { resolve(img); }, function () { resolve(img); }); }
        else { resolve(img); }
      };
      img.onerror = function () {
        reject(new Error('掩膜载入失败 —— ' + String(src).slice(0, 64)));
      };
      img.src = src;
    });
  }

  /* 两张掩膜一起加载：陆地掩膜是必需的，中国掩膜是加分项（缺了也能显示，只是没有红块） */
  var landJob = loadMask(maskSrc).then(function (img) {
    console.log('[3D 地球] 掩膜就绪', img.naturalWidth + '×' + img.naturalHeight,
      '源：' + (String(img.src).slice(0, 12) === 'data:image/p' ? 'data URI（不跨源，可上传）' : img.src));
    return img;
  }).catch(function (err) {
    /* ★ 2026-10-08 兜底：内联 data URI 偶发载入失败时（缓存/内存/大文件解码），
       再试一次外部文件；仍失败则返回 null，让地球以「无掩膜」方式照常显示，
       而不是整个页面只剩一行错误提示。 */
    console.warn('3D 地球：内联掩膜载入失败（' + (err && err.message ? err.message : err) + '），尝试外部文件');
    return loadMask('assets/land_mask.png').catch(function (err2) {
      console.warn('3D 地球：外部掩膜也失败（' + (err2 && err2.message ? err2.message : err2) + '），将以无掩膜方式显示地球');
      return null;
    });
  });
  var cnJob = preCn
    ? loadMask(srcOf(preCn, 'assets/china_mask.png')).then(function (img) {
        console.log('[3D 地球] 中国掩膜就绪', img.naturalWidth + '×' + img.naturalHeight);
        return img;
      }).catch(function (err) {
        console.warn('3D 地球：中国掩膜载入失败，中国区域将不着色（' +
          (err && err.message ? err.message : err) + '）');
        return null;
      })
    : Promise.resolve(null);

  var pvJob = prePv
    ? loadMask(srcOf(prePv, 'assets/china_provinces.png')).then(function (img) {
        console.log('[3D 地球] 省界掩膜就绪', img.naturalWidth + '×' + img.naturalHeight);
        return img;
      }).catch(function (err) {
        console.warn('3D 地球：省界掩膜载入失败，省界功能将不可用（' +
          (err && err.message ? err.message : err) + '）');
        return null;
      })
    : Promise.resolve(null);

  Promise.all([landJob, cnJob, pvJob]).then(function (res) {
    if (!res[0]) {
      console.warn('3D 地球：没有可用的陆地掩膜，地球将以纯色球体显示');
    }
    init(res[0] ? makeMask(res[0]) : null, res[1] ? makeMask(res[1]) : null, res[2] ? makeMask(res[2]) : null);
  }).catch(function (err) {
    console.error('3D 地球：' + err.message);
    container.innerHTML = '<div style="position:absolute;inset:0;display:flex;' +
      'align-items:center;justify-content:center;padding:24px;text-align:center;' +
      'color:#7d6a53;font-size:14px;line-height:1.9">' +
      '掩膜贴图载入失败，地球暂时无法显示。<br>' +
      '请确认 gallery.html 里的掩膜 data URI 完整，并按 Ctrl+F5 强制刷新。</div>';
  });

  /* 掩膜纹理：过滤参数与原页面一致（mipmap + 线性，原设定如此）。
     掩膜只有 0/255 两个值，逐级平均后各级均值约 0.33、远高于 0.25 的阈值，
     所以 mipmap 不会把球面吃掉。 */
  function makeMask(img) {
    var mask = new THREE.Texture(img);
    mask.needsUpdate = true;
    mask.minFilter = THREE.LinearFilter;
    mask.magFilter = THREE.LinearFilter;
    mask.generateMipmaps = true;
    mask.minFilter = THREE.LinearMipmapLinearFilter;
    if (renderer.capabilities.getMaxAnisotropy) {
      mask.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    /* ★ 边界检测要取邻域，而默认的 RepeatWrapping 会在 uv 边界（±180° 经线）
       把采样绕回另一侧，于那条缝上产生一圈假边界。
       所以两张掩膜都用 ClampToEdge：越界采样取边缘像素，不会有假边。 */
    mask.wrapS = THREE.ClampToEdgeWrapping;
    mask.wrapT = THREE.ClampToEdgeWrapping;
    return mask;
  }

  function init(mask, chinaMask, provMask) {
    /* ============ 地球：顶点位移 + 侧面按坡度上色 ============ */
    var mat = new THREE.ShaderMaterial({
      /* 球面是「不透明的实体面」：球面 alpha 恒为 1（见片元着色器），
         只有球体外那一圈空场 alpha=0 —— 那是原版的浅灰底 #e9e9e9 所在的位置，
         本页改判为透明，让蓝黑渐变透出来。
         这是「让球体外透明」，不是「让球体透明」：海洋/板块/侧壁全部实心。 */
      transparent: true,
      uniforms: {
        mask:    { value: mask },
        china:   { value: chinaMask },           /* 中国（含港澳台）区域掩膜 */
        texel:   { value: new THREE.Vector2(1 / 4096, 1 / 2048) },
        /* ★ china 掩膜是 8192×4096（比 land 掩膜高一倍），
           邻域偏移要用它自己的像素尺寸，否则线的粗细会差一倍。 */
        texelCn: { value: new THREE.Vector2(
                     chinaMask ? 1 / chinaMask.image.naturalWidth  : 1 / 8192,
                     chinaMask ? 1 / chinaMask.image.naturalHeight : 1 / 4096) },
        relief:  { value: RELIEF },
        sea:     { value: new THREE.Vector3(SEA[0], SEA[1], SEA[2]) },
        land:    { value: new THREE.Vector3(LAND[0], LAND[1], LAND[2]) },
        side:    { value: new THREE.Vector3(SIDE[0], SIDE[1], SIDE[2]) },
        cnLine:  { value: new THREE.Vector3(CN_GOLD[0], CN_GOLD[1], CN_GOLD[2]) },
        cnHalo:  { value: new THREE.Vector3(CN_HALO[0], CN_HALO[1], CN_HALO[2]) },
        cnCore:  { value: new THREE.Vector3(CN_CORE[0], CN_CORE[1], CN_CORE[2]) },
        cnOn:    { value: chinaMask ? 1.0 : 0.0 },
        /* ★ 省界（默认隐藏）*/
        province:{ value: provMask || null },
        texelPv: { value: new THREE.Vector2(
          provMask ? 1 / provMask.image.naturalWidth  : 1 / 8192,
          provMask ? 1 / provMask.image.naturalHeight : 1 / 4096) },
        provOn:  { value: 0.0 },        /* ← 0 = 隐藏；置 1 即显示 */
        provColor: { value: new THREE.Vector3(0.62, 0.78, 1.0) },  /* 淡蓝白，与金线区分 */
        SEA_ALPHA: { value: SEA_ALPHA },         /* ★ 海洋透明度，改这里即可 */
        sunDir:  { value: new THREE.Vector3(1, 0, 0) }
      },
      vertexShader: [
        'uniform sampler2D mask;',
        'uniform float relief;',
        'varying vec2 vUv;',
        'varying vec3 vNormal;',
        'void main() {',
        '  vUv = uv;',
        '  float h = texture2D(mask, uv).r;',
        '  vNormal = normalize(normalMatrix * normal);',
        /* ★ 真正把陆地沿法线顶起来 */
        '  vec3 p = position * (1.0 + h * relief);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D mask;',
        'uniform sampler2D china;',      // 中国（含港澳台）区域掩膜
        'uniform vec2 texel;',
        'uniform vec2 texelCn;',         // china 掩膜自己的像素尺寸（8192×4096）
        'uniform vec3 sea, land, side, cnLine, cnHalo, cnCore, sunDir;',
        'uniform float cnOn, SEA_ALPHA;',// cnOn=0 表示中国掩膜没载入
        'uniform sampler2D province;',   // 省界掩膜（默认隐藏）
        'uniform vec2 texelPv;',
        'uniform float provOn;',
        'uniform vec3 provColor;',
        'varying vec2 vUv;',
        'varying vec3 vNormal;',
        'void main() {',
        '  float h = texture2D(mask, vUv).r;',
        /* ★ 取四邻域算高度场梯度，得到切线空间法线 —— 这一步才真正产生立体感 */
        '  vec2 o = texel * 1.5;',
        '  float hl = texture2D(mask, vUv - vec2(o.x, 0.0)).r;',
        '  float hr = texture2D(mask, vUv + vec2(o.x, 0.0)).r;',
        '  float hd = texture2D(mask, vUv - vec2(0.0, o.y)).r;',
        '  float hu = texture2D(mask, vUv + vec2(0.0, o.y)).r;',
        '  vec3 tn = vec3(hl - hr, hd - hu, 0.0) * 13.0;',   // 坡面更陡
        '  float sl = length(tn.xy);',
        /* ── 球体外那一圈空场（纬度 ±75° 以外）────────────────────────────
           原版在这里画浅灰底 #e9e9e9；本页判为 alpha=0，让蓝黑渐变透出来。
           ★ 判定必须基于**球面几何（uv）**，不能用掩膜 h：
             掩膜在 ±75° 以外是 0，而球面上的海洋也是 0，两者无法区分；
             用 `if (h < 0.25) discard` 会连带砍掉 76206 个海岸线像素
             （掩膜里 0.02~0.25 的过渡值），球面就会布满细小的透明缺口。
             而 uv 是几何量：球面覆盖 |vUv.y-0.5| ≤ 0.4167 恰好对应 ±75°。 */
        '  float inside = smoothstep(0.9167, 0.9119, abs(vUv.y - 0.5));',
        /* ── 中国（含港澳台）：不再填红色，改为**高亮边境线** ──────────────
           china 掩膜与 mask 同投影、同尺寸（都是 4096×2048 等距圆柱），
           所以可以直接用同一个 vUv 采样，不需要任何经纬度换算。
           做法：比较当前像素与四邻域的掩膜值，凡是"跨过国界"的即为边境像素。
           cnOn = 0 时（掩膜没载入）整段自动失效，地球照常显示。 */
        '  float cn = texture2D(china, vUv).r * cnOn;',
        '  vec3 base = mix(sea, land, step(0.5, h));',
        '  vec3 col  = mix(base, side, smoothstep(0.18, 0.95, sl));',
        /* 邻域偏移要按纬度补偿：等距圆柱投影下，高纬度的经度像素在地面上更窄，
           不补偿的话国界线会在高纬度明显变细甚至断开。
           uv 与经纬度线性对应 ⇒ 1/cos(纬度) = 1/(0.5 − |uv.y − 0.5|)：
             |uv.y−0.5| = 0       → 赤道   → 系数 2
             |uv.y−0.5| = 0.4167  → ±75°  → 系数 12
           clamp 到 12 防止数值爆炸（球面本身只覆盖 ±75°）。 */
        '  float cosp = 1.0 / max(0.5 - abs(vUv.y - 0.5), 1.0 / 12.0);',
        /* ── 平滑的边界距离场 ─────────────────────────────────────────────
           ★ 原来用 step() 做硬判定，只能得到一条 1 像素的锯齿线。
             现在改成：在**三圈**半径上取 12 个邻域（近/中/远），
             按高斯权重把 |Δcn| 加权求和，得到一个连续的"离边界多远"的场：
               距边界很近 → 接近 1；稍远 → 逐渐降到 0。
             再用 smoothstep 把它映射成软边线，天然带抗锯齿、没有锯齿感。
             半径按掩膜像素计（4096 宽 → 1 像素 ≈ 0.088°），
             配合 1536×768 的球面细分，屏上大约是 2~3 像素宽的柔线。 */
        '  float dNear = 0.0, dMid = 0.0, dFar = 0.0;',
        '  vec2 p1 = vec2(texelCn.x * 2.0 * cosp, texelCn.y * 2.0);',
        '  vec2 p2 = vec2(texelCn.x * 4.0 * cosp, texelCn.y * 4.0);',
        '  vec2 p3 = vec2(texelCn.x * 6.0 * cosp, texelCn.y * 6.0);',
        '  dNear += abs(cn - texture2D(china, vUv + vec2( p1.x, 0.0)).r * cnOn);',
        '  dNear += abs(cn - texture2D(china, vUv + vec2(-p1.x, 0.0)).r * cnOn);',
        '  dNear += abs(cn - texture2D(china, vUv + vec2(0.0,  p1.y)).r * cnOn);',
        '  dNear += abs(cn - texture2D(china, vUv + vec2(0.0, -p1.y)).r * cnOn);',
        '  dMid  += abs(cn - texture2D(china, vUv + vec2( p2.x,  p2.y)).r * cnOn);',
        '  dMid  += abs(cn - texture2D(china, vUv + vec2(-p2.x,  p2.y)).r * cnOn);',
        '  dMid  += abs(cn - texture2D(china, vUv + vec2( p2.x, -p2.y)).r * cnOn);',
        '  dMid  += abs(cn - texture2D(china, vUv + vec2(-p2.x, -p2.y)).r * cnOn);',
        '  dFar  += abs(cn - texture2D(china, vUv + vec2( p3.x, 0.0)).r * cnOn);',
        '  dFar  += abs(cn - texture2D(china, vUv + vec2(-p3.x, 0.0)).r * cnOn);',
        '  dFar  += abs(cn - texture2D(china, vUv + vec2(0.0,  p3.y)).r * cnOn);',
        '  dFar  += abs(cn - texture2D(china, vUv + vec2(0.0, -p3.y)).r * cnOn);',
        /* 高斯权重：近圈主导（决定线的锐度），远圈只负责把软边铺开一点 */
        '  float dist = dNear * 0.40 + dMid * 0.12 + dFar * 0.045;',
        /* 掩膜自身的软边（羽化带）也算"贴着边界"，补上细段与尖角 */
        '  float feather = (1.0 - abs(cn * 2.0 - 1.0)) * cnOn;',
        '  dist = max(dist, feather * 0.9);',
        /* ── 中国边境线：黄河主干道的三层金色发光材质 ────────────────────
           dist 是「离边界多远」的场：贴着边界≈1，向外衰减到 0。
           所以**阈值越高，圈出来的带越窄** —— 用户要求比原来(0.30)窄，故整体抬高：
             halo 0.16~0.40  外圈柔光（宽而淡，负责「发光」的扩散感）
             body 0.34~0.54  主体金色（实线本体，比原来的 0.30 窄）
             core 0.52~0.64  中心亮芯（最窄最亮的一道，模拟高光）
           三层依次叠加，得到「裹着光晕的金线」。 */
        '  float halo = smoothstep(0.16, 0.40, dist);',
        '  float body = smoothstep(0.34, 0.54, dist);',
        '  float core = smoothstep(0.52, 0.64, dist);',
        /* 主体金做一点沿经度的明暗流动，呼应黄河那道的渐变感 */
        '  vec3 goldBody = mix(cnLine, cnHalo, 0.5 + 0.5 * sin(vUv.x * 18.0));',
        '  col = mix(col, cnHalo, halo * 0.45);',
        '  col = mix(col, goldBody, body * 0.95);',
        '  col = mix(col, cnCore, core * 0.80);',
        /* ── 中国省界（★ 默认隐藏，provOn = 0 时整段自动失效）──────────────
           与国境线同一套距离场思路，但用省界掩膜自己的邻域差分。
           省界线比国界线细一档，颜色用淡蓝白，和金色国境线区分开。
           ★ 这里【不要】去改 alpha —— 省界全在国内，alpha 本来就是 1；
             而且 alpha 变量在下面才声明，在这里引用会导致着色器编译失败
             （报 'alpha' : undeclared identifier）。 */
        '  if (provOn > 0.5) {',
        '    float pv = texture2D(province, vUv).r;',
        '    vec2 q1 = vec2(texelPv.x * 2.0 * cosp, texelPv.y * 2.0);',
        '    float pvN = abs(pv - texture2D(province, vUv + vec2( q1.x, 0.0)).r)',
        '              + abs(pv - texture2D(province, vUv + vec2(-q1.x, 0.0)).r)',
        '              + abs(pv - texture2D(province, vUv + vec2(0.0,  q1.y)).r)',
        '              + abs(pv - texture2D(province, vUv + vec2(0.0, -q1.y)).r);',
        '    float pvD = max(pvN, (1.0 - abs(pv * 2.0 - 1.0)) * 0.9);',
        '    float pvEdge = smoothstep(0.12, 0.55, pvD) * provOn;',
        '    col = mix(col, provColor, pvEdge * 0.85);',
        '  }',
        /* 用扰动后的法线受光：陡坡朝外，自然变暗 —— 这才是「厚度」 */
        '  vec3 N = normalize(normalize(vNormal) + vec3(tn.xy, 0.0));',
        '  float lam = dot(N, normalize(sunDir));',
        '  float term = smoothstep(-0.45, 0.70, lam);',
        /* 蓝黑底上暗面提到 0.86（原独立页浅灰底上是 0.70）：
           底色深，压太狠球体轮廓会糊进背景里。 */
        '  col *= mix(0.86, 1.0, term);',
        /* ── 球面：海洋透明、陆地实心 ──────────────────────────────────
           掩膜里 h ≥ 0.5 是陆地、以下是海洋，正好用来分开两者：
             陆地板块 → alpha = 1，实心面，颜色直接写入（不受背景影响）
             海洋     → alpha = SEA_ALPHA（默认 0，洋面完全透明，透出蓝黑渐变）
           球体之外 → alpha = 0
           这样"透出底色"的只有洋面，板块仍是干净的灰白。 */
        /* ── 陆地 / 海洋的不透明判定 ─────────────────────────────────────
           ★ 2026-10-08 修复「海岸线上散落黑斑」（用户报告：曲折的国境线/海岸线上尤其多）
           原来用 step(0.5, h)：掩膜在海岸线有一圈 0.02~0.25 的过渡值，
           这些像素 h < 0.5 被判成海洋 → alpha = SEA_ALPHA = 0 → 露出页面深色底，
           于是每隔几个像素就冒出一颗黑点；蜿蜒的岸线过渡带最长，黑点也最密。
           （本文件开头作者注释也提到过这 76206 个过渡像素，当时是靠不用 discard 绕开，
             但 step 的硬判定同样会在这圈上打洞。）
           改成 smoothstep 软判定：过渡带按比例给不透明度，
           既补上黑点，又让海岸线边缘更柔和、不再有锯齿。 */
        '  float landA  = smoothstep(0.30, 0.62, h);',
        '  float alpha  = inside * mix(SEA_ALPHA, 1.0, landA);',
        /* ② 中国国境线在洋面上也要有不透明像素（否则金线同样会变黑点）*/
        '  float borderA = max(halo * 0.45, max(body * 0.95, core * 0.80));',
        '  alpha = max(alpha, borderA * inside);',
        '  gl_FragColor = vec4(col, alpha);',
        '}'
      ].join('\n')
    });

    /* ══════════════════════════════════════════════════════════════════
       ★ 2026-10-08 新增：中国各省省名标签
       数据来自 gallery.html 内联的 window.__PROVINCES（Natural Earth 50m admin-1，
       共 31 个省级要素，字段 name_zh + longitude/latitude）。
       地球是 3D 场景、会自转和拖动，所以标签不能写静态坐标 ——
       每帧用「经纬度 → 球面点 → 应用球体旋转与位移 → 投影到屏幕」算出来。
       默认隐藏，随省界一起用 __globeProvince.on 控制。
       ══════════════════════════════════════════════════════════════════ */
    var provEls = [];
    (function buildProvLabels() {
      var box = document.getElementById('provLabels');
      var data = window.__PROVINCES;
      if (!box || !data || !data.length) return;
      box.innerHTML = '';
      data.forEach(function (p, i) {
        var d = document.createElement('div');
        d.className = 'prov-label';
        d.textContent = p.s || p.n;
        d.title = p.n;
        d.dataset.i = String(i);
        box.appendChild(d);
        provEls.push({ el: d, lon: p.lon, lat: p.lat });
      });
    })();

    var globe = new THREE.Group();
    globe.add(new THREE.Mesh(new SphereGeo(1, 1536, 768), mat));
    scene.add(globe);

    /* ★ 2026-10-08：把光晕 sprite 暴露到外层。
       它原本只挂在 IIFE 内部、并直接 scene.add(s) —— 不在 globe 组里，
       所以移动 globe.position.y 时球体走了、光晕留在原地，两者错位，
       看起来像「掩膜跟着下移，球体和光晕出 bug」。
       这里记下引用，帧循环里让它跟着球体一起走。 */
    var halo = null;

    /* ---------- 光晕 ----------
       原独立项目的球外白色光晕，在蓝黑底上改为偏蓝并压弱：
       满强度白色会在深底上形成一圈刺眼白环。 */
    (function () {
      var C = document.createElement('canvas');
      C.width = C.height = 512;
      var g = C.getContext('2d');
      var grd = g.createRadialGradient(256, 256, 0, 256, 256, 256);
      grd.addColorStop(0.00, 'rgba(255,255,255,0)');
      grd.addColorStop(0.50, 'rgba(255,255,255,0)');
      grd.addColorStop(0.545, 'rgba(255,255,255,0.50)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.34)');
      grd.addColorStop(0.74, 'rgba(255,255,255,0.16)');
      grd.addColorStop(1.00, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
      var t = new THREE.CanvasTexture(C);
      if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
      var s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: t, transparent: true, depthWrite: false, depthTest: false,
        color: 0x9dc0ff,          /* 偏蓝，与蓝黑渐变同调 */
        opacity: 0.45,            /* 原为满强度；深色底上要压弱，否则外圈过曝发白 */
        blending: THREE.NormalBlending
      }));
      s.scale.set(3.90, 3.90, 1);
      s.renderOrder = -1;
      scene.add(s);
      halo = s;   /* ★ 记下引用，供帧循环同步垂直偏移 */
    })();

    /* ---------- 交互 ----------
       ★ 只允许绕赤道左右转（yaw = 绕 Y 轴），不提供沿经纬线的上下转（pitch）。
         所以这里没有任何 tilt 变量：机位始终在赤道平面上正对球心，
         球体只绕自身 Y 轴旋转 —— 拖动、自转都只改这一个角度。 */
    var rotY = 0, autoY = 0;
    var dragging = false, lastX = 0, vX = 0, camZ = 5.4;

    /* ★ 2026-10-08：把聚焦所需的状态暴露给页面脚本。
       页面脚本负责算动画（rot / camZ / x），帧循环只读这里。
       rot 是「总角度」= rotY + autoY，非聚焦时每帧同步，供 startFocus 取起始值。 */
    window.__globeFocus = {
      on: false,          /* 是否正在聚焦动画中 */
      lock: false,        /* 聚焦完成后锁死自转与拖动 */
      rot: 0,             /* 经度方向：总角度 = rotY + autoY */
      tilt: 0,            /* ★ 纬度方向：绕 X 轴的俯仰角（弧度）。
                             组员原版刻意去掉了 tilt（只绕赤道左右转），
                             但要对准中国必须能抬头 —— 这里把它加回来，
                             只在聚焦时使用，平时恒为 0，不影响原有观感。 */
      camZ: camZ,         /* 机位距离 */
      x: 0,               /* 镜头横向偏移 */
      reset: false,       /* ★ 置 true 让帧循环把角度与机位还原到初始 */
      y: 0                /* ★ 球体在【场景里】的垂直偏移（负数 = 向下）。
                             为什么不用 CSS 位移：容器 #globe3d 有 overflow:hidden，
                             给它加 transform 会把整个裁剪框一起下移，顶部露出硬边、
                             看起来像「板块边界切了一刀」。改成移动球体本身就没有这个问题。 */
    };
    var el = renderer.domElement;
    /* ★ 拖动是否可用：本页在「点进入」之前要锁住地球，
       之后解锁。以 .stage 上的 .entered 类为准（见 init 末尾的监听）。 */
    var dragEnabled = true;
    var canDrag = function () { return dragEnabled && !(window.__globeFocus && window.__globeFocus.lock); };
    el.style.cursor = 'grab';

    /* ★ 事件一律挂在 window 上，并用坐标判断指针是否落在地球范围内 ——
       不依赖"命中测试能否穿透到 canvas"。这样无论地球上方盖了多少层
       （模糊纱、文字层、拦截层…），拖动都不会失效。
       代价是多一次 getBoundingClientRect 判断，可以忽略。 */
    function inGlobe(e) {
      var r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right &&
             e.clientY >= r.top  && e.clientY <= r.bottom;
    }
    window.addEventListener('pointerdown', function (e) {
      if (!canDrag() || e.button !== 0 || !inGlobe(e)) return;
      dragging = true; lastX = e.clientX;
      el.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      /* 按画布宽度换算：窄屏拖同样的像素对应更大的转角 */
      var k = 0.005 * (900 / Math.max(320, el.clientWidth));
      vX = (e.clientX - lastX) * k;
      lastX = e.clientX;
      rotY += vX;
    });
    function up(){ dragging = false; el.style.cursor = 'grab'; }
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
    /* ★ 2026-10-08：禁用滚轮缩放（用户要求）。
       原来这两行
         camZ = Math.max(2.4, Math.min(12, camZ + e.deltaY * 0.0022));
       会在滚轮时推拉镜头。现在只拦截事件、不改 camZ。
       想恢复就把上面那行放回来。 */
    window.addEventListener('wheel', function (e) {
      if (!canDrag() || !inGlobe(e)) return;
      e.preventDefault();
    }, { passive: false });

    /* 尺寸：首帧 CSS 可能还没生效，所以多补几次重算 */
    function fit(){
      /* ★ 本页地球是「固定背景层」：CSS 用 100vh 定高、宽度按视口算，
         容器高度给的是具体像素，不再依赖 flex。这里按视口的宽高比算，
         保证球体按真实比例显示（不会被拉扁）。 */
      /* ★★ 2026-10-08：高度必须用【稳定的视口高度】，不能用 container.clientHeight。
         .stage 的 CSS 高度是 100vh，但点「返回标题界面」时文字层重新占位、
         文档高度突变，容器的 clientHeight 会被瞬时算错；而下面还挂了
         ResizeObserver(fit) —— 容器一变就立刻重设画布尺寸，球因此"突然变很大"。
         window.innerHeight 不受文档流影响，永远稳定。 */
      var h = window.innerHeight || container.clientHeight || 800;
      var aspect = window.innerWidth / window.innerHeight;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(h * aspect, h);
      var camXX = (window.__globeFocus && window.__globeFocus.on) ? (window.__globeFocus.x || 0) : 0;
      camera.position.set(camXX, 0, camZ);
      camera.lookAt(0, 0, 0);
    }
    window.addEventListener('resize', fit);
    window.addEventListener('load', fit);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(container);
    fit();
    requestAnimationFrame(fit);
    setTimeout(fit, 120);
    setTimeout(fit, 600);

    var clock = new THREE.Clock();
    var checked = 0;
    /* 自检：掩膜必须真的传上 GPU。这种失败原本是静默的，现在会喊出来。 */
    function checkMask() {
      /* ★ 无掩膜时跳过自检（掩膜载入失败会返回 null，此时不应再访问 mask.image）*/
      if (!mask) return;
      var props = renderer.properties && renderer.properties.get(mask);
      if (!props || !props.__webglTexture) {
        if (++checked === 60) {
          console.error('3D 地球：掩膜纹理始终没有上传到 GPU（' +
            mask.image.naturalWidth + '×' + mask.image.naturalHeight +
            '，设备最大纹理 ' + renderer.capabilities.maxTextureSize + '）。');
        }
        return;
      }
      var gl = renderer.getContext();
      var px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (Math.abs(px[0] - 233) <= 4 && Math.abs(px[1] - 233) <= 4 && Math.abs(px[2] - 233) <= 4) {
        console.error('3D 地球：掩膜纹理读到全 0，球体退化为纯灰色（' +
          mask.image.naturalWidth + '×' + mask.image.naturalHeight + '）。');
      }
    }

    /* ══════════════════════════════════════════════════════════════════
       ★ 2026-10-08 新增：屏幕坐标 → 球面经纬度
       用途：判断"用户点的是不是当前聚焦的那个板块"。
       做法：把屏幕点经相机反投影成射线 → 与球心在 globe.position、半径 1 的球求交
            → 交点逆旋转回球体局部坐标 → 换算成经纬度。
       逆旋转直接用 globe.rotation 的真实值（Euler XYZ ⇒ R = Rx·Ry，逆为 Ry⁻¹·Rx⁻¹），
       所以无论聚焦到哪个角度、球体停在什么位置，结果都正确。
       ══════════════════════════════════════════════════════════════════ */
    window.__globePick = function (cx, cy) {
      var el = renderer.domElement;
      var W = el.clientWidth || el.width;
      var H = el.clientHeight || el.height;
      if (!W || !H) return null;
      /* 画布在页面中的位置：把页面坐标换成画布内坐标 */
      var rect = el.getBoundingClientRect();
      var nx = ((cx - rect.left) / rect.width) * 2 - 1;
      var ny = -((cy - rect.top) / rect.height) * 2 + 1;

      /* 相机射线 */
      var origin = camera.position.clone();
      var dir = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(origin).normalize();

      /* 与球相交 */
      var center = globe.position.clone();
      var oc = origin.clone().sub(center);
      var b = oc.dot(dir);
      var c = oc.dot(oc) - 1.0;
      var disc = b * b - c;
      if (disc < 0) return null;
      var sq = Math.sqrt(disc);
      var t = -b - sq;
      if (t < 0) t = -b + sq;
      if (t < 0) return null;

      /* 交点 → 球体局部坐标 */
      var p = origin.add(dir.multiplyScalar(t)).sub(center);

      /* 逆旋转：R = Rx(tilt)·Ry(rotY) ⇒ R⁻¹ = Ry(−rotY)·Rx(−tilt) */
      var e = globe.rotation;
      var cT = Math.cos(e.x), sT = Math.sin(e.x);
      var cY = Math.cos(e.y), sY = Math.sin(e.y);
      /* 先逆 Rx */
      var y2 =  p.y * cT + p.z * sT;
      var z2 = -p.y * sT + p.z * cT;
      /* 再逆 Ry */
      var x1 =  p.x * cY - z2 * sY;
      var z1 =  p.x * sY + z2 * cY;

      /* 局部坐标 → 经纬度
         正向：x = −cos(phi)·sin(th)，y = cos(th)，z = sin(phi)·sin(th)
               其中 th = (90−lat)·π/180，phi = (lon+180)·π/180
         由 y = sin(lat) ⇒ lat = asin(y)；由 phi = atan2(z, −x) */
      var lat = Math.asin(Math.max(-1, Math.min(1, y2))) * 180 / Math.PI;
      var phi = Math.atan2(z1, -x1);
      var lon = phi * 180 / Math.PI - 180;
      /* 归一到 [−180, 180] */
      while (lon < -180) lon += 360;
      while (lon > 180) lon -= 360;
      return { lon: lon, lat: lat };
    };

    (function frame() {
      requestAnimationFrame(frame);
      if (++checked <= 60) checkMask();
      var dt = Math.min(clock.getDelta(), 0.05);
      /* ★ 2026-10-08：聚焦模式（页面脚本通过 window.__globeFocus 驱动）
           · rotY / camZ 由页面脚本每帧写入，这里只读取
           · 聚焦期间不自转、不接受拖动，画面定格 */
      var F = window.__globeFocus;
      /* ★ 复位指令：页面点「返回标题界面」时置位，这里把角度与机位真正还原。
         之前只改了 F 里的值，循环里的 rotY/autoY 还停在聚焦角度，
         所以返回后地球依旧朝着中国 —— 这次一并还原。 */
      if (F && F.reset) {
        F.reset = false;
        rotY = 0; autoY = 0; vX = 0; camZ = 5.4;
        F.rot = 0; F.tilt = 0; F.camZ = 5.4; F.x = 0; F.y = 0;
      }
      /* ★★ 2026-10-08 新增：瞬时对齐通道（配合"假动画"）。
         场景：从投稿页跳转过来时不想播入场动画 ✗
         但返回动画依赖"动画播完后"那套状态（F.rot / F.tilt / F.camZ /
         F.on=false / F.lock=true）✗ 硬跳会让返回错乱。
         做法：页面脚本把目标值写进 F 并置 F.snap ✗
         这里【一帧内】把渲染用的 rotY / autoY / camZ 直接对过去 ——
         画面瞬间到位 ✗ 而状态与"动画播完"逐位一致 ✗ 返回因此照常工作。
         tilt 不在这里对齐 ✗ 因为 tiltNow 直接读 F.tilt（lock=true 时）✓ */
      if (F && F.hold) {
        /* ★★ 2026-10-08 改成【持续对齐】✗ 不再是一次性 snap。
           原因：3D 要等掩膜纹理加载完才 init ✗ 帧循环也可能还没跑起来 ✗
           一次性标记很容易被吞掉 —— 用户看到的正是"地球还停在美洲"✗
           而日志却写着"瞬时聚焦成功"。
           现在每帧都按 F.hold 对齐 ✗ 无论循环什么时候开始跑 ✗ 都会落到目标 ✗
           对齐期间 autoY/vX 清零 ✗ 所以不会自转也不会被惯性带偏。
           退出聚焦或返回标题时由页面脚本把 F.hold 清掉（很重要 ✗ 否则动画被顶住）。 */
        rotY = F.hold.rot;
        autoY = 0;
        vX = 0;
        camZ = F.hold.camZ;
      }
      /* ★★ 2026-10-08：全局待办（比 F.hold 更可靠 ✗ 见 gallery.html 里的说明）。
         每帧都执行 ✗ 所以不管 F 是刚创建还是早就有了 ✗ 都一定会落到板块视角 ✗
         并且强制把 lock / tilt 按住 ✗ 自转与拖动都被锁死。 */
      if (window.__jumpSnap) {
        var jp = window.__jumpSnap;
        rotY = jp.rot;
        autoY = 0;
        vX = 0;
        camZ = jp.camZ;
        /* ★★★ 2026-10-08：球体下移量【一次性抽到位】✗ 不留缓动距离。
           原来只写 F.y ✗ 而 globe.position.y 是用指数缓动逼近它的
           （Y_EASE=3.4 ✗ 时间常数约 0.3 秒）✗ 于是跳转瞬间会看到一段
           "从旧位置滑到新位置"的位移 —— 用户报的"上跳一下"就是它。
           这里在待办生效的第一帧直接把 position.y 赋成目标值 ✗
           之后再让缓动接管（此时两者已经相等 ✗ 自然没有位移）。 */
        if (jp.fresh) {
          jp.fresh = false;
          if (typeof jp.y === 'number') {
            globe.position.y = jp.y * (window.__globeShift || 1);
            if (F) F.yLive = globe.position.y;
            if (halo) halo.position.y = globe.position.y;
          }
        }
        if (F) {
          F.rot = jp.rot;
          F.tilt = jp.tilt;
          F.camZ = jp.camZ;
          F.x = 0;
          /* ★★ 2026-10-08：球体下移量也要跟上 ✗ 否则跳转后球会从原位上浮
             （用户看到的"向上跳一下"）。正常聚焦时 F.y = SHIFT_V = -0.30 ✗
             帧循环用指数缓动逼近它 ✗ 缺了这一步就是从 0 缓动到 0 ✗ 但球
             之前在别的位置 ✗ 于是肉眼看到一段位移。 */
          F.y = jp.y;
          F.lock = true;
          F.on = false;
        }
      }
      if (F && !F.on && !F.lock) { F.rot = rotY + autoY; F.camZ = camZ; F.tilt = 0; }   /* 非聚焦：同步当前值给页面脚本取用 */
      if (F && F.on) {
        rotY = F.rot;
        autoY = 0;
        camZ = F.camZ;
        vX = 0;
      } else if (!dragging) {
        if (!(F && F.lock)) autoY += dt * 0.038;               /* ★ 自转（同样只绕 Y 轴） */
        rotY += vX;
        /* ★ 2026-10-08 改成按时间衰减，不再按帧衰减。
           原来写 vX *= 0.92，意思是"每帧乘 0.92" —— 帧率越高衰减越快，
           30fps 下惯性会拖到 60fps 的两倍长。现在换成幂函数：
           0.92^(dt×60) 等价于"每 1/60 秒乘 0.92"，任何帧率下手感一致。 */
        vX *= Math.pow(0.92, dt * 60);                         /* 只有左右方向的惯性 */
      }
      /* 只绕 Y 轴转：globe.rotation.y 是拖动角度，子网格再叠一层自转角度。
         不再设置 rotation.x，所以球体的极轴永远竖直、不会上下翻。 */
      /* ★ 聚焦时同时应用俯仰（tilt），平时为 0，观感与原来完全一致 */
      /* ★★ 2026-10-08 最终修正：俯仰补偿【只在聚焦时生效】。
         起因：球体在场景里下移 shiftY 后，镜头仍看向世界原点，
         等效于镜头比球心高 asin(−shiftY)，画面会偏向北半球。
         原来用一个补偿量去抵消它，但那个补偿在【未聚焦】时也被应用 ——
         而未聚焦时 rawTilt 本来就是 0，于是净俯仰变成 −17.5°，
         用户看到的就是"点进入后画面明显对着南半球"。
         而聚焦中国时的 FOCUS.tilt = 0.67 是用户亲手调好、视觉认可的，
         它本身已经把该补的都算进去了。
         所以正确做法是：
            未聚焦 → tiltNow = 0        （与标题页完全一致，正对赤道）
            聚焦   → tiltNow = F.tilt   （就是调好的 0.67，不再二次补偿）
         下面保留 __globeTiltComp 作为应急开关（改 0 即关闭全部补偿），
         但默认值改成 0，也就是默认不做任何二次补偿。 */
      var rawTilt = (F && (F.on || F.lock)) ? (F.tilt || 0) : 0;
      var shiftY  = (F && F.y) ? F.y : 0;
      if (typeof window.__globeTiltComp !== 'number') window.__globeTiltComp = 0;
      /* 可选的手动微调：默认为 0，不做任何补偿 */
      var tiltComp = Math.asin(Math.max(-0.9, Math.min(0.9, -shiftY))) * window.__globeTiltComp;
      var tiltNow = rawTilt - tiltComp;
      globe.rotation.set(tiltNow, rotY, 0);
      /* ★ 球体的垂直偏移：进入地球后整体下移，用场景坐标而非 CSS 位移 */
      /* ★ 球体垂直偏移：目标是 F.y，但【不直接赋值】——
         直接赋值就没有过渡，进入地球时球体会「啪」地跳下去（用户反馈动画没了）。
         这里用指数插值追过去：每帧靠近剩余距离的一部分，
         时间常数约 0.45 秒，观感是干脆利落的缓出，和模糊纱解除的节奏相配。
         想更快就调大 Y_EASE（如 6.0），更慢就调小（如 2.0）。 */
      /* ★★ 2026-10-08 临时排查开关：可以单独关掉"进入后球体下移"这一步，
         用来判断"进入后画面偏南"到底是下移造成的，还是俯仰补偿造成的。
         控制台直接改，立即生效：
           window.__globeShift = 0;      // 关闭下移（球心回到原点）
           window.__globeShift = 1;      // 恢复（默认）
           window.__globeTiltComp = 0;   // 关闭俯仰补偿
         两个都关掉时，进入后的画面就应该和标题页完全一致。 */
      if (typeof window.__globeShift !== 'number') window.__globeShift = 1;
      var targetY = ((F && F.y) ? F.y : 0) * window.__globeShift;
      if (F && F.yDirect) {
        /* ★★ 2026-10-08：返回标题时页面脚本用【匀速】驱动 Y，这里直通不做缓动。
           进入地球时 F.y = SHIFT_V（下移）用指数缓动观感好（先快后慢）；
           但返回时同样的缓动会表现为"球猛地往上一窜"，故提供这条通道。 */
        globe.position.y = targetY;
      } else {
      var Y_EASE  = 3.4;
      globe.position.y += (targetY - globe.position.y) * Math.min(1, dt * Y_EASE);
      if (Math.abs(targetY - globe.position.y) < 0.0005) globe.position.y = targetY;   /* 收敛后归位 */
      }
      /* ★★ 2026-10-08：把球体的【真实垂直位置】回写给页面脚本。
         之前页面脚本用 F.y 当作"当前 Y"，但那只是它自己写的目标值 ——
         帧循环是缓动逼近的，两者会不同步。返回时一旦打开 yDirect，
         帧循环立刻采用过期的 F.y，球体就会瞬移（用户看到的"向上跳一下"）。
         这里每帧回写真实值，动画一律从真实位置起步。 */
      if (F) F.yLive = globe.position.y;
      /* ★ 光晕跟随球体：它挂在 scene 上而不是 globe 组里，不手动同步就会错位 */
      if (halo) halo.position.y = globe.position.y;
      globe.children[0].rotation.y = autoY;
      camera.position.set(0, 0, camZ);
      camera.lookAt(0, 0, 0);
      /* ★★ 2026-10-08：立刻刷新相机的世界矩阵与它的逆矩阵。
         为什么必须在这里做：本帧后面的城市光点/年份光点/省名标签，
         全都靠 Vector3.project(camera) 把 3D 点投到屏幕上，
         而 project() 读的是 camera.matrixWorldInverse。
         这个矩阵平时由 renderer.render() 在【渲染时】才算 ——
         也就是投影时用的其实是【上一帧】的相机姿态。
         平时一帧位移极小看不出来 ✗ 但在聚焦动画里 camZ 每帧都在快速变化 ✗
         投影就会整体偏一帧 ✗ 表现为"刚进入聚焦时所有光点都错位 ✗ 动画停下后就正常了"。
         在这里提前算一次 ✗ 本帧所有投影立刻用上当前相机 ✗ 错位消失。 */
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

        /* ★★ 把覆盖层（光点容器）严格对齐到画布 —— 必须在帧循环顶层定义 ✗
           因为它同时被板块光点和城市光点两处使用 ✗
           若写在 projectCityDots 的 IIFE 里 ✗ 前面的调用会拿不到它。 */
        function alignOverlay(b){
          if (!b) return;
          var r = renderer.domElement.getBoundingClientRect();
          if (!r.width || !r.height) return;
          if (b.style.position !== 'fixed') b.style.position = 'fixed';
          b.style.left = r.left.toFixed(1) + 'px';
          b.style.top = r.top.toFixed(1) + 'px';
          b.style.width = r.width.toFixed(1) + 'px';
          b.style.height = r.height.toFixed(1) + 'px';
          b.style.margin = '0';
        }
      /* ★ 五个大板块光点：每帧投影。
         元素由 gallery.html 在页面底部独立创建（不依赖 init 的异步掩膜加载，
         这样即便掩膜慢或失败，光点依然存在，只是位置停在原点）。
         这里每帧惰性查找一次 DOM，找不到就跳过 —— 不做缓存，
         因为 gallery.html 的脚本可能晚于本文件执行。 */
      var gBox = document.getElementById('groupDots');
        alignOverlay(gBox);   /* 板块光点容器同样对齐到画布 ✗ 它也偏了 41px */
      if (gBox && gBox.children.length) {
        var gdT = rotY + autoY;
        var gcT = Math.cos(tiltNow), gsT = Math.sin(tiltNow);
        var gcY = Math.cos(gdT),  gsY = Math.sin(gdT);
        var gW = renderer.domElement.clientWidth, gH = renderer.domElement.clientHeight;
        var gData = window.__GROUP_CENTERS || {};
        for (var gj = 0; gj < gBox.children.length; gj++) {
          var gEl = gBox.children[gj];
          var gName = gEl.getAttribute('data-group');
          var gC = gData[gName];
          if (!gC) continue;
          var gu = (gC.lon + 180) / 360;
          var gv = (90 - gC.lat) / 180;
          var gth = gv * Math.PI, gph = gu * Math.PI * 2;
          var gx = -Math.cos(gph) * Math.sin(gth);
          var gy =  Math.cos(gth);
          var gz =  Math.sin(gph) * Math.sin(gth);
          /* ★ 顺序必须与 Three.js 的 Euler('XYZ') 一致：R = Rx·Ry·Rz，
             所以先绕 Y 自转、再绕 X 俯仰。（之前写反了，纬度会被转到极区，
             表现就是光点全跑到北极附近。） */
          var gx1 =  gx * gcY + gz * gsY;
          var gz1 = -gx * gsY + gz * gcY;
          var gy1 =  gy * gcT - gz1 * gsT;
          var gz2 =  gy * gsT + gz1 * gcT;
          var gwp = new THREE.Vector3(gx1, gy1 + globe.position.y, gz2);
          gwp.project(camera);
          gEl.style.left = ((gwp.x * 0.5 + 0.5) * gW).toFixed(1) + 'px';
          gEl.style.top  = ((-gwp.y * 0.5 + 0.5) * gH).toFixed(1) + 'px';
          gEl.style.opacity = (gz2 > 0.02) ? '1' : '0';
        }
      }

      /* ★ 省名标签：每帧投影（惰性查找 DOM，理由同板块光点）。
         经纬度来自元素的 data-lon / data-lat，与 gallery.html 里创建时写入的一致。 */
      var pvOn = !!(window.__globeProvince && window.__globeProvince.on);
      if (pvOn) {
        var pvBox = document.getElementById('provLabels');
        if (pvBox && pvBox.children.length) {
          var pvT = rotY + autoY;
          var pcT = Math.cos(tiltNow), psT = Math.sin(tiltNow);
          var pcY = Math.cos(pvT),    psY = Math.sin(pvT);
          var pW = renderer.domElement.clientWidth, pH = renderer.domElement.clientHeight;
          for (var pi = 0; pi < pvBox.children.length; pi++) {
            var pEl = pvBox.children[pi];
            var pLon = parseFloat(pEl.getAttribute('data-lon'));
            var pLat = parseFloat(pEl.getAttribute('data-lat'));
            if (isNaN(pLon) || isNaN(pLat)) { pEl.style.display = 'none'; continue; }
            var pu = (pLon + 180) / 360;
            var pv2 = (90 - pLat) / 180;
            var pth = pv2 * Math.PI, pph = pu * Math.PI * 2;
            var ppx = -Math.cos(pph) * Math.sin(pth);
            var ppy =  Math.cos(pth);
            var ppz =  Math.sin(pph) * Math.sin(pth);
            var px1 =  ppx * pcY + ppz * psY;
            var pz1 = -ppx * psY + ppz * pcY;
            var py1 =  ppy * pcT - pz1 * psT;
            var pz2 =  ppy * psT + pz1 * pcT;
            var pwp = new THREE.Vector3(px1, py1 + globe.position.y, pz2);
            pwp.project(camera);
            pEl.style.display = '';
            pEl.style.left = ((pwp.x * 0.5 + 0.5) * pW).toFixed(1) + 'px';
            pEl.style.top  = ((-pwp.y * 0.5 + 0.5) * pH).toFixed(1) + 'px';
            pEl.style.opacity = (pz2 > 0.02) ? '0.9' : '0';
          }
        }
      } else {
        var pvHide = document.getElementById('provLabels');
        if (pvHide && pvHide.style.display !== 'none') pvHide.style.display = 'none';
      }
      /* ★★ 2026-10-08：城市光点投影。
         只在【板块聚焦】状态下显示 ✗ 且只显示属于该板块的城市
         （建点时已用 __groupAt 归档 ✗ 这里只做字符串比对 ✗ 不重复做几何判定）。
         与年份光点/板块光点用同一套经纬度→屏幕的换算 ✗ 保证完全对齐。 */
      (function projectCityDots(){
        var box = document.getElementById('cityDots');
          /* ★ 对齐必须放在【任何早退之前】✗ 否则不聚焦时永远不会执行 ✗
             容器就一直停在页面原点 ✗ 一聚焦就整体偏 41px。 */
          alignOverlay(box);
        if (!box || !box.children.length) return;
        var want = window.__cityFocus || null;
        if (!want) {
          if (box.style.opacity !== '0') { box.style.opacity = '0'; }
          return;
        }
        var tY = rotY + autoY;
        var cT = Math.cos(tiltNow), sT = Math.sin(tiltNow);
        var cY = Math.cos(tY),      sY = Math.sin(tY);
          /* ★★ 2026-10-08 真正的原因找到了（实测数据）：
               stage / globe3d / canvas  都在视口 (0,41) ✗ 尺寸 1174x707
               而 cityDots / groupDots   却在 (0,0) ✗ 尺寸 1174x2869（整页高）
             也就是说：光点容器【压根没有定位到画布上】✗ 它挂在页面原点了 ✗
             于是所有投影坐标都被整体平移了 41px ——
             41px 在这个视角下约合 1.8~2.0 度纬度 ✗ 与诊断里那个恒定的 +2.02 度完全吻合。
             为什么后来看着好像正常：动画停下后误差本身并没有变 ✗ 只是不再动了 ✗
             眼睛失去运动参照 ✗ 就不容易察觉。
             修法：容器改用 position:fixed ✗ 它的包含块就是视口 ✗
             于是把画布的 getBoundingClientRect() 直接写进它的 left/top/width/height ✗
             容器就与画布像素级重合 ✗ 写进去的 left/top 才真正等于画布坐标。
             每帧都写 ✗ 所以缩放窗口、导航栏高度变化、文档高度突变都不会再影响它。 */
          var cw = renderer.domElement.clientWidth, ch = renderer.domElement.clientHeight;
          var W = cw, H = ch;   /* ★ 与上面强制对齐后的容器尺寸完全一致 */
        var v = new THREE.Vector3();
        for (var i = 0; i < box.children.length; i++) {
          var el = box.children[i];
          if (el.getAttribute('data-group') !== want) {
            if (el.style.display !== 'none') el.style.display = 'none';
            continue;
          }
          var lon = parseFloat(el.getAttribute('data-lon'));
          var lat = parseFloat(el.getAttribute('data-lat'));
          var u = (lon + 180) / 360, vv = (90 - lat) / 180;
          var th = vv * Math.PI, ph = u * Math.PI * 2;
          var px = -Math.cos(ph) * Math.sin(th);
          var py =  Math.cos(th);
          var pz =  Math.sin(ph) * Math.sin(th);
          var x1 =  px * cY + pz * sY;
          var z1 = -px * sY + pz * cY;
          var y1 =  py * cT - z1 * sT;
          var z2 =  py * sT + z1 * cT;
          if (z2 <= 0.02) { el.style.opacity = '0'; continue; }   /* 背面 */
          v.set(x1, y1 + globe.position.y, z2).project(camera);
          el.style.display = '';
          var sx = (v.x * 0.5 + 0.5) * W;
          var sy = (-v.y * 0.5 + 0.5) * H;
          el.style.left = sx.toFixed(1) + 'px';
          el.style.top  = sy.toFixed(1) + 'px';
          /* ★★ 2026-10-08：淡出写在【内层圆点】上 ✗ 绝对不能再写在外层 .city-dot 上。
             因为 opacity 会被子元素继承 ✗ 写在外层会让整张卡片跟着变半透明 ✗
             越靠球体边缘越淡 ✗ 最后卡片几乎看不见 —— 这就是"卡片消失"的原因。 */
          var core = el.firstChild;
          if (core) core.style.opacity = Math.max(0, Math.min(1, z2 * 1.6)).toFixed(2);

          /* ★★ 卡片防裁切：光点太靠上时改为向下弹 ✗ 太靠左/右时把卡片推回视口内 */
          if (sy < 320) el.classList.add('below'); else el.classList.remove('below');
          var HALF = 158;                       /* 卡片半宽 min(300px,32vw)/2 + 余量 */
          var dx = 0;
          if (sx < HALF + 12) dx = (HALF + 12) - sx;
          else if (sx > W - HALF - 12) dx = (W - HALF - 12) - sx;
          el.style.setProperty('--cddx', dx.toFixed(0) + 'px');

        }
        box.style.opacity = '1';
      })();

      mat.uniforms.sunDir.value.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
      renderer.render(scene, camera);
    })();

    /* ---------- 拖动开关：跟随 .stage 上的 .entered ----------
       本页在标题/介绍界面期间要锁住地球（不让人误操作），
       点「进入」后 gallery.html 给 .stage 加上 .entered，这里随即解锁。
       另外：没有 .stage 的页面（比如独立项目）默认就是可拖动的。 */
    var stageEl = container.closest ? container.closest('.stage') : null;
    if (stageEl) {
      var syncDrag = function () {
        dragEnabled = stageEl.classList.contains('entered');
        if (!dragEnabled) { dragging = false; vX = 0; }
        el.style.cursor = dragEnabled ? 'grab' : 'default';
      };
      /* 被动观察类名变化，避免和页面脚本耦合 */
      if (window.MutationObserver) {
        new MutationObserver(syncDrag).observe(stageEl, { attributes: true, attributeFilter: ['class'] });
      }
      /* 兜底：每秒对一次状态（也覆盖 MutationObserver 不可用的环境） */
      setInterval(syncDrag, 1000);
      syncDrag();
    }
  }
})();


/* ══════════════════════════════════════════════════════════════════════════
   ★★★ 从投稿页跳转过来的全套处理（2026-10-08 第五版 ✗ 放在 globe3d.js 里）
   ──────────────────────────────────────────────────────────────────────────
   为什么放在这里而不是 gallery.html：
     gallery.html 的 URL 没有版本号 ✗ 浏览器很容易用缓存里的旧 HTML ✗
     而 globe3d.js 的 URL 带 ?v=20261008-10 ✗ 改了版本就一定会重新加载。
     跳转的相机逻辑放在这里 ✗ 才能保证"改了就一定生效"✗ 不受缓存干扰。
   工作方式：
     · location.hash 带 #city=城市名 时启动
     · 轮询等 cityDots 建档 + __GROUP_CENTERS 就绪
     · 自己算板块机位（公式与页面 targetOf() 一致）✗ 挂到 window.__jumpSnap
     · 帧循环【每帧】读它并强制对齐 rotY / autoY / camZ ✗ 同时按住 F.lock
       → 不管 3D 什么时候 init ✗ 都一定会落到板块视角 ✗ 且锁死自转与滚轮
     · 释放条件：有人把 F.lock 关掉（用户点「返回标题界面」）✗ 自动撤下
   ══════════════════════════════════════════════════════════════════════════ */
/* ★★ 2026-10-08：用经纬度到 2210 座目录里查【带后缀的正式名】。
   起因：__CITIES 里存的是短名（上海 / 天水）✗ 而目录里是上海市 / 天水市 ✗
   短名在县级市与地级市之间可能重名 ✗ 所以统一改成正式名 ✗
   查法用经纬度匹配（±约 15km）✗ 比按名字猜可靠得多。 */
window.__cityFullName = function (lon, lat, fallback) {
  var pool = window.__CITY_POOL && window.__CITY_POOL.list;
  if (!pool || lon == null || lat == null) return fallback;
  var best = null, bd = 1e9;
  var cosLat = Math.cos(lat * Math.PI / 180);
  for (var i = 0; i < pool.length; i++) {
    var dx = (pool[i][1] - lon) * cosLat;
    var dy = pool[i][2] - lat;
    var d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = pool[i]; }
  }
  /* 0.02 平方度 ≈ 15km ✗ 超过就认为目录里没有这座城 */
  return (best && bd < 0.02) ? best[0] : fallback;
};

/* ★★ 2026-10-08：按城市名找光点 ✗ 后缀不敏感。
   光点用短名（上海）✗ 投稿表单用全名（上海市）✗ 直接查会落空 ✗
   落空的后果是"重复建一个同城光点"✗ 页面上出现两个上海。 */
function findCityDot(name) {
  var box = document.getElementById('cityDots');
  if (!box) return null;
  var short = String(name || '').replace(/[市县区旗]$/, '');
  var d = box.querySelector('[data-city="' + name + '"]');
  if (d) return d;
  d = box.querySelector('[data-city="' + short + '"]');
  if (d) return d;
  /* 再退一步：遍历比对（去掉后缀后相等就算命中）*/
  var kids = box.children;
  for (var i = 0; i < kids.length; i++) {
    var c = kids[i].getAttribute('data-city');
    if (c && String(c).replace(/[市县区旗]$/, '') === short) return kids[i];
  }
  return null;
}
window.__findCityDot = findCityDot;

(function jumpFromHash() {
  var m = /(?:^|[#&])city=([^&]*)/.exec(location.hash || '');
  if (!m) return;
  var name = decodeURIComponent(m[1] || '');
  if (!name) return;
  console.log('[跳转] 启动 ✗ 目标城市：' + name);
  setTimeout(function () {
    try {
      var n = (window.__SubmitStore && window.__SubmitStore.all().length) || 0;
      console.log('[跳转] 本机共有 ' + n + ' 条投稿' +
        (n ? '：' + window.__SubmitStore.all().map(function (r) { return r.city; }).join('、') : '（localStorage 里没有 ✗ 面板①要先点一次）'));
    } catch (e) {}
  }, 1200);

  var armed = false, tries = 0, released = false;

  setInterval(function () {
    var F = window.__globeFocus;

    /* 释放：用户点了返回 ✗ 页面脚本把 lock 关掉且没有动画在跑 */
    if (armed && F && F.lock === false && !F.on && !released) {
      released = true;
      window.__jumpSnap = null;
      console.log('[跳转] 已释放（检测到 F.lock 被关掉 ✗ 说明用户点了返回）');
      return;
    }
    if (released || armed) return;
    if (++tries > 1200) { console.warn('[跳转] 超时放弃'); return; }

    var box = document.getElementById('cityDots');
    if (!box || !box.children.length) return;
    if (!window.__GROUP_CENTERS) return;

    var dot = findCityDot(name);                 /* ★ 后缀不敏感 */
    var grp = dot && dot.getAttribute('data-group');

    /* ★★ 2026-10-08 兜底：这个城市没有光点 ✗ 就自己补一个。
       正常路径是 gallery.html 里的 mergeSubmittedCities 在建点时补进去 ✗
       但如果 HTML 是缓存里的旧版 ✗ 那一步就没执行 ✗ 光点永远不会有。
       这里独立补：查 2210 座城市目录拿坐标 ✗ 再用"最近的已有光点"
       推断它属于哪个板块 ✗ 然后造一个 .city-dot 塞进去。
       帧循环会照常投影它 ✗ 所以跳转与红圈高亮都能正常工作。 */
    if (!grp) {
      var pool = window.__cityPoolFind ? window.__cityPoolFind(name) : null;
      if (!pool) { if (++tries % 200 === 0) console.warn('[跳转] 「' + name + '」既没有光点 ✗ 也不在 2210 座城市目录里'); return; }
      /* ① 优先用页面自己的 __groupAt（权威 ✗ 和正常建点走同一套判定）*/
      var viaAt = null;
      try { if (window.__groupAt) viaAt = window.__groupAt(pool.lon, pool.lat); } catch (e) {}
      if (viaAt && window.__GROUP_CENTERS && window.__GROUP_CENTERS[viaAt]) {
        grp = viaAt;
      } else {
      /* ② 退路：用最近的已有光点推断板块 */
      var best = null, bestD = 1e9;
      var all = box.children;
      for (var i = 0; i < all.length; i++) {
        var lon2 = parseFloat(all[i].getAttribute('data-lon'));
        var lat2 = parseFloat(all[i].getAttribute('data-lat'));
        if (isNaN(lon2) || isNaN(lat2)) continue;
        var dx2 = (lon2 - pool.lon) * Math.cos(pool.lat * Math.PI / 180);
        var dy2 = lat2 - pool.lat;
        var d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (d2 < bestD) { bestD = d2; best = all[i]; }
      }
      grp = (best && best.getAttribute('data-group')) || null;
      }
      if (!grp) return;
      dot = document.createElement('div');
      dot.className = 'city-dot lv' + (pool.tier || 4);
      dot.setAttribute('data-city', name);
      dot.setAttribute('data-group', grp);
      dot.setAttribute('data-lon', String(pool.lon));
      dot.setAttribute('data-lat', String(pool.lat));
      dot.setAttribute('data-lv', String(pool.tier || 4));
      dot.title = name + '（' + grp + '）';
      dot.innerHTML = '<span class="cd-core"></span><span class="cd-halo"></span>' +
        '<span class="cd-name">' + name + '</span>' +
        '<div class="cd-pop"><div class="cd-src-row"><span class="cd-src">来自 ' + name + '的 匿名</span>' +
        '<span class="cd-year" hidden></span></div>' +
        '<div class="cd-stage"><button class="cd-nav cd-prev" type="button">\u2039</button>' +
        '<div class="cd-photo"><div class="cd-track"></div><span class="cd-phcap"></span><span class="cd-count"></span></div>' +
        '<button class="cd-nav cd-next" type="button">\u203a</button></div>' +
        '<p class="cd-text">这里是' + name + '的占位文本。</p></div>';
      dot._photos = [{ src: (window.__mkPh ? window.__mkPh(name, 16, 9, '照片占位') : ''), cap: name + ' · 占位' }];
      dot.style.display = 'none';
      dot.addEventListener('mouseenter', function () { if (window.__buildCarousel) window.__buildCarousel(dot); });
      box.appendChild(dot);
      console.log('[跳转] 「' + name + '」原本没有光点 ✗ 已按最近邻归入「' + grp + '」并补建');
    }
    var C = window.__GROUP_CENTERS[grp];
    if (!C) { if (++tries % 200 === 0) console.warn('[跳转] 板块中心数据缺失：' + grp); return; }

    var Z = (window.__globeGroupFocus && window.__globeGroupFocus.zoom) || 1.60;
    window.__jumpSnap = {
      rot:  Math.PI / 2 - (C.lon + 180) * Math.PI / 180,
      tilt: C.lat * Math.PI / 180 - Math.asin(0.30),
      camZ: Z,
      y: -0.30,                     /* ★ 与页面里的 SHIFT_V 一致 ✗ 球体下移 */
      fresh: true                   /* ★ 让帧循环在第一帧把 position.y 直接抽到位 */
    };
    window.__cityFocus = grp;
    armed = true;

    document.documentElement.className += ' jump-in';
    var st = document.getElementById('globeStage');

    /* ★★★ 2026-10-08 关键修复：必须调页面自己的 __globeEnterInstant()。
       之前只摆了 DOM 的 class ✗ 而页面闭包里的 entered 变量还是 false ✗
       后果是一连串的：
         · leave() 第一行就 if (!entered) return; ✗ 返回时的清理（restoreInline /
           F.reset / 标题恢复 / 模糊回来）全部不执行
         · 地球停在"下移后"的位置回不到初始机位
         · sync() 读的是 .stage.entered 这个 class ✗ class 在 ✗ 于是它以为
           还处于"已进入但未聚焦"✗ 把「继续探索」按钮又显示出来
         · 返回动画播了但收尾不对 ✗ 看起来是"跳一下"
       调它之后 entered 就是真的 true ✗ 上面这些全部回归正常路径。 */
    if (window.__globeEnterInstant) {
      try { window.__globeEnterInstant(); console.log('[跳转] 已调用页面 enter() ✗ entered 变量已置真'); }
      catch (e) { console.warn('[跳转] enter() 调用出错：' + e.message); }
    } else {
      /* 兜底：HTML 若是缓存的旧版可能没有这个函数 ✗ 至少把 class 摆上 */
      console.warn('[跳转] __globeEnterInstant 不可用 ✗ 只能摆 class（返回可能不正常）');
      if (st) st.classList.add('entered');
    }
    if (st) st.classList.add('focus');
    document.documentElement.setAttribute('data-globe-next', '1');
    var nb = document.getElementById('nextBtn'); if (nb) nb.classList.remove('on');
    var cd = document.getElementById('cityDots'); if (cd) cd.style.opacity = '1';
    var f  = document.getElementById('flow'); if (f) f.style.display = 'none';
    var ft = document.querySelector('.site-footer');
    if (ft) { ft.style.visibility = 'hidden'; ft.style.pointerEvents = 'none'; }
    var v  = document.getElementById('blurVeil'); if (v) v.classList.add('lifted');
    var bk = document.getElementById('backBtn'); if (bk) bk.classList.add('show');
    document.documentElement.style.overflow = 'hidden';
    window.scrollTo(0, 0);

    /* ★★ 2026-10-08：必须同时把【页面脚本的 groupFocus】设上。
       返回按钮里写的是 if (groupFocus) { 播放两段动画 } else { 硬复位 } ✗
       而 groupFocus 是页面 IIFE 里的闭包变量 ✗ 从外面改不了 ✗
       只能调它的 snap() ✗ 否则返回时 groupFocus 是 null ✗
       两段动画被整段跳过 ✗ 直接 F.reset 硬跳回标题（用户实测到的现象）。 */
    try {
      if (window.__globeGroupFocus && window.__globeGroupFocus.snap) {
        window.__globeGroupFocus.snap(grp);
        console.log('[跳转] 已设置页面 groupFocus = ' + grp + '（返回动画需要它）');
      } else {
        console.warn('[跳转] __globeGroupFocus.snap 不可用 ✗ 返回时可能不播动画');
      }
    } catch (e) { console.warn('[跳转] 调 snap 出错：' + e.message); }

    /* ★★ 关键：相机到位后必须【自动释放】✗ 否则帧循环每帧强行覆盖角度 ✗
       用户点什么都会被瞬间拉回来 —— 表现就是"进去之后完全操作不了"。
       释放之后 F.lock 仍是 true（和正常聚焦结束时一样 ✗ 定格、不可拖）✗
       但点击事件照常生效：点空位回中国全景 ✗ 点别的板块切过去 ✗ 点返回回标题。 */
    setTimeout(function () {
      window.__jumpSnap = null;
      console.log('[跳转] 相机锁定已释放 ✗ 现在可以正常点击板块 / 点空位回中国');
    }, 1200);

    console.log('[跳转] 已锁定板块「' + grp + '」rot=' + window.__jumpSnap.rot.toFixed(3) +
                ' tilt=' + window.__jumpSnap.tilt.toFixed(3) + ' camZ=' + Z + ' ✗ 帧循环每帧强制执行');
    setTimeout(function () { if (window.__haloCity) window.__haloCity(name); }, 1000);
  }, 50);
})();
