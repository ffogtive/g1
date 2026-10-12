/*
 * 모아쿵! — 그림 (캔버스 벡터, 이미지 파일 없음)
 * 가설: 케이크가 "망가뜨리기 아까울 만큼 예쁘면" 금·찌그러짐·무너짐 단계가 그 자체로 보상이 된다.
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var W = 400, H = 680;
  var PERSP = 0.42; // 바닥 타원의 세로/가로 비 (살짝 내려다보는 시점)
  var TRAY = { x: 16, y: 58, w: 368, h: 568, r: 46 };
  var FLOOR = { x: 33, y: 75, w: 334, h: 534, r: 32 };
  var ITEM_R = 8;
  var IS = 1.28; // 재료 표시 배율
  var FONT = '"Jua", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "WenQuanYi Zen Hei", sans-serif';

  function rngFrom(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function starPath(ctx, x, y, ro, ri, n, rot) {
    n = n || 5;
    rot = rot || -Math.PI / 2;
    for (var i = 0; i < n * 2; i++) {
      var r = i % 2 ? ri : ro;
      var a = rot + (i * Math.PI) / n;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  /* ---------------------------------------------------------------
   * 재료 스프라이트
   * ------------------------------------------------------------- */
  var VARIANTS = {
    steel: 1,
    nut: 2,
    jelly: 4,
    pearl: 2,
    button: 4,
    star: 3
  };
  var JELLY = [['#ff6fa8', '#ffc2db'], ['#5fd36a', '#bff3c3'], ['#ffa63d', '#ffe0b3'], ['#9b7bff', '#dcd1ff']];
  var BUTTON = [['#8fdcc5', '#5fb39b'], ['#ff9b86', '#d96f5a'], ['#c3adff', '#9478e0'], ['#ffd97a', '#d8aa3c']];
  var STAR = [['#fff3a8', '#ffc53a', '#d98b0e'], ['#ffd1e6', '#ff8fbf', '#d6578f'], ['#d6f0ff', '#7cc6ff', '#3d8fd6']];

  function drawMaterialShape(ctx, mat, v) {
    var g;
    switch (mat) {
      case 'steel':
        g = ctx.createRadialGradient(-2.6, -3, 0.4, 0, 0, 7.4);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.22, '#eef2f7');
        g.addColorStop(0.62, '#9ea9b7');
        g.addColorStop(1, '#4d5866');
        ctx.beginPath();
        ctx.arc(0, 0, 6.8, 0, TAU);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = 'rgba(40,48,60,0.55)';
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(1.8, 3.4, 3.4, 1.4, -0.3, 0, TAU);
        ctx.fillStyle = 'rgba(255,240,230,0.35)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-2.5, -2.8, 1.5, 0, TAU);
        ctx.fillStyle = '#fff';
        ctx.fill();
        break;
      case 'nut':
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
          var a = (i * Math.PI) / 3 + Math.PI / 6;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 7.6, Math.sin(a) * 7.6);
        }
        ctx.closePath();
        g = ctx.createLinearGradient(-6, -6, 6, 6);
        if (v === 0) {
          g.addColorStop(0, '#fff0b8');
          g.addColorStop(0.5, '#e7b94c');
          g.addColorStop(1, '#a87a1e');
        } else {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.5, '#c3ccd8');
          g.addColorStop(1, '#6d7888');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = v === 0 ? '#8d6416' : '#4e5866';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 3.1, 0, TAU);
        g = ctx.createRadialGradient(0.8, 0.8, 0.3, 0, 0, 3.2);
        g.addColorStop(0, v === 0 ? '#5a4313' : '#3c434d');
        g.addColorStop(1, v === 0 ? '#2e2208' : '#1d2127');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-5.5, -4);
        ctx.lineTo(-1.5, -6.6);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        break;
      case 'jelly':
        var c = JELLY[v];
        g = ctx.createRadialGradient(-1.6, -2.5, 0.5, 0, 0, 8.5);
        g.addColorStop(0, c[1]);
        g.addColorStop(0.55, c[0]);
        g.addColorStop(1, c[0]);
        ctx.globalAlpha = 0.86;
        ctx.fillStyle = g;
        // 젤리 곰
        ctx.beginPath();
        ctx.arc(-3.2, -6.4, 1.9, 0, TAU);
        ctx.arc(3.2, -6.4, 1.9, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -3.6, 3.7, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, 2.6, 4.6, 5.1, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-4.6, 1.2, 1.6, 2.2, 0.5, 0, TAU);
        ctx.ellipse(4.6, 1.2, 1.6, 2.2, -0.5, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-2.8, 6.6, 1.8, 1.5, 0, 0, TAU);
        ctx.ellipse(2.8, 6.6, 1.8, 1.5, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(-1.6, -4.6, 1.2, 0.8, -0.5, 0, TAU);
        ctx.ellipse(-2, 1, 1, 2.2, 0.2, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fill();
        break;
      case 'pearl':
        ctx.beginPath();
        var pts = v === 0
          ? [[-7, -2], [-3, -7], [4, -6], [7.5, 0], [3, 6.5], [-5, 5]]
          : [[-6.5, -4.5], [1, -7.5], [7, -2], [5, 5.5], [-2, 7], [-7.5, 2]];
        pts.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]); });
        ctx.closePath();
        g = ctx.createLinearGradient(-7, -7, 7, 7);
        g.addColorStop(0, '#fbfaff');
        g.addColorStop(0.3, '#cdefff');
        g.addColorStop(0.55, '#f6d6ff');
        g.addColorStop(0.8, '#d6ffe9');
        g.addColorStop(1, '#fff2d6');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = 'rgba(150,140,190,0.7)';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-4, -3);
        ctx.quadraticCurveTo(0, -1, 3, -4);
        ctx.moveTo(-3, 2);
        ctx.quadraticCurveTo(1, 3.5, 4, 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        break;
      case 'button':
        var b = BUTTON[v];
        ctx.beginPath();
        ctx.arc(0, 0, 7.3, 0, TAU);
        g = ctx.createRadialGradient(-2, -2.5, 1, 0, 0, 7.5);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, b[0]);
        g.addColorStop(1, b[1]);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = b[1];
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 5.1, 0, TAU);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.fillStyle = 'rgba(40,30,30,0.55)';
        [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]].forEach(function (p) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 0.95, 0, TAU);
          ctx.fill();
        });
        break;
      case 'star':
        var s = STAR[v];
        ctx.beginPath();
        starPath(ctx, 0, 0.4, 8.4, 3.9, 5);
        g = ctx.createLinearGradient(-6, -7, 6, 7);
        g.addColorStop(0, s[0]);
        g.addColorStop(0.5, s[1]);
        g.addColorStop(1, s[2]);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = s[2];
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-1.4, -1.8, 1.2, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
        break;
    }
  }

  var spriteCache = {};
  var spritePx = 1;
  function setPixelScale(px) {
    if (Math.abs(px - spritePx) > 0.01) {
      spritePx = px;
      spriteCache = {};
    }
  }
  function sprite(mat, v) {
    var key = mat + v;
    var c = spriteCache[key];
    if (c) return c;
    var S = 22;
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(S * spritePx * IS);
    var x = c.getContext('2d');
    x.scale(spritePx * IS, spritePx * IS);
    x.translate(S / 2, S / 2);
    drawMaterialShape(x, mat, v);
    spriteCache[key] = c;
    return c;
  }

  function drawItemShadow(ctx, x, y, s, alpha) {
    ctx.globalAlpha = (alpha == null ? 1 : alpha) * 0.22;
    s *= IS;
    ctx.beginPath();
    ctx.ellipse(x + 1.2, y + 4.5 * s, 6.5 * s, 2.6 * s, 0, 0, TAU);
    ctx.fillStyle = '#6b3f2a';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 재료 하나 그리기. (x, y)는 화면 위치, s 크기, rot 회전 */
  function drawItem(ctx, mat, v, x, y, s, rot, alpha) {
    var sp = sprite(mat, v);
    var S = 22 * s * IS;
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(sp, -S / 2, -S / 2, S, S);
    ctx.restore();
  }

  function drawGlint(ctx, x, y, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    starPath(ctx, x, y, size, size * 0.18, 4, 0);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------
   * 배경: 깅엄 식탁보 + 도자기 쟁반
   * ------------------------------------------------------------- */
  function drawBackground(ctx) {
    // 식탁보는 CSS 배경이 그린다 (캔버스 밖과 무늬가 이어지도록)
    // 쟁반 그림자
    ctx.save();
    ctx.shadowColor = 'rgba(140,70,80,0.35)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    ctx.beginPath();
    roundRect(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, TRAY.r);
    ctx.fillStyle = '#f1e8e2';
    ctx.fill();
    ctx.restore();
    // 테두리(림)
    var g = ctx.createLinearGradient(0, TRAY.y, 0, TRAY.y + TRAY.h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#f4ece6');
    g.addColorStop(1, '#ddcfc6');
    ctx.beginPath();
    roundRect(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, TRAY.r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(170,130,120,0.5)';
    ctx.stroke();
    // 림 장식선
    ctx.beginPath();
    roundRect(ctx, TRAY.x + 7, TRAY.y + 7, TRAY.w - 14, TRAY.h - 14, TRAY.r - 7);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#a9dfd0';
    ctx.stroke();
    // 바닥
    ctx.beginPath();
    roundRect(ctx, FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h, FLOOR.r);
    g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 380);
    g.addColorStop(0, '#fffaf2');
    g.addColorStop(1, '#f8eadb');
    ctx.fillStyle = g;
    ctx.fill();
    // 바닥 무늬
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(232,206,186,0.45)';
    for (var yy = FLOOR.y + 12; yy < FLOOR.y + FLOOR.h; yy += 24) {
      for (var xx = FLOOR.x + 12 + ((yy / 24) % 2) * 12; xx < FLOOR.x + FLOOR.w; xx += 24) {
        ctx.beginPath();
        ctx.arc(xx, yy, 1.4, 0, TAU);
        ctx.fill();
      }
    }
    // 안쪽 그림자 (림 아래 턱)
    for (var i = 0; i < 6; i++) {
      ctx.beginPath();
      roundRect(ctx, FLOOR.x - i, FLOOR.y - i, FLOOR.w + i * 2, FLOOR.h + i * 2, FLOOR.r + i);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(150,100,80,' + (0.05 - i * 0.007) + ')';
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    roundRect(ctx, FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h, FLOOR.r);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(190,150,130,0.6)';
    ctx.stroke();
  }

  /* ---------------------------------------------------------------
   * 케이크 공통 도구
   * ------------------------------------------------------------- */
  function sidePath(ctx, x, y, rx, ry, h, rxTop) {
    rxTop = rxTop == null ? rx : rxTop;
    var ryTop = (ry * rxTop) / rx;
    ctx.moveTo(x - rxTop, y - h);
    ctx.lineTo(x - rx, y);
    ctx.ellipse(x, y, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(x + rxTop, y - h);
    ctx.ellipse(x, y - h, rxTop, ryTop, 0, 0, Math.PI, false);
    ctx.closePath();
  }
  function silhouettePath(ctx, x, y, rx, ry, h, rxTop) {
    rxTop = rxTop == null ? rx : rxTop;
    var ryTop = (ry * rxTop) / rx;
    ctx.moveTo(x - rxTop, y - h);
    ctx.lineTo(x - rx, y);
    ctx.ellipse(x, y, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(x + rxTop, y - h);
    ctx.ellipse(x, y - h, rxTop, ryTop, 0, 0, Math.PI, true);
    ctx.closePath();
  }
  function bandPath(ctx, x, rx, ry, y1, y2) {
    ctx.moveTo(x - rx, y1);
    ctx.ellipse(x, y1, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(x + rx, y2);
    ctx.ellipse(x, y2, rx, ry, 0, 0, Math.PI, false);
    ctx.closePath();
  }
  function shadeSide(ctx, x, rx, y1, y2, k) {
    k = k == null ? 1 : k;
    var g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
    g.addColorStop(0, 'rgba(70,35,25,' + 0.26 * k + ')');
    g.addColorStop(0.22, 'rgba(255,255,255,' + 0.16 * k + ')');
    g.addColorStop(0.42, 'rgba(255,255,255,0)');
    g.addColorStop(0.8, 'rgba(70,35,25,' + 0.1 * k + ')');
    g.addColorStop(1, 'rgba(70,35,25,' + 0.32 * k + ')');
    ctx.fillStyle = g;
    ctx.fillRect(x - rx - 2, y1 - 30, rx * 2 + 4, y2 - y1 + 60);
  }
  function cylinder(ctx, x, y, rx, ry, h, side, top, shadeK) {
    ctx.save();
    ctx.beginPath();
    sidePath(ctx, x, y, rx, ry, h);
    ctx.fillStyle = side;
    ctx.fill();
    ctx.clip();
    shadeSide(ctx, x, rx, y - h, y + ry, shadeK);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(x, y - h, rx, ry, 0, 0, TAU);
    ctx.fillStyle = top;
    ctx.fill();
  }
  function vgrad(ctx, y1, y2, stops) {
    var g = ctx.createLinearGradient(0, y1, 0, y2);
    stops.forEach(function (s, i) { g.addColorStop(i / (stops.length - 1), s); });
    return g;
  }
  function dripPath(ctx, px, py, w, len) {
    ctx.moveTo(px - w, py - 1);
    ctx.lineTo(px - w, py + len - w);
    ctx.arc(px, py + len - w, w, Math.PI, 0, true);
    ctx.lineTo(px + w, py - 1);
    ctx.closePath();
  }
  function drips(ctx, x, yTop, rx, ry, color, seed, maxLen, keep) {
    var r = rngFrom(seed);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < 11; i++) {
      var th = 0.08 * Math.PI + (i / 10) * 0.84 * Math.PI;
      var px = x + Math.cos(th) * rx;
      var py = yTop + Math.sin(th) * ry;
      var len = (0.3 + r() * 0.7) * maxLen * (keep == null ? 1 : 0.4 + 0.6 * keep);
      dripPath(ctx, px, py, 2.2 + r() * 1.6, len);
    }
    ctx.fill();
    // 위 테두리를 덮는 띠
    ctx.beginPath();
    ctx.ellipse(x, yTop, rx, ry, 0, 0, Math.PI, false);
    ctx.ellipse(x, yTop + 3, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
  }
  function shine(ctx, x, y, rx, ry, a) {
    ctx.save();
    ctx.globalAlpha = a == null ? 0.5 : a;
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.32, y - ry * 0.25, rx * 0.36, ry * 0.32, -0.2, 0, TAU);
    var g = ctx.createRadialGradient(x - rx * 0.32, y - ry * 0.3, 0, x - rx * 0.32, y - ry * 0.25, rx * 0.4);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
  function strawberry(ctx, x, y, s, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.bezierCurveTo(-7, 2, -6, -5, 0, -5);
    ctx.bezierCurveTo(6, -5, 7, 2, 0, 7);
    var g = ctx.createRadialGradient(-2, -2, 0.5, 0, 0, 8);
    g.addColorStop(0, '#ff8a96');
    g.addColorStop(0.6, '#ee2f4a');
    g.addColorStop(1, '#b51630');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    [[-2, -1], [2, -1], [0, 2], [-3, 2.5], [3, 2.5], [0, -2.5]].forEach(function (p) {
      ctx.beginPath();
      ctx.ellipse(p[0], p[1], 0.5, 0.8, 0, 0, TAU);
      ctx.fill();
    });
    ctx.fillStyle = '#4fae4a';
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.lineTo(-4, -7);
    ctx.lineTo(-1.5, -5);
    ctx.lineTo(0, -8);
    ctx.lineTo(1.5, -5);
    ctx.lineTo(4, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function rosette(ctx, x, y, s, color, shade) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = shade;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0.4, 4.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.4, -0.4, 1.6, 2.2, 6.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-1.3, -1.7, 1.2, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.restore();
  }
  function berry(ctx, x, y, s, c1, c2) {
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * s, 0, TAU);
    var g = ctx.createRadialGradient(x - s, y - s, 0.3, x, y, 3.4 * s);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - 1 * s, y - 1.1 * s, 0.8 * s, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
  }
  function raspberry(ctx, x, y, s) {
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * TAU;
      berry(ctx, x + Math.cos(a) * 2.2 * s, y + Math.sin(a) * 1.6 * s, s * 0.55, '#ff6b8b', '#c2184b');
    }
    berry(ctx, x, y - 0.6 * s, s * 0.6, '#ff7b98', '#c81d50');
  }
  function leaf(ctx, x, y, s, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.quadraticCurveTo(0, -5, 6, 0);
    ctx.quadraticCurveTo(0, 5, -6, 0);
    ctx.fillStyle = '#5cc46a';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.strokeStyle = '#2f8a3f';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();
  }
  function aroundRim(cx, cy, rx, ry, n, offset) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = offset + (i / n) * TAU;
      out.push({ a: a, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, front: Math.sin(a) });
    }
    out.sort(function (p, q) { return p.y - q.y; });
    return out;
  }
  function keepSome(list, keep, seed) {
    if (keep >= 0.999) return list;
    var r = rngFrom(seed);
    return list.filter(function () { return r() < keep; });
  }

  /* ---------------------------------------------------------------
   * 케이크 종류별 그림
   *  g = { x, y, rx, ry, h, yTop }  st = { keep, t, seed }
   * ------------------------------------------------------------- */
  var KINDS = {};

  KINDS.pudding = {
    h: 58, extra: 26, topRatio: 0.72,
    palette: ['#ffd66e', '#f2b13c', '#9a4a17', '#fffaf0', '#e8384f'],
    interior: '#ffe7a6',
    silhouette: function (ctx, g) { silhouettePath(ctx, g.x, g.y, g.rx, g.ry, g.h, g.rx * 0.72); },
    draw: function (ctx, g, st) {
      var rxT = g.rx * 0.72, ryT = g.ry * 0.72;
      ctx.save();
      ctx.beginPath();
      sidePath(ctx, g.x, g.y, g.rx, g.ry, g.h, rxT);
      ctx.fillStyle = vgrad(ctx, g.yTop, g.y, ['#ffe797', '#ffd264', '#f0ad38']);
      ctx.fill();
      ctx.clip();
      shadeSide(ctx, g.x, g.rx, g.yTop, g.y + g.ry, 0.9);
      // 캐러멜 흘러내림
      var r = rngFrom(st.seed + 5);
      ctx.fillStyle = 'rgba(160,78,24,0.92)';
      ctx.beginPath();
      for (var i = 0; i < 9; i++) {
        var th = 0.1 * Math.PI + (i / 8) * 0.8 * Math.PI;
        dripPath(ctx, g.x + Math.cos(th) * rxT * 1.02, g.yTop + Math.sin(th) * ryT, 2.4 + r() * 2, 6 + r() * 14);
      }
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(g.x, g.yTop, rxT, ryT, 0, 0, TAU);
      var tg = ctx.createRadialGradient(g.x - rxT * 0.3, g.yTop - ryT * 0.3, 1, g.x, g.yTop, rxT);
      tg.addColorStop(0, '#d9873a');
      tg.addColorStop(0.6, '#a9541b');
      tg.addColorStop(1, '#7d3810');
      ctx.fillStyle = tg;
      ctx.fill();
      shine(ctx, g.x, g.yTop, rxT, ryT, 0.55);
      if (st.keep > 0.25) {
        // 휘핑크림 + 체리
        var cx = g.x + 2, cy = g.yTop - 2;
        for (var k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.ellipse(cx, cy - k * 5, 11 - k * 3, 5.5 - k * 1.3, 0, 0, TAU);
          ctx.fillStyle = k % 2 ? '#fffdf7' : '#fff6ea';
          ctx.fill();
          ctx.strokeStyle = 'rgba(200,170,150,0.55)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        if (st.keep > 0.55) {
          berry(ctx, cx + 1, cy - 17, 1.55, '#ff6b7a', '#c0122f');
          ctx.beginPath();
          ctx.moveTo(cx + 1, cy - 21);
          ctx.quadraticCurveTo(cx + 4, cy - 27, cx + 8, cy - 28);
          ctx.strokeStyle = '#5a7d2a';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }
  };

  KINDS.shortcake = {
    h: 66, extra: 16,
    palette: ['#fffdf8', '#ffe6a8', '#ff5a6e', '#f7f0e6', '#e83d55'],
    interior: '#ffe7a3',
    silhouette: function (ctx, g) { silhouettePath(ctx, g.x, g.y, g.rx, g.ry, g.h); },
    draw: function (ctx, g, st) {
      ctx.save();
      ctx.beginPath();
      sidePath(ctx, g.x, g.y, g.rx, g.ry, g.h);
      ctx.fillStyle = '#fffaf3';
      ctx.fill();
      ctx.clip();
      // 살짝 비치는 시트·딸기 층
      [[0.3, '#ffe9b5'], [0.36, '#ff8796'], [0.42, '#fffaf3'], [0.62, '#ffe9b5'], [0.68, '#ff8796'], [0.74, '#fffaf3']].forEach(function (b, i, arr) {
        var y1 = g.yTop + g.h * b[0];
        var y2 = g.yTop + g.h * (arr[i + 1] ? arr[i + 1][0] : 1);
        ctx.beginPath();
        bandPath(ctx, g.x, g.rx, g.ry, y1, y2);
        ctx.fillStyle = b[1];
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      shadeSide(ctx, g.x, g.rx, g.yTop, g.y + g.ry, 0.8);
      ctx.restore();
      // 밑단 짜기 장식
      for (var i = 0; i <= 14; i++) {
        var th = (i / 14) * Math.PI;
        rosette(ctx, g.x + Math.cos(th) * g.rx * 0.98, g.y + Math.sin(th) * g.ry - 2, 0.62, '#fffdf8', 'rgba(210,180,160,0.7)');
      }
      ctx.beginPath();
      ctx.ellipse(g.x, g.yTop, g.rx, g.ry, 0, 0, TAU);
      var tg = ctx.createRadialGradient(g.x - g.rx * 0.3, g.yTop - g.ry * 0.3, 2, g.x, g.yTop, g.rx);
      tg.addColorStop(0, '#ffffff');
      tg.addColorStop(1, '#f3e9df');
      ctx.fillStyle = tg;
      ctx.fill();
      var rim = keepSome(aroundRim(g.x, g.yTop, g.rx * 0.78, g.ry * 0.74, 10, 0.2), st.keep, st.seed);
      rim.forEach(function (p, i) {
        if (i % 2) rosette(ctx, p.x, p.y - 3, 1, '#fffdf8', 'rgba(210,180,160,0.8)');
        else strawberry(ctx, p.x, p.y - 4, 0.95, (p.x - g.x) * 0.01);
      });
      if (st.keep > 0.6) strawberry(ctx, g.x, g.yTop - 6, 1.35, 0);
    }
  };

  KINDS.choco = {
    h: 72, extra: 14,
    palette: ['#5a2e1c', '#3b1d12', '#2e140b', '#d4a537', '#c2185b'],
    interior: '#7a4428',
    silhouette: function (ctx, g) { silhouettePath(ctx, g.x, g.y, g.rx, g.ry, g.h); },
    draw: function (ctx, g, st) {
      cylinder(ctx, g.x, g.y, g.rx, g.ry, g.h, vgrad(ctx, g.yTop, g.y, ['#6e3a24', '#4b2416']), '#3a1a0e', 1.1);
      ctx.save();
      ctx.beginPath();
      sidePath(ctx, g.x, g.y, g.rx, g.ry, g.h);
      ctx.clip();
      drips(ctx, g.x, g.yTop, g.rx, g.ry, '#2b120a', st.seed + 11, g.h * 0.6, st.keep);
      // 드립 광택
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#fff';
      ctx.fillRect(g.x - g.rx * 0.62, g.yTop, 2.5, g.h * 0.25);
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(g.x, g.yTop, g.rx, g.ry, 0, 0, TAU);
      var tg = ctx.createRadialGradient(g.x - g.rx * 0.3, g.yTop - g.ry * 0.4, 1, g.x, g.yTop, g.rx);
      tg.addColorStop(0, '#6b3a22');
      tg.addColorStop(1, '#2a1209');
      ctx.fillStyle = tg;
      ctx.fill();
      shine(ctx, g.x, g.yTop, g.rx, g.ry, 0.35);
      var deco = keepSome(aroundRim(g.x, g.yTop, g.rx * 0.6, g.ry * 0.55, 7, 0.5), st.keep, st.seed + 3);
      deco.forEach(function (p, i) {
        if (i % 3 === 0) raspberry(ctx, p.x, p.y - 3, 1.1);
        else if (i % 3 === 1) {
          // 초코 컬
          ctx.save();
          ctx.translate(p.x, p.y - 3);
          ctx.rotate(0.6 + i);
          ctx.beginPath();
          roundRect(ctx, -7, -2.2, 14, 4.4, 2.2);
          ctx.fillStyle = '#7b4426';
          ctx.fill();
          ctx.strokeStyle = '#3b1b0e';
          ctx.lineWidth = 0.7;
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.moveTo(p.x - 4, p.y - 2);
          ctx.lineTo(p.x + 1, p.y - 6);
          ctx.lineTo(p.x + 5, p.y - 1);
          ctx.lineTo(p.x, p.y + 1);
          ctx.closePath();
          ctx.fillStyle = '#f3c84b';
          ctx.fill();
        }
      });
      if (st.keep > 0.5) {
        ctx.beginPath();
        ctx.moveTo(g.x - 5, g.yTop - 2);
        ctx.lineTo(g.x + 2, g.yTop - 8);
        ctx.lineTo(g.x + 7, g.yTop - 1);
        ctx.closePath();
        ctx.fillStyle = '#ffd95a';
        ctx.fill();
      }
    }
  };

  KINDS.mousse = {
    h: 52, extra: 10,
    palette: ['#ffd23f', '#fff3a0', '#e8a90c', '#d9b38c', '#7cc576'],
    interior: '#fff6c8',
    silhouette: function (ctx, g) {
      ctx.moveTo(g.x - g.rx, g.y - 6);
      ctx.ellipse(g.x, g.y - 6, g.rx, g.h - 6, 0, Math.PI, TAU, false);
      ctx.lineTo(g.x + g.rx, g.y);
      ctx.ellipse(g.x, g.y, g.rx, g.ry, 0, 0, Math.PI, false);
      ctx.closePath();
    },
    draw: function (ctx, g, st) {
      // 쿠키 받침
      cylinder(ctx, g.x, g.y, g.rx, g.ry, 7, '#d4a373', '#e5bb8a', 0.8);
      var base = g.y - 6;
      ctx.beginPath();
      ctx.moveTo(g.x - g.rx, base);
      ctx.ellipse(g.x, base, g.rx, g.h - 6, 0, Math.PI, TAU, false);
      ctx.ellipse(g.x, base, g.rx, g.ry, 0, 0, Math.PI, false);
      ctx.closePath();
      var dg = ctx.createRadialGradient(g.x - g.rx * 0.35, base - g.h * 0.6, 2, g.x, base - g.h * 0.2, g.rx * 1.15);
      dg.addColorStop(0, '#fffbd0');
      dg.addColorStop(0.35, '#ffe45c');
      dg.addColorStop(0.8, '#f5b914');
      dg.addColorStop(1, '#d8930a');
      ctx.fillStyle = dg;
      ctx.fill();
      // 거울 글레이즈 하이라이트
      ctx.beginPath();
      ctx.ellipse(g.x - g.rx * 0.18, base - g.h * 0.55, g.rx * 0.55, g.h * 0.33, -0.35, Math.PI * 1.1, Math.PI * 1.6);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
      if (st.keep > 0.3) {
        // 화이트 초콜릿 원판 + 민트
        ctx.save();
        ctx.translate(g.x + 4, base - g.h + 4);
        ctx.rotate(-0.25);
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 4, 0, 0, TAU);
        ctx.fillStyle = '#fffdf5';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,180,150,0.7)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
        if (st.keep > 0.6) {
          leaf(ctx, g.x - 6, base - g.h + 3, 0.9, -0.5);
          leaf(ctx, g.x + 1, base - g.h + 1, 0.8, 0.4);
        }
      }
      var r = rngFrom(st.seed + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (var i = 0; i < 8 * st.keep; i++) {
        ctx.beginPath();
        ctx.arc(g.x + (r() - 0.5) * g.rx * 1.2, base - g.h * (0.3 + r() * 0.4), 0.9, 0, TAU);
        ctx.fill();
      }
    }
  };

  KINDS.crepe = {
    h: 62, extra: 8,
    palette: ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#d7baff'],
    interior: '#ffe2b8',
    silhouette: function (ctx, g) { silhouettePath(ctx, g.x, g.y, g.rx, g.ry, g.h); },
    draw: function (ctx, g, st) {
      var cols = ['#ffb3ba', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff', '#ffc6ff'];
      ctx.save();
      ctx.beginPath();
      sidePath(ctx, g.x, g.y, g.rx, g.ry, g.h);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.clip();
      var n = 14;
      for (var i = 0; i < n; i++) {
        var y1 = g.yTop + (g.h * i) / n, y2 = g.yTop + (g.h * (i + 1)) / n;
        ctx.beginPath();
        bandPath(ctx, g.x, g.rx, g.ry, y1 + 0.8, y2);
        ctx.fillStyle = cols[i % cols.length];
        ctx.fill();
      }
      shadeSide(ctx, g.x, g.rx, g.yTop, g.y + g.ry, 0.8);
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(g.x, g.yTop, g.rx, g.ry, 0, 0, TAU);
      ctx.fillStyle = '#f7d9a8';
      ctx.fill();
      // 슈가파우더
      var r = rngFrom(st.seed + 7);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (var k = 0; k < 70 * st.keep; k++) {
        var a = r() * TAU, d = Math.sqrt(r());
        ctx.beginPath();
        ctx.arc(g.x + Math.cos(a) * d * g.rx * 0.95, g.yTop + Math.sin(a) * d * g.ry * 0.95, 0.9, 0, TAU);
        ctx.fill();
      }
      if (st.keep > 0.4) {
        // 하트 스텐실
        ctx.save();
        ctx.translate(g.x, g.yTop);
        ctx.scale(1, 0.5);
        ctx.beginPath();
        ctx.moveTo(0, 8);
        ctx.bezierCurveTo(-14, -2, -6, -14, 0, -6);
        ctx.bezierCurveTo(6, -14, 14, -2, 0, 8);
        ctx.fillStyle = '#e9b97a';
        ctx.fill();
        ctx.restore();
      }
      keepSome(aroundRim(g.x, g.yTop, g.rx * 0.7, g.ry * 0.62, 6, 0.9), st.keep, st.seed).forEach(function (p, i) {
        berry(ctx, p.x, p.y - 2, 1.05, i % 2 ? '#7aa7ff' : '#ff7aa2', i % 2 ? '#2c4fb5' : '#c2185b');
      });
    }
  };

  function tierGeom(g) {
    var hs = [0.38, 0.33, 0.29];
    var rs = [1, 0.74, 0.5];
    var out = [], y = g.y;
    for (var i = 0; i < 3; i++) {
      var h = g.h * hs[i];
      out.push({ y: y, rx: g.rx * rs[i], ry: g.ry * rs[i], h: h });
      y -= h;
    }
    return out;
  }
  KINDS.tiered = {
    h: 116, extra: 24,
    palette: ['#ffffff', '#ffd1dc', '#c8f0e0', '#ffe6a8', '#ff8fab'],
    interior: '#ffe7a3',
    silhouette: function (ctx, g) {
      var t = tierGeom(g);
      ctx.moveTo(g.x - t[0].rx, g.y);
      ctx.lineTo(g.x - t[0].rx, t[0].y - t[0].h);
      ctx.lineTo(g.x - t[1].rx, t[1].y);
      ctx.lineTo(g.x - t[1].rx, t[1].y - t[1].h);
      ctx.lineTo(g.x - t[2].rx, t[2].y);
      ctx.lineTo(g.x - t[2].rx, t[2].y - t[2].h);
      ctx.ellipse(g.x, t[2].y - t[2].h, t[2].rx, t[2].ry, 0, Math.PI, TAU, false);
      ctx.lineTo(g.x + t[2].rx, t[2].y);
      ctx.lineTo(g.x + t[1].rx, t[1].y - t[1].h);
      ctx.lineTo(g.x + t[1].rx, t[1].y);
      ctx.lineTo(g.x + t[0].rx, t[0].y - t[0].h);
      ctx.lineTo(g.x + t[0].rx, g.y);
      ctx.ellipse(g.x, g.y, t[0].rx, t[0].ry, 0, 0, Math.PI, false);
      ctx.closePath();
    },
    draw: function (ctx, g, st) {
      var t = tierGeom(g);
      var fills = [['#ffffff', '#f1e6e0'], ['#ffe0e8', '#f5c3d0'], ['#dff7ee', '#bfe6d6']];
      var ribbons = ['#ff9fb8', '#ffffff', '#ffb3c7'];
      for (var i = 0; i < 3; i++) {
        var T = t[i];
        cylinder(ctx, g.x, T.y, T.rx, T.ry, T.h, vgrad(ctx, T.y - T.h, T.y, fills[i]), fills[i][0], 0.7);
        // 리본 띠
        ctx.save();
        ctx.beginPath();
        sidePath(ctx, g.x, T.y, T.rx, T.ry, T.h);
        ctx.clip();
        ctx.beginPath();
        bandPath(ctx, g.x, T.rx, T.ry, T.y - T.h * 0.36, T.y - T.h * 0.2);
        ctx.fillStyle = ribbons[i];
        ctx.fill();
        shadeSide(ctx, g.x, T.rx, T.y - T.h, T.y + T.ry, 0.5);
        ctx.restore();
        // 진주 장식
        var np = 11 - i * 3;
        for (var k = 0; k <= np; k++) {
          var th = (k / np) * Math.PI;
          berry(ctx, g.x + Math.cos(th) * T.rx * 0.97, T.y + Math.sin(th) * T.ry - 1.5, 0.6, '#ffffff', '#e3d4d8');
        }
      }
      // 맨 위 분홍 드립
      var top = t[2];
      ctx.save();
      ctx.beginPath();
      sidePath(ctx, g.x, top.y, top.rx, top.ry, top.h);
      ctx.clip();
      drips(ctx, g.x, top.y - top.h, top.rx, top.ry, '#ff8fb0', st.seed + 4, top.h * 0.55, st.keep);
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(g.x, top.y - top.h, top.rx, top.ry, 0, 0, TAU);
      ctx.fillStyle = '#ff9dbb';
      ctx.fill();
      shine(ctx, g.x, top.y - top.h, top.rx, top.ry, 0.4);
      // 초
      var cand = keepSome([-0.55, -0.2, 0.15, 0.5].map(function (u) { return u; }), st.keep, st.seed + 9);
      var cc = ['#7cc6ff', '#ffd23f', '#ff8fbf', '#8fdcc5'];
      cand.forEach(function (u, i) {
        var cx = g.x + u * top.rx, cy = top.y - top.h + Math.abs(u) * 2 - 1;
        ctx.fillStyle = cc[i % 4];
        ctx.fillRect(cx - 1.8, cy - 16, 3.6, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (var s = 0; s < 3; s++) ctx.fillRect(cx - 1.8, cy - 14 + s * 5, 3.6, 1.4);
        var fl = 1 + Math.sin(st.t * 14 + i * 2) * 0.12;
        ctx.save();
        ctx.translate(cx, cy - 18);
        ctx.scale(1, fl);
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.quadraticCurveTo(3.4, -1, 0, 2);
        ctx.quadraticCurveTo(-3.4, -1, 0, -6);
        var fg = ctx.createRadialGradient(0, 0, 0.3, 0, -1, 5);
        fg.addColorStop(0, '#fffbe0');
        fg.addColorStop(0.5, '#ffd34d');
        fg.addColorStop(1, '#ff8a1f');
        ctx.fillStyle = fg;
        ctx.fill();
        ctx.restore();
      });
    }
  };

  var MAC = [['#ffb3c7', '#ff8fb0'], ['#b8f0d8', '#85d9b6'], ['#d6c4ff', '#b29cf0'], ['#fff0a6', '#f2d76a'], ['#ffcfa8', '#f5a873']];
  function macaron(ctx, x, y, s, ci) {
    var c = MAC[ci % MAC.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    roundRect(ctx, -6, -1.2, 12, 4.4, 2.2);
    ctx.fillStyle = c[1];
    ctx.fill();
    ctx.beginPath();
    roundRect(ctx, -5.6, -0.4, 11.2, 1.6, 0.8);
    ctx.fillStyle = '#fffaf2';
    ctx.fill();
    ctx.beginPath();
    roundRect(ctx, -6, -5, 12, 4.6, 2.3);
    ctx.fillStyle = c[0];
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-2, -3.6, 2.4, 0.9, 0, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.restore();
  }
  KINDS.macaron = {
    h: 104, extra: 14,
    palette: ['#ffb3c7', '#b8f0d8', '#d6c4ff', '#fff0a6', '#ffcfa8'],
    interior: '#fff3e6',
    silhouette: function (ctx, g) {
      ctx.moveTo(g.x - g.rx, g.y);
      ctx.lineTo(g.x - g.rx * 0.22, g.yTop);
      ctx.lineTo(g.x + g.rx * 0.22, g.yTop);
      ctx.lineTo(g.x + g.rx, g.y);
      ctx.ellipse(g.x, g.y, g.rx, g.ry, 0, 0, Math.PI, false);
      ctx.closePath();
    },
    draw: function (ctx, g, st) {
      // 원뿔 받침(크림)
      ctx.beginPath();
      ctx.moveTo(g.x - g.rx * 0.85, g.y);
      ctx.lineTo(g.x - g.rx * 0.15, g.yTop + 6);
      ctx.lineTo(g.x + g.rx * 0.15, g.yTop + 6);
      ctx.lineTo(g.x + g.rx * 0.85, g.y);
      ctx.closePath();
      ctx.fillStyle = '#fff1e8';
      ctx.fill();
      var rows = 8;
      var r = rngFrom(st.seed + 21);
      var idx = 0;
      for (var row = 0; row < rows; row++) {
        var f = row / rows;
        var rr = g.rx * (1 - f * 0.8);
        var cy = g.y - 4 - (g.h - 10) * f;
        var n = Math.max(3, Math.round(10 * (1 - f * 0.75)));
        var ring = aroundRim(g.x, cy, rr * 0.9, rr * PERSP * 0.9, n, row * 0.4);
        for (var i = 0; i < ring.length; i++) {
          var p = ring[i];
          idx++;
          var gone = r() > st.keep + 0.15; // 손상될수록 빠진 마카롱
          if (gone) continue;
          var sc = (0.95 - f * 0.25) * (0.88 + p.front * 0.12);
          macaron(ctx, p.x, p.y, sc, idx);
        }
      }
      if (st.keep > 0.5) {
        // 리본
        var tx = g.x, ty = g.yTop + 2;
        ctx.fillStyle = '#ff6f9c';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx - 12, ty - 10, tx - 11, ty + 2);
        ctx.closePath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx + 12, ty - 10, tx + 11, ty + 2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tx, ty, 2.6, 0, TAU);
        ctx.fillStyle = '#ff4f86';
        ctx.fill();
      }
    }
  };

  KINDS.cheesecake = {
    h: 58, extra: 10,
    palette: ['#fbe9c6', '#e2b56b', '#b98048', '#8e1b4a', '#3b3b8f'],
    interior: '#fff1d6',
    silhouette: function (ctx, g) { silhouettePath(ctx, g.x, g.y, g.rx, g.ry, g.h); },
    draw: function (ctx, g, st) {
      ctx.save();
      ctx.beginPath();
      sidePath(ctx, g.x, g.y, g.rx, g.ry, g.h);
      ctx.fillStyle = vgrad(ctx, g.yTop, g.y, ['#f7dca7', '#fdf0d4', '#fbe6bf']);
      ctx.fill();
      ctx.clip();
      ctx.beginPath();
      bandPath(ctx, g.x, g.rx, g.ry, g.y - g.h * 0.2, g.y + 2);
      ctx.fillStyle = '#c08a52';
      ctx.fill();
      var r = rngFrom(st.seed + 13);
      ctx.fillStyle = 'rgba(110,60,25,0.45)';
      for (var i = 0; i < 40; i++) {
        var u = r() * 2 - 1;
        ctx.beginPath();
        ctx.arc(g.x + u * g.rx, g.y - g.h * 0.18 + Math.sqrt(1 - u * u) * g.ry + r() * g.h * 0.16, 0.9, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      bandPath(ctx, g.x, g.rx, g.ry, g.yTop, g.yTop + 5);
      ctx.fillStyle = '#e0ad5c';
      ctx.fill();
      shadeSide(ctx, g.x, g.rx, g.yTop, g.y + g.ry, 0.8);
      // 베리 소스 흘러내림
      drips(ctx, g.x, g.yTop, g.rx * 0.98, g.ry, '#9c1f52', st.seed + 3, g.h * 0.42, st.keep);
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(g.x, g.yTop, g.rx, g.ry, 0, 0, TAU);
      var tg = ctx.createRadialGradient(g.x - g.rx * 0.3, g.yTop - g.ry * 0.3, 1, g.x, g.yTop, g.rx);
      tg.addColorStop(0, '#d23a74');
      tg.addColorStop(0.7, '#99194d');
      tg.addColorStop(1, '#6e0f37');
      ctx.fillStyle = tg;
      ctx.fill();
      shine(ctx, g.x, g.yTop, g.rx, g.ry, 0.5);
      keepSome(aroundRim(g.x, g.yTop, g.rx * 0.62, g.ry * 0.55, 9, 0.3), st.keep, st.seed + 5).forEach(function (p, i) {
        if (i % 3 === 0) raspberry(ctx, p.x, p.y - 2, 0.95);
        else berry(ctx, p.x, p.y - 2, 1.05, '#7f8cff', '#262c80');
      });
      if (st.keep > 0.55) leaf(ctx, g.x + 3, g.yTop - 3, 1.1, -0.4);
    }
  };

  KINDS.crown = {
    h: 34, extra: 40,
    palette: ['#e9b872', '#3a1a10', '#ffd34d', '#c81d3a', '#5b2a17'],
    interior: '#4a2414',
    silhouette: function (ctx, g) {
      silhouettePath(ctx, g.x, g.y, g.rx, g.ry, g.h);
      // 왕관 영역도 포함
      ctx.moveTo(g.x - 16, g.yTop + 2);
      ctx.lineTo(g.x - 16, g.yTop - 30);
      ctx.lineTo(g.x + 16, g.yTop - 30);
      ctx.lineTo(g.x + 16, g.yTop + 2);
      ctx.closePath();
    },
    draw: function (ctx, g, st) {
      // 주름진 타르트 껍질
      ctx.save();
      ctx.beginPath();
      sidePath(ctx, g.x, g.y, g.rx, g.ry, g.h);
      ctx.fillStyle = vgrad(ctx, g.yTop, g.y, ['#f4cd8d', '#d99a4e']);
      ctx.fill();
      ctx.clip();
      for (var i = 0; i < 26; i++) {
        var u = -1 + (i + 0.5) / 13;
        if (u > 1) break;
        var x = g.x + u * g.rx;
        ctx.fillStyle = i % 2 ? 'rgba(150,90,30,0.25)' : 'rgba(255,240,200,0.25)';
        ctx.fillRect(x - g.rx / 26, g.yTop - 5, g.rx / 13, g.h + g.ry + 10);
      }
      shadeSide(ctx, g.x, g.rx, g.yTop, g.y + g.ry, 1);
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(g.x, g.yTop, g.rx, g.ry, 0, 0, TAU);
      ctx.fillStyle = '#efc07a';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(g.x, g.yTop + 1, g.rx * 0.88, g.ry * 0.84, 0, 0, TAU);
      var tg = ctx.createRadialGradient(g.x - g.rx * 0.3, g.yTop - g.ry * 0.3, 1, g.x, g.yTop, g.rx);
      tg.addColorStop(0, '#6a341d');
      tg.addColorStop(1, '#25100a');
      ctx.fillStyle = tg;
      ctx.fill();
      shine(ctx, g.x, g.yTop, g.rx * 0.88, g.ry * 0.84, 0.3);
      // 금가루
      var r = rngFrom(st.seed + 31);
      ctx.fillStyle = '#ffd34d';
      for (var k = 0; k < 18; k++) {
        var a = r() * TAU, d = Math.sqrt(r()) * 0.8;
        ctx.fillRect(g.x + Math.cos(a) * d * g.rx, g.yTop + Math.sin(a) * d * g.ry, 1.4, 1.4);
      }
      keepSome(aroundRim(g.x, g.yTop, g.rx * 0.68, g.ry * 0.6, 8, 0.1), st.keep, st.seed + 2).forEach(function (p) {
        if (p.front < 0.2 || p.front > -0.2) raspberry(ctx, p.x, p.y - 2, 0.95);
      });
      if (st.keep > 0.35) {
        // 금빛 왕관
        var cx = g.x, cy = g.yTop - 2;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy);
        ctx.lineTo(cx - 15, cy - 20);
        ctx.lineTo(cx - 7, cy - 11);
        ctx.lineTo(cx, cy - 25);
        ctx.lineTo(cx + 7, cy - 11);
        ctx.lineTo(cx + 15, cy - 20);
        ctx.lineTo(cx + 14, cy);
        ctx.closePath();
        var cg = ctx.createLinearGradient(cx - 14, cy - 25, cx + 14, cy);
        cg.addColorStop(0, '#fff3b0');
        cg.addColorStop(0.5, '#ffcf3a');
        cg.addColorStop(1, '#c98a0c');
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.strokeStyle = '#a66f08';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        berry(ctx, cx, cy - 6, 0.85, '#ff6b8b', '#b0102f');
        berry(ctx, cx - 8, cy - 5, 0.6, '#7cc6ff', '#1f5fb0');
        berry(ctx, cx + 8, cy - 5, 0.6, '#8fe8a0', '#1f8a3a');
        [[-15, -21], [0, -26], [15, -21]].forEach(function (p) {
          berry(ctx, cx + p[0], cy + p[1], 0.55, '#ffffff', '#e6c26a');
        });
        ctx.restore();
      }
    }
  };

  /* ---------------------------------------------------------------
   * 케이크 그리기 (+ 손상 표현)
   * ------------------------------------------------------------- */
  function cakeGeom(cake, t) {
    var K = KINDS[cake.kind];
    var dmg = cake.maxHp ? 1 - cake.hp / cake.maxHp : 0;
    var squash = 1 - 0.3 * Math.pow(dmg, 1.15);
    var rx = cake.r * (1 + 0.07 * dmg);
    var h = K.h * squash;
    return { x: cake.x, y: cake.y, rx: rx, ry: rx * PERSP, h: h, yTop: cake.y - h, dmg: dmg };
  }

  /** 아이템이 놓일 수 없는(케이크가 가리는) 영역과 조준 영역 계산용 */
  function cakeBounds(cake) {
    var K = KINDS[cake.kind];
    var full = K.h + K.extra;
    return {
      top: cake.y - full,
      bodyTop: cake.y - K.h,
      left: cake.x - cake.r,
      right: cake.x + cake.r,
      ry: cake.r * PERSP
    };
  }

  function drawPlate(ctx, cake) {
    var rx = cake.r + 11, ry = rx * PERSP;
    ctx.beginPath();
    ctx.ellipse(cake.x + 2, cake.y + 5, rx + 3, ry + 3, 0, 0, TAU);
    ctx.fillStyle = 'rgba(120,70,60,0.16)';
    ctx.fill();
    // 레이스 도일리
    ctx.fillStyle = '#ffffff';
    var n = 26;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      ctx.beginPath();
      ctx.ellipse(cake.x + Math.cos(a) * rx, cake.y + Math.sin(a) * ry, 5.2, 5.2 * PERSP * 1.4, 0, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(cake.x, cake.y, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(232,210,200,0.85)';
    for (var k = 0; k < n; k++) {
      var b = (k / n) * TAU + 0.12;
      ctx.beginPath();
      ctx.ellipse(cake.x + Math.cos(b) * (rx - 4), cake.y + Math.sin(b) * (ry - 2), 1.3, 0.8, 0, 0, TAU);
      ctx.fill();
    }
  }

  function crackPoint(g, u, v) {
    u = Math.max(-0.98, Math.min(0.98, u));
    return [g.x + u * g.rx, g.yTop + g.ry * Math.sqrt(1 - u * u) + v * g.h];
  }

  function drawDamage(ctx, cake, g, K) {
    if (g.dmg <= 0.001) return;
    ctx.save();
    ctx.beginPath();
    K.silhouette(ctx, g);
    ctx.clip();
    // 속살이 드러난 부서진 부분
    (cake.bites || []).forEach(function (b) {
      if (g.dmg < b.at) return;
      var grow = Math.min(1, (g.dmg - b.at) / 0.25 + 0.4);
      var c = crackPoint(g, b.u, 0);
      var rs = b.size * grow;
      ctx.beginPath();
      for (var i = 0; i < b.jag.length; i++) {
        var a = (i / b.jag.length) * TAU;
        var rr = rs * b.jag[i];
        ctx[i ? 'lineTo' : 'moveTo'](c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr * 0.8 - rs * 0.1);
      }
      ctx.closePath();
      ctx.fillStyle = K.interior;
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,50,30,0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,70,40,0.35)';
      for (var j = 0; j < 6; j++) {
        ctx.beginPath();
        ctx.arc(c[0] + (b.jag[j] - 1) * rs * 2.2, c[1] + (b.jag[(j + 3) % b.jag.length] - 0.9) * rs, 1.1, 0, TAU);
        ctx.fill();
      }
    });
    // 금
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    (cake.cracks || []).forEach(function (cr) {
      ctx.beginPath();
      cr.pts.forEach(function (p, i) {
        var q = crackPoint(g, p[0], p[1]);
        ctx[i ? 'lineTo' : 'moveTo'](q[0], q[1]);
      });
      ctx.strokeStyle = 'rgba(60,25,15,0.62)';
      ctx.lineWidth = cr.w;
      ctx.stroke();
      ctx.beginPath();
      cr.pts.forEach(function (p, i) {
        var q = crackPoint(g, p[0], p[1]);
        ctx[i ? 'lineTo' : 'moveTo'](q[0] + 0.9, q[1] + 0.4);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    });
    // 윗면 움푹
    if (g.dmg > 0.15) {
      var s = Math.min(1, g.dmg * 1.3);
      ctx.beginPath();
      ctx.ellipse(g.x + cake.dentU * g.rx * 0.3, g.yTop + 1, g.rx * 0.32 * s, g.ry * 0.3 * s, 0, 0, TAU);
      ctx.fillStyle = 'rgba(70,35,20,0.22)';
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 케이크 한 개 그리기
   * cake: { kind, x, y, r, hp, maxHp, alive, cracks, bites, seed, hitT, wob }
   */
  function drawCake(ctx, cake, t, opts) {
    var K = KINDS[cake.kind];
    opts = opts || {};
    if (!opts.noPlate) drawPlate(ctx, cake);
    if (!cake.alive) {
      drawRubble(ctx, cake);
      return;
    }
    var g = cakeGeom(cake, t);
    ctx.save();
    // 충돌 순간 찌그러짐(스쿼시)과 말랑한 케이크의 출렁임
    var a = cake.hitT > 0 ? Math.exp(-cake.hitT * 7) * Math.cos(cake.hitT * 22) : 0;
    var sy = 1 - 0.24 * a, sx = 1 + 0.13 * a;
    var wob = (cake.wob || 0) * Math.sin(t * 9 + cake.seed);
    var lean = g.dmg > 0.55 ? ((g.dmg - 0.55) / 0.45) * 0.13 * (cake.seed % 2 ? 1 : -1) : 0;
    ctx.translate(g.x, g.y);
    ctx.transform(sx, 0, wob + lean, sy, 0, 0);
    ctx.translate(-g.x, -g.y);
    K.draw(ctx, g, { keep: Math.max(0, 1 - g.dmg * 1.15), t: t, seed: cake.seed });
    drawDamage(ctx, cake, g, K);
    if (opts.highlight) {
      ctx.save();
      ctx.beginPath();
      K.silhouette(ctx, g);
      ctx.lineWidth = 3;
      ctx.strokeStyle = opts.highlight;
      ctx.shadowColor = opts.highlight;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawRubble(ctx, cake) {
    var K = KINDS[cake.kind];
    var r = rngFrom(cake.seed * 7 + 3);
    var pal = K.palette;
    var rx = cake.r * 0.95, ry = rx * PERSP;
    ctx.beginPath();
    ctx.ellipse(cake.x, cake.y, rx * 0.95, ry * 0.95, 0, 0, TAU);
    ctx.fillStyle = 'rgba(90,50,30,0.15)';
    ctx.fill();
    var blobs = [];
    for (var i = 0; i < 22; i++) {
      var a = r() * TAU, d = Math.sqrt(r()) * 0.85;
      blobs.push({ x: cake.x + Math.cos(a) * d * rx, y: cake.y + Math.sin(a) * d * ry - (1 - d) * 7, s: 4 + r() * 7, c: pal[Math.floor(r() * pal.length)], j: r() });
    }
    blobs.sort(function (p, q) { return p.y - q.y; });
    blobs.forEach(function (b) {
      ctx.beginPath();
      for (var k = 0; k < 7; k++) {
        var a = (k / 7) * TAU + b.j;
        var rr = b.s * (0.7 + ((k * 37 + Math.floor(b.j * 100)) % 10) / 25);
        ctx[k ? 'lineTo' : 'moveTo'](b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr * 0.7);
      }
      ctx.closePath();
      ctx.fillStyle = b.c;
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,40,25,0.25)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });
  }

  /** 도감 썸네일 */
  function drawThumb(canvas, kind, locked, px) {
    px = px || 2;
    var w = 120, h = 110;
    canvas.width = w * px;
    canvas.height = h * px;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(px, px);
    var K = KINDS[kind];
    var r = kind === 'tiered' ? 40 : kind === 'macaron' ? 36 : 42;
    var fake = { kind: kind, x: w / 2, y: h - 22, r: r, hp: 1, maxHp: 1, alive: true, cracks: [], bites: [], seed: 7, hitT: 0, dentU: 0 };
    var scale = Math.min(1, (h - 30) / (K.h + K.extra));
    ctx.save();
    ctx.translate(w / 2, h - 22);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -(h - 22));
    drawCake(ctx, fake, 0.6);
    ctx.restore();
    if (locked) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#c9b8b4';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '28px ' + FONT;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('?', w / 2, h / 2 + 6);
    }
  }

  root.MKArt = {
    W: W,
    H: H,
    TAU: TAU,
    PERSP: PERSP,
    TRAY: TRAY,
    FLOOR: FLOOR,
    ITEM_R: ITEM_R,
    IS: IS,
    FONT: FONT,
    VARIANTS: VARIANTS,
    KINDS: KINDS,
    rngFrom: rngFrom,
    roundRect: roundRect,
    starPath: starPath,
    setPixelScale: setPixelScale,
    drawItem: drawItem,
    drawItemShadow: drawItemShadow,
    drawGlint: drawGlint,
    drawBackground: drawBackground,
    drawCake: drawCake,
    drawPlate: drawPlate,
    drawRubble: drawRubble,
    cakeBounds: cakeBounds,
    cakeGeom: cakeGeom,
    drawThumb: drawThumb
  };
})(window);
