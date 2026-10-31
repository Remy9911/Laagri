/* Test-only stand-in for airconsole-1.11.0.js: routes messages between pages of one browser via BroadcastChannel. */
(function () {
  var qs = new URLSearchParams(location.search);
  var isScreen = /screen\.html|demo/.test(location.pathname);
  var myId = isScreen ? 0 : +(qs.get("dev") || 1);
  var nick = qs.get("nick") || ("Guest " + myId);
  var bc = new BroadcastChannel("acmock");
  window.__acLog = [];
  function AirConsole() {
    var self = this; this._nick = {};
    bc.onmessage = function (e) {
      var m = e.data;
      if (m.type === "msg" && m.to === myId) { window.__acLog.push(m.data); if (self.onMessage) self.onMessage(m.from, m.data); }
      if (isScreen && m.type === "connect") { self._nick[m.id] = m.nick; if (self.onConnect) self.onConnect(m.id); }
      if (isScreen && m.type === "disconnect") { if (self.onDisconnect) self.onDisconnect(m.id); }
      if (!isScreen && m.type === "screenhello") bc.postMessage({ type: "connect", id: myId, nick: nick });
    };
    setTimeout(function () {
      if (isScreen) { if (self.onReady) self.onReady("1234567"); bc.postMessage({ type: "screenhello" }); }
      else { bc.postMessage({ type: "connect", id: myId, nick: nick }); if (self.onReady) self.onReady(); }
    }, 60);
    if (!isScreen) window.__acDisconnect = function () { bc.postMessage({ type: "disconnect", id: myId }); };
  }
  AirConsole.SCREEN = 0; AirConsole.ORIENTATION_PORTRAIT = "portrait"; AirConsole.ORIENTATION_LANDSCAPE = "landscape";
  AirConsole.prototype.message = function (to, data) { bc.postMessage({ type: "msg", to: to, from: myId, data: data }); };
  AirConsole.prototype.getNickname = function (id) { return this._nick[id] || ("Guest " + id); };
  AirConsole.prototype.vibrate = function () {};
  window.AirConsole = AirConsole;
})();
