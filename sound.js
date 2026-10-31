/* Laagri Karts — all sound is synthesized with Web Audio (no audio files). */
(function (root) {
  "use strict";
  var ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null, listeners = [], musicOn = false;

  function ensure() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.16; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function ok() { return ctx && ctx.state === "running"; }
  function env(gn, t, a, peak, d) { gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(peak, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function tone(t, f0, f1, dur, vol, type, bus) {
    var o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type || "square"; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(gn, t, 0.008, vol, dur); o.connect(gn); gn.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, f0, f1, vol, type) {
    var s = ctx.createBufferSource(); s.buffer = noiseBuf;
    var fl = ctx.createBiquadFilter(); fl.type = type || "bandpass"; fl.Q.value = 0.9;
    fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    var gn = ctx.createGain(); env(gn, t, 0.01, vol, dur);
    s.connect(fl); fl.connect(gn); gn.connect(sfxBus); s.start(t); s.stop(t + dur + 0.05);
  }

  var last = {};
  var SFX = {
    beep: function (t) { tone(t, 660, 660, 0.18, 0.25, "square"); },
    go: function (t) { tone(t, 990, 990, 0.45, 0.28, "square"); tone(t, 1320, 1320, 0.45, 0.12, "triangle"); },
    start: function (t) { [523, 659, 784].forEach(function (f, i) { tone(t + i * 0.09, f, f, 0.16, 0.16, "triangle"); }); },
    join: function (t) { tone(t, 700, 1050, 0.12, 0.15, "triangle"); },
    pickup: function (t) { [880, 1175, 1568].forEach(function (f, i) { tone(t + i * 0.05, f, f, 0.08, 0.13, "square"); }); },
    turbo: function (t) { noise(t, 0.6, 400, 3000, 0.4, "bandpass"); tone(t, 180, 520, 0.5, 0.12, "sawtooth"); },
    mega: function (t) { noise(t, 1.0, 300, 4000, 0.45, "bandpass"); tone(t, 140, 700, 0.9, 0.14, "sawtooth"); },
    jump: function (t) { tone(t, 220, 660, 0.3, 0.13, "triangle"); noise(t, 0.25, 800, 2000, 0.15); },
    pad: function (t) { tone(t, 400, 900, 0.25, 0.1, "sawtooth"); },
    rocket: function (t) { noise(t, 0.5, 2500, 600, 0.35, "bandpass"); },
    boom: function (t) { noise(t, 0.55, 900, 60, 0.6, "lowpass"); tone(t, 120, 40, 0.4, 0.3, "sine"); },
    slip: function (t) { tone(t, 900, 200, 0.5, 0.14, "sine"); noise(t, 0.4, 1500, 500, 0.2); },
    oil: function (t) { tone(t, 300, 120, 0.25, 0.15, "sine"); },
    shield: function (t) { tone(t, 500, 1500, 0.35, 0.12, "sine"); tone(t + 0.05, 750, 2000, 0.3, 0.08, "triangle"); },
    shieldpop: function (t) { tone(t, 1500, 300, 0.25, 0.14, "triangle"); },
    bump: function (t) { noise(t, 0.12, 500, 150, 0.35, "lowpass"); },
    out: function (t) { tone(t, 520, 130, 0.55, 0.2, "sawtooth"); noise(t + 0.1, 0.4, 700, 80, 0.4, "lowpass"); },
    heatwin: function (t) { [523, 659, 784, 1047].forEach(function (f, i) { tone(t + i * 0.1, f, f, 0.22, 0.17, "square"); }); },
    final: function (t) { tone(t, 440, 440, 0.25, 0.2, "square"); tone(t + 0.3, 440, 440, 0.25, 0.2, "square"); tone(t + 0.6, 660, 660, 0.5, 0.2, "square"); },
    champion: function (t) { [523, 659, 784, 659, 784, 1047].forEach(function (f, i) { tone(t + i * 0.13, f, f, 0.3, 0.17, "square"); tone(t + i * 0.13, f / 2, f / 2, 0.3, 0.08, "triangle"); }); }
  };

  // tiny looping chiptune: bass + arpeggio, 132 bpm
  var musicTimer = null, step = 0, nextT = 0;
  var BASS = [45, 45, 52, 45, 48, 48, 55, 48, 43, 43, 50, 43, 40, 40, 47, 52];
  var ARP = [[69, 72, 76], [72, 76, 79], [67, 71, 74], [64, 67, 71]];
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function schedule() {
    if (!ok() || !musicOn) return;
    var spb = 60 / 132 / 2;
    while (nextT < ctx.currentTime + 0.2) {
      var b = BASS[step % 16];
      tone(nextT, mtof(b), mtof(b), spb * 0.9, 0.5, "triangle", musicBus);
      var ch = ARP[Math.floor(step / 4) % 4];
      tone(nextT, mtof(ch[step % 3] + 12), mtof(ch[step % 3] + 12), spb * 0.5, 0.18, "square", musicBus);
      if (step % 4 === 0) { var s = ctx.createBufferSource(); s.buffer = noiseBuf; var fl = ctx.createBiquadFilter(); fl.type = "highpass"; fl.frequency.value = 6000; var gn = ctx.createGain(); env(gn, nextT, 0.002, 0.25, 0.05); s.connect(fl); fl.connect(gn); gn.connect(musicBus); s.start(nextT); s.stop(nextT + 0.08); }
      nextT += spb; step++;
    }
  }

  root.LKSound = {
    start: function () {
      var c = ensure(); if (!c) return Promise.resolve(false);
      var p = c.state !== "running" ? c.resume() : Promise.resolve();
      return Promise.race([p, new Promise(function (r) { setTimeout(r, 300); })]).then(function () {
        var on = c.state === "running";
        if (on && !musicOn) { musicOn = true; nextT = c.currentTime + 0.1; musicTimer = setInterval(schedule, 60); }
        listeners.forEach(function (f) { f(on); });
        return on;
      }).catch(function () { return false; });
    },
    onState: function (f) { listeners.push(f); },
    play: function (name) {
      if (!ok() || !SFX[name]) return;
      var now = ctx.currentTime;
      if (last[name] && now - last[name] < 0.06) return;
      last[name] = now;
      SFX[name](now + 0.005);
    },
    music: function (on) { if (musicBus) musicBus.gain.value = on ? 0.16 : 0; }
  };
})(window);
