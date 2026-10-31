/* Laagri Karts — phone controller (AirConsole controller.html) */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var ac = new AirConsole({ orientation: AirConsole.ORIENTATION_LANDSCAPE, translation: false });
  var views = { wait: $("vWait"), full: $("vFull"), lobby: $("vLobby"), race: $("vRace") };
  var st = { view: "wait", vote: -1, ready: false, last: null, inp: { l: 0, r: 0, b: 0 }, item: null };

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].classList.toggle("hidden", k !== name); });
    if (name !== "race") releaseAll();
    st.view = name;
  }
  function buzz(ms) {
    try { if (ac.vibrate) { ac.vibrate(Math.min(ms, 600)); return; } } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }
  function setMe(d) {
    document.documentElement.style.setProperty("--me", d.color || "#3d8bff");
    document.documentElement.style.setProperty("--medark", d.dark || "#1f56b3");
  }
  function press(el) {
    // touchstart+pointerdown both fire on phones; use pointer events only
    return function (fn) { el.addEventListener("pointerdown", function (e) { e.preventDefault(); fn(e); }); };
  }

  // ---------------------------------------------------------------- lobby
  var tracksEl = $("tracks");
  LK.TRACKS.forEach(function (t, i) {
    var el = document.createElement("div");
    el.className = "trk";
    el.innerHTML = '<div class="check">✓</div><div class="sw" style="background:' + t.color + '"></div><div class="tt"><div class="tn">' + t.name + '</div><div class="td">' + t.short + '</div></div><div class="cnt">0</div>';
    el.addEventListener("click", function () { st.vote = i; ac.message(AirConsole.SCREEN, { t: "vote", track: i }); renderTracks(); buzz(15); });
    tracksEl.appendChild(el);
  });
  function renderTracks() {
    var d = st.last || {};
    for (var i = 0; i < tracksEl.children.length; i++) {
      var c = tracksEl.children[i];
      c.classList.toggle("mine", i === st.vote);
      c.style.borderColor = i === st.vote ? LK.TRACKS[i].color : "transparent";
      c.querySelector(".cnt").textContent = (d.counts && d.counts[i]) || 0;
      var tag = c.querySelector(".tag");
      if (i === d.next) { if (!tag) { tag = document.createElement("div"); tag.className = "tag"; tag.textContent = "NEXT"; c.appendChild(tag); } }
      else if (tag) tag.remove();
    }
  }
  function seg(el, labels, cur, key) {
    el.innerHTML = "";
    labels.forEach(function (lb, i) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = lb; if (i === cur) b.className = "on";
      b.addEventListener("click", function () { var m = { t: "set" }; m[key] = i; ac.message(AirConsole.SCREEN, m); buzz(12); });
      el.appendChild(b);
    });
  }
  var readyBtn = $("readyBtn");
  function showLobby(d) {
    setMe(d);
    $("lCar").innerHTML = LK.carSvg(d.color, d.dark);
    $("lName").textContent = d.name + (d.host ? " · host" : "");
    if (typeof d.vote === "number") st.vote = d.vote;
    var title, sub;
    if (d.results) {
      title = d.title; sub = "Vote the next track and tap READY";
      $("resList").innerHTML = d.results.map(function (r, i) {
        return '<div class="rrow' + (r.me ? " me" : "") + '"><span class="pl">' + (i + 1) + '</span><span class="dot" style="background:' + r.c + '"></span><span class="nm">' + LK.escapeHtml(r.n) + (r.cpu ? " (CPU)" : "") + '</span><span class="w">' + r.w + "</span></div>";
      }).join("");
    } else {
      title = d.players < d.need ? "Waiting for drivers" : "Get ready!";
      sub = d.bw ? d.bw + " battle win" + (d.bw > 1 ? "s" : "") + " tonight" : "Pick a track and tap READY";
    }
    $("resWrap").classList.toggle("hidden", !d.results);
    $("lTitle").textContent = title;
    $("lTitle").classList.toggle("gold", !!d.won);
    $("lSub").textContent = sub;
    $("hostBox").classList.toggle("hidden", !d.host);
    if (d.host) {
      seg($("segLen"), LK.LENGTHS.map(function (m) { return m + " min"; }), d.len, "len");
      seg($("segCpu"), ["No CPU", "CPU to 4", "CPU to 8"], d.cpu, "cpu");
    }
    $("setInfo").textContent = "Battle " + LK.LENGTHS[d.len] + " min · " + ["no CPU drivers", "CPU fills to 4 cars", "CPU fills to 8 cars"][d.cpu] + (d.host ? "" : " · host: " + d.hostName);
    st.ready = !!d.ready;
    readyBtn.classList.toggle("done", st.ready);
    readyBtn.querySelector("span").textContent = st.ready ? (d.players < d.need ? "Ready — need " + d.need + " drivers" : "Ready — waiting for others") : "READY";
    renderTracks();
    show("lobby");
  }
  press(readyBtn)(function () {
    if (st.ready) return;
    st.ready = true; ac.message(AirConsole.SCREEN, { t: "ready" });
    readyBtn.classList.add("done"); readyBtn.querySelector("span").textContent = "Ready — waiting for others";
    buzz(30);
  });

  // ---------------------------------------------------------------- driving
  var padL = $("padL"), padR = $("padR"), steer = $("steer"), btnBrake = $("btnBrake"), btnBoost = $("btnBoost");
  var steerPtrs = {}, brakePtrs = {};
  function sendInput() {
    var l = 0, r = 0, k;
    for (k in steerPtrs) { if (steerPtrs[k] === "l") l = 1; else r = 1; }
    var b = Object.keys(brakePtrs).length ? 1 : 0;
    if (keys.l) l = 1; if (keys.r) r = 1; if (keys.b) b = 1;
    padL.classList.toggle("on", !!l); padR.classList.toggle("on", !!r); btnBrake.classList.toggle("on", !!b);
    if (l !== st.inp.l || r !== st.inp.r || b !== st.inp.b) {
      st.inp = { l: l, r: r, b: b };
      ac.message(AirConsole.SCREEN, { t: "in", l: l, r: r, b: b });
    }
  }
  function sideAt(x) { var rc = steer.getBoundingClientRect(); return x < rc.left + rc.width / 2 ? "l" : "r"; }
  steer.addEventListener("pointerdown", function (e) {
    e.preventDefault(); try { steer.setPointerCapture(e.pointerId); } catch (er) {}
    steerPtrs[e.pointerId] = sideAt(e.clientX); sendInput(); buzz(8);
  });
  steer.addEventListener("pointermove", function (e) {
    if (!(e.pointerId in steerPtrs)) return;
    var s = sideAt(e.clientX); if (s !== steerPtrs[e.pointerId]) { steerPtrs[e.pointerId] = s; sendInput(); }
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (n) {
    steer.addEventListener(n, function (e) { if (e.pointerId in steerPtrs) { delete steerPtrs[e.pointerId]; sendInput(); } });
    btnBrake.addEventListener(n, function (e) { if (e.pointerId in brakePtrs) { delete brakePtrs[e.pointerId]; sendInput(); } });
  });
  btnBrake.addEventListener("pointerdown", function (e) {
    e.preventDefault(); try { btnBrake.setPointerCapture(e.pointerId); } catch (er) {}
    brakePtrs[e.pointerId] = 1; sendInput(); buzz(10);
  });
  btnBoost.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (!st.item) { buzz(5); return; }
    ac.message(AirConsole.SCREEN, { t: "use" });
    btnBoost.classList.add("on"); setTimeout(function () { btnBoost.classList.remove("on"); }, 120);
    buzz(25);
  });
  function releaseAll() { steerPtrs = {}; brakePtrs = {}; keys = {}; if (st.inp.l || st.inp.r || st.inp.b) { st.inp = { l: 0, r: 0, b: 0 }; try { ac.message(AirConsole.SCREEN, { t: "in", l: 0, r: 0, b: 0 }); } catch (e) {} } padL.classList.remove("on"); padR.classList.remove("on"); btnBrake.classList.remove("on"); }
  window.addEventListener("blur", function () { if (st.view === "race") { steerPtrs = {}; brakePtrs = {}; keys = {}; sendInput(); } });

  // keyboard for testing on a computer: arrows, space = brake, enter/up = boost
  var keys = {};
  window.addEventListener("keydown", function (e) {
    if (st.view !== "race") return;
    if (e.key === "ArrowLeft" || e.key === "a") keys.l = 1;
    else if (e.key === "ArrowRight" || e.key === "d") keys.r = 1;
    else if (e.key === " " || e.key === "ArrowDown" || e.key === "s") keys.b = 1;
    else if ((e.key === "Enter" || e.key === "ArrowUp" || e.key === "w") && !e.repeat && st.item) ac.message(AirConsole.SCREEN, { t: "use" });
    else return;
    e.preventDefault(); sendInput();
  });
  window.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "a") delete keys.l;
    else if (e.key === "ArrowRight" || e.key === "d") delete keys.r;
    else if (e.key === " " || e.key === "ArrowDown" || e.key === "s") delete keys.b;
    else return;
    sendInput();
  });

  function setItem(it) {
    st.item = it || null;
    var box = $("rItem"), info = it ? LK.ITEMS[it] : null;
    box.classList.toggle("has", !!info);
    box.style.setProperty("--ic", info ? info.color : "transparent");
    $("rItemIc").innerHTML = LK.ICONS[it || "none"];
    $("rItemName").textContent = info ? info.name : "NO ITEM";
    $("rHint").innerHTML = info ? "Tap <b>BOOST</b>: " + info.desc.toLowerCase() : "Grab a <b>?</b> box";
    $("boostIc").innerHTML = LK.ICONS[it || "turbo"];
    btnBoost.classList.toggle("empty", !info);
  }
  function cover(big, sub, win) {
    var c = $("cover");
    if (!big) { c.classList.add("hidden"); return; }
    $("coverBig").textContent = big; $("coverSub").textContent = sub || "";
    c.classList.toggle("win", !!win); c.classList.remove("hidden");
  }
  function showRace(d) {
    setMe(d);
    $("rName").textContent = d.name;
    $("rWins").textContent = "Heat " + d.heat + " · " + d.wins + " heat win" + (d.wins === 1 ? "" : "s");
    setItem(d.item);
    if (d.waiting) cover("Next heat", "You'll be on the grid when this heat ends.");
    else if (d.heatend && d.wonHeat) cover("You win the heat!", d.wins + " heat win" + (d.wins === 1 ? "" : "s") + " — next heat starts soon", true);
    else if (d.heatend) cover("Heat over", (d.winnerName ? d.winnerName + " won the heat" : "Nobody survived") + " — next heat soon.");
    else if (d.out) cover("You're out!", "Watch the TV — next heat soon.");
    else cover(null);
    if (st.view !== "race") { $("danger").classList.add("hidden"); }
    show("race");
  }
  var dangerTimer = null;
  function flash(color) { var f = $("flash"); f.style.background = color; f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
  function onEvent(d) {
    switch (d.e) {
      case "go": flash("rgba(93,240,154,0.7)"); buzz(60); break;
      case "item": setItem(d.item); flash(LK.ITEMS[d.item].color); buzz(40); break;
      case "used": setItem(null); break;
      case "hit": flash("rgba(255,80,80,0.75)"); buzz(220); break;
      case "shieldsaved": flash("rgba(46,196,255,0.7)"); buzz(60); break;
      case "danger":
        $("danger").classList.remove("hidden"); buzz(90);
        clearTimeout(dangerTimer); dangerTimer = setTimeout(function () { $("danger").classList.add("hidden"); }, 1300); break;
      case "out": releaseAll(); $("danger").classList.add("hidden"); cover("You're out!", "Watch the TV — next heat soon."); buzz(350); break;
      case "heatwin": releaseAll(); cover("You win the heat!", d.wins + " heat win" + (d.wins === 1 ? "" : "s") + " — next heat starts soon", true); flash("rgba(255,207,74,0.8)"); buzz(300); break;
      case "heatlost": if (!$("cover").classList.contains("hidden") && $("coverBig").textContent === "You're out!") $("coverSub").textContent = d.name + " won the heat — next one soon."; break;
      case "champion": flash("rgba(255,207,74,0.9)"); buzz(500); break;
    }
  }

  ac.onMessage = function (from, d) {
    if (from !== AirConsole.SCREEN || !d) return;
    if (d.t === "view") {
      st.last = d;
      if (d.view === "full") show("full");
      else if (d.view === "lobby") showLobby(d);
      else if (d.view === "race") showRace(d);
    } else if (d.t === "ev") onEvent(d);
  };
  ac.onReady = function () { ac.message(AirConsole.SCREEN, { t: "hello" }); };
  setTimeout(function () { if (st.view === "wait") ac.message(AirConsole.SCREEN, { t: "hello" }); }, 1500);
  setTimeout(function () { if (st.view === "wait") ac.message(AirConsole.SCREEN, { t: "hello" }); }, 4000);
  setItem(null);
})();
