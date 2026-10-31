/* Laagri Karts — shared definitions for the TV screen and the phone controller. */
(function (root) {
  "use strict";

  var LK = {};

  LK.MAX_PLAYERS = 8;
  LK.LENGTHS = [2, 3, 5];           // battle length options in minutes
  LK.DEFAULT_LENGTH = 1;            // index into LENGTHS -> 3 min

  // Track meta (geometry lives in laagri-data.js; index is sent over the wire)
  LK.TRACKS = [
    { key: "veskitammi", name: "Veskitammi Ring", short: "Vae, Veskitammi, Kuuse · 2,7 km", color: "#ff6b3d" },
    { key: "express",    name: "Saku–Laagri Express", short: "Hoiu, Saku–Laagri tee, Instituudi tee · 4,1 km", color: "#3d8bff" },
    { key: "kuuse",      name: "Kuuse Loop", short: "Vae, Kuuse, Kuuse põik · 1,9 km", color: "#2ed573" }
  ];

  // One colour per player slot
  LK.SLOTS = [
    { color: "#ff4d5e", dark: "#b3202f", name: "Red" },
    { color: "#3d8bff", dark: "#1f56b3", name: "Blue" },
    { color: "#ffd23f", dark: "#c2961a", name: "Yellow" },
    { color: "#2ed573", dark: "#17924b", name: "Green" },
    { color: "#a55eea", dark: "#6c33a6", name: "Purple" },
    { color: "#ff9f43", dark: "#c26a17", name: "Orange" },
    { color: "#2bd9d9", dark: "#159494", name: "Cyan" },
    { color: "#ff6fae", dark: "#c23c78", name: "Pink" }
  ];

  LK.CPU_NAMES = ["Tõnu", "Malle", "Jüri", "Kalle", "Maie", "Tiit", "Vello", "Sirje"];

  // Items you can pick up from the ? boxes and fire with the BOOST button
  LK.ITEMS = {
    turbo:  { name: "TURBO",      color: "#ff9f1c", desc: "Speed burst" },
    mega:   { name: "MEGA TURBO", color: "#ff3d7f", desc: "Long, huge speed burst" },
    rocket: { name: "ROCKET",     color: "#ff4d4d", desc: "Hits the car ahead of you" },
    oil:    { name: "OIL",        color: "#7a5cff", desc: "Drops a slick behind you" },
    shield: { name: "SHIELD",     color: "#2ec4ff", desc: "Nothing can hit you" }
  };

  LK.escapeHtml = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // White 24x24 glyphs
  LK.ICONS = {
    turbo:  '<svg viewBox="0 0 24 24"><path d="M13.5 2 5 13.4h5.6L9.2 22 19 9.9h-5.8z" fill="currentColor"/></svg>',
    mega:   '<svg viewBox="0 0 24 24"><path d="M9.5 2 3 11.5h4.3L6 20l7.5-10H9.3zM17.5 4 12 12h3.6l-1.1 8L21 11h-4z" fill="currentColor"/></svg>',
    rocket: '<svg viewBox="0 0 24 24"><path d="M12 1.5c3.2 2.4 4.8 5.8 4.8 10.2v4.6l2.7 2.8v2.4l-4.4-1.6H8.9l-4.4 1.6v-2.4l2.7-2.8v-4.6C7.2 7.3 8.8 3.9 12 1.5z" fill="currentColor"/><circle cx="12" cy="10" r="2.1" fill="#000" opacity=".35"/></svg>',
    oil:    '<svg viewBox="0 0 24 24"><path d="M12 2.5s-6.5 7.4-6.5 12A6.5 6.5 0 0 0 18.5 14.5C18.5 9.9 12 2.5 12 2.5z" fill="currentColor"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 2 20 5v6.4c0 5-3.4 8.9-8 10.6-4.6-1.7-8-5.6-8-10.6V5z" fill="currentColor"/></svg>',
    none:   '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3 3"/><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" font-family="sans-serif">?</text></svg>',
    flag:   '<svg viewBox="0 0 24 24"><path d="M5 2v20" stroke="currentColor" stroke-width="2.2"/><path d="M6 3h13v10H6z" fill="#fff"/><path d="M6 3h3.3v3.3H6zM12.5 3h3.3v3.3h-3.3zM9.3 6.3h3.2v3.4H9.3zM15.8 6.3H19v3.4h-3.2zM6 9.7h3.3V13H6zM12.5 9.7h3.3V13h-3.3z" fill="#111"/></svg>',
    trophy: '<svg viewBox="0 0 64 64"><defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#f5a623"/></linearGradient></defs><path d="M18 6h28v14c0 9-6 16-14 16s-14-7-14-16z" fill="url(#tg)"/><path d="M18 10H8v4c0 7 5 12 12 12M46 10h10v4c0 7-5 12-12 12" fill="none" stroke="#f5b83d" stroke-width="4"/><rect x="28" y="35" width="8" height="10" fill="#f5a623"/><rect x="18" y="45" width="28" height="8" rx="3" fill="url(#tg)"/><rect x="14" y="53" width="36" height="6" rx="3" fill="#e0901a"/></svg>'
  };

  // Small top-down car as SVG (used in lobby cards and on the phone)
  LK.carSvg = function (color, dark) {
    return '<svg viewBox="0 0 40 64" class="carsvg"><rect x="2" y="9" width="7" height="13" rx="2.5" fill="#1b1f24"/><rect x="31" y="9" width="7" height="13" rx="2.5" fill="#1b1f24"/>' +
      '<rect x="2" y="43" width="7" height="13" rx="2.5" fill="#1b1f24"/><rect x="31" y="43" width="7" height="13" rx="2.5" fill="#1b1f24"/>' +
      '<rect x="6" y="3" width="28" height="58" rx="11" fill="' + color + '" stroke="' + dark + '" stroke-width="2"/>' +
      '<path d="M10 22c3-3 17-3 20 0l-2 9H12z" fill="#16324f" opacity=".9"/><path d="M12 46h16l2 6c-3 3-17 3-20 0z" fill="#16324f" opacity=".75"/>' +
      '<rect x="17" y="5" width="6" height="54" rx="3" fill="#fff" opacity=".28"/></svg>';
  };

  root.LK = LK;
})(window);
