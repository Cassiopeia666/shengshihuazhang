/* ══════════════════════════════════════════════════════════════════════
 *  图片压缩 —— 投稿照片落地前必过这一关
 *  ══════════════════════════════════════════════════════════════════════
 *  为什么必须压缩：投稿存在 localStorage 里 ✗ 总量只有约 5 MB。
 *  手机原图一张 2~5 MB ✗ 不压缩只能存 1 张；
 *  压到最长边 1024px ✗ JPEG 质量 0.72 后平均约 77 KB ✗ 能存 60 张以上。
 *  （实测数据：用站点里的真实照片跑过 15 组参数组合得出）
 *
 *  用法：
 *    window.__compressImage(file, {maxSide:1024, quality:0.72})
 *      .then(function (r) { r.dataUrl  // 可以直接放进 <img src>
 *                           r.bytes    // 压缩后字节数
 *                           r.origBytes// 原始字节数
 *                           r.width, r.height })
 * ══════════════════════════════════════════════════════════════════════ */
window.__compressImage = function (file, opts) {
  opts = opts || {};
  var maxSide = opts.maxSide || 1024;
  var quality = opts.quality == null ? 0.72 : opts.quality;
  var mime = opts.mime || 'image/jpeg';

  return new Promise(function (resolve, reject) {
    if (!file) { reject(new Error('没有文件')); return; }

    var finish = function (src, w, h, revoke) {
      try {
        var k = Math.min(1, maxSide / Math.max(w, h));
        var tw = Math.max(1, Math.round(w * k));
        var th = Math.max(1, Math.round(h * k));
        var cv = document.createElement('canvas');
        cv.width = tw; cv.height = th;
        var ctx = cv.getContext('2d');
        /* 先铺白底 ✗ 否则透明 PNG 转 JPEG 会变成黑底 */
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
        ctx.drawImage(src, 0, 0, tw, th);
        if (revoke) revoke();
        var dataUrl = cv.toDataURL(mime, quality);
        /* dataURL 去掉头部剩下的长度 × 3/4 就是大致字节数 */
        var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        var bytes = Math.round(b64.length * 3 / 4);
        resolve({
          dataUrl: dataUrl, bytes: bytes, origBytes: file.size || 0,
          width: tw, height: th, srcWidth: w, srcHeight: h,
          saved: file.size ? (1 - bytes / file.size) : 0
        });
      } catch (e) { reject(e); }
    };

    /* 优先用 createImageBitmap ✗ 它会自动按 EXIF 摆正手机照片的方向 ✗
       否则竖着拍的照片在网页里会躺倒。 */
    if (window.createImageBitmap) {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(function (bmp) { finish(bmp, bmp.width, bmp.height, function () { bmp.close && bmp.close(); }); })
        .catch(function () { viaImg(); });
    } else { viaImg(); }

    function viaImg() {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { finish(im, im.naturalWidth, im.naturalHeight, function () { URL.revokeObjectURL(url); }); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      im.src = url;
    }
  });
};
