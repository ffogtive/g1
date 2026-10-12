/*
 * 모아쿵! — 효과음 (WebAudio 합성, 외부 파일 없음)
 * 가설: 재질별로 다른 "틱" 소리를 짧게 겹치면 차르륵 쓸어 담는 촉감이 산다.
 */
(function (root) {
  'use strict';

  var ctx = null, master = null, enabled = true;
  var lastTick = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      return null;
    }
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  }

  function ok() {
    return enabled && ctx && master;
  }

  function tone(freq, type, dur, vol, freqEnd, delay) {
    if (!ok()) return;
    var t0 = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  var noiseBuf = null;
  function noise(dur, vol, filterType, freq, q, delay, freqEnd) {
    if (!ok()) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t0 = ctx.currentTime + (delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(freq || 1000, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q || 0.7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  function rnd(a, b) {
    return a + Math.random() * (b - a);
  }

  /* 재질별 짧은 소리 */
  function matSound(kind, vol, delay) {
    vol = vol || 1;
    switch (kind) {
      case 'metal':
        tone(rnd(2400, 3300), 'sine', 0.07, 0.10 * vol, null, delay);
        tone(rnd(4200, 5200), 'sine', 0.04, 0.045 * vol, null, delay);
        break;
      case 'jelly':
        tone(rnd(380, 460), 'sine', 0.09, 0.16 * vol, 180, delay);
        break;
      case 'glass':
        tone(rnd(1700, 2100), 'triangle', 0.11, 0.07 * vol, null, delay);
        tone(rnd(2900, 3300), 'sine', 0.08, 0.035 * vol, null, delay);
        break;
      case 'click':
        noise(0.035, 0.22 * vol, 'bandpass', rnd(1800, 2600), 4, delay);
        break;
      case 'chime':
        tone(rnd(2100, 2500), 'sine', 0.14, 0.06 * vol, null, delay);
        tone(rnd(3200, 3600), 'sine', 0.1, 0.03 * vol, null, delay);
        break;
    }
  }

  var api = {
    unlock: function () {
      ensure();
    },
    setEnabled: function (on) {
      enabled = !!on;
      if (enabled) ensure();
    },
    isEnabled: function () {
      return enabled;
    },
    /** 쓸어 담을 때 (빠르게 여러 개면 살짝 시간차를 둬서 차르륵) */
    gather: function (kind) {
      if (!ok()) return;
      var now = ctx.currentTime;
      var at = Math.max(0, lastTick + 0.022 - now);
      lastTick = now + at;
      if (at > 0.25) return; // 너무 많이 밀리면 생략
      matSound(kind, 1, at);
    },
    putDown: function (n) {
      for (var i = 0; i < Math.min(n, 10); i++) {
        matSound(['metal', 'click', 'jelly', 'glass'][i % 4], 0.6, i * 0.03);
      }
      noise(0.25, 0.05, 'highpass', 3000, 0.7);
    },
    lift: function () {
      noise(0.42, 0.07, 'bandpass', 380, 2.5, 0, 1800);
      tone(220, 'triangle', 0.42, 0.04, 520);
    },
    fall: function () {
      tone(980, 'sine', 0.22, 0.05, 260);
      noise(0.2, 0.06, 'bandpass', 1600, 1.5, 0, 500);
    },
    impact: function (n, broke) {
      var p = Math.min(1, 0.35 + n / 50);
      tone(120, 'sine', 0.45, 0.9 * p, 38);
      tone(70, 'sine', 0.55, 0.6 * p, 30, 0.01);
      noise(0.3, 0.5 * p, 'lowpass', 900, 0.8, 0, 200);
      noise(0.08, 0.25 * p, 'bandpass', 2500, 1.2);
      if (!broke) {
        // 금 가는 소리
        for (var i = 0; i < 4; i++) noise(0.025, 0.18, 'bandpass', rnd(2800, 4200), 2, 0.04 + i * rnd(0.02, 0.05));
      }
    },
    crumble: function () {
      noise(0.75, 0.32, 'lowpass', 1400, 0.7, 0.03, 250);
      for (var i = 0; i < 6; i++) tone(rnd(140, 220), 'sine', 0.16, 0.25, 70, 0.05 + i * rnd(0.05, 0.09));
      for (var j = 0; j < 5; j++) matSound('chime', 0.5, 0.2 + j * 0.07);
    },
    land: function (kind) {
      if (!ok()) return;
      if (Math.random() < 0.45) matSound(kind, 0.5, rnd(0, 0.02));
    },
    lost: function () {
      tone(rnd(330, 380), 'triangle', 0.13, 0.08, 140);
      noise(0.05, 0.06, 'bandpass', 1200, 2, 0.02);
    },
    win: function () {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) {
        tone(f, 'triangle', 0.32, 0.12, null, i * 0.11);
        tone(f * 2, 'sine', 0.2, 0.03, null, i * 0.11);
      });
    },
    fail: function () {
      [523, 440, 349, 294].forEach(function (f, i) {
        tone(f, 'triangle', 0.32, 0.1, f * 0.97, i * 0.16);
      });
    },
    ui: function () {
      tone(880, 'sine', 0.06, 0.06, 1100);
    },
    deny: function () {
      tone(240, 'square', 0.08, 0.03, 200);
    }
  };

  root.MKAudio = api;
})(window);
