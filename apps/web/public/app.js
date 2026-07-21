// INTEL.DOM.GOB — public site interactivity (vanilla, no build step).
(function () {
  "use strict";

  // ---- Mobile nav toggle ----
  var toggle = document.querySelector("[data-nav-toggle]");
  var mobile = document.querySelector("[data-nav-mobile]");
  if (toggle && mobile) {
    toggle.addEventListener("click", function () {
      mobile.classList.toggle("open");
    });
    mobile.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { mobile.classList.remove("open"); });
    });
  }

  // ---- Surfaces (quick start gallery) ----
  (function () {
    var surfaces = document.querySelectorAll("[data-surface]");
    var panels = document.querySelectorAll("[data-qs-panel]");
    if (!surfaces.length) return;
    function activate(id) {
      surfaces.forEach(function (s) {
        s.classList.toggle("active", s.getAttribute("data-surface") === id && !s.disabled);
      });
      panels.forEach(function (p) {
        p.classList.toggle("active", p.getAttribute("data-qs-panel") === id);
      });
    }
    surfaces.forEach(function (s) {
      if (s.disabled) return;
      s.addEventListener("click", function () {
        activate(s.getAttribute("data-surface"));
      });
    });
    // Start with Studio active so the panel is never empty on load.
    activate("studio");
  })();

  // ---- Copy buttons ----
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      navigator.clipboard.writeText(text).then(function () {
        var old = btn.textContent;
        btn.textContent = "Copiado";
        setTimeout(function () { btn.textContent = old; }, 1400);
      });
    });
  });

  // ---- Back to top ----
  (function () {
    var btn = document.querySelector("[data-to-top]");
    if (!btn) return;
    function onScroll() {
      var show = window.scrollY > 480;
      btn.classList.toggle("show", show);
      btn.hidden = !show;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    onScroll();
  })();

  // ---- Newsletter (client-side confirmation only) ----
  var news = document.querySelector("[data-news]");
  if (news) {
    var ok = document.querySelector("[data-news-ok]");
    news.addEventListener("submit", function (e) {
      e.preventDefault();
      news.reset();
      if (ok) ok.hidden = false;
    });
  }

  // ---- Live demo ----
  var form = document.querySelector("[data-demo-form]");
  if (form) {
    var input = form.querySelector("input");
    var btn = form.querySelector("button");
    var out = document.querySelector("[data-demo-result]");

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function srcIcon() {
      return '<svg class="src-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';
    }

    function render(data) {
      if (!data.ok) {
        out.innerHTML =
          '<div class="demo-error">⚠ ' + esc(data.error) +
          "<br><small style=\"color:var(--muted-2)\">Asegúrate de que la API esté disponible (modo preview: sin api key).</small></div>";
        out.classList.add("show");
        return;
      }
      var src = (data.sources || []).map(function (s) {
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
          srcIcon() + "<span>" + esc(s.title || s.url) + "</span></a>";
      }).join("");
      out.innerHTML =
        '<div class="demo-meta">' +
          '<span class="chip">Confianza: <b class="conf">' + esc(data.confidence) + "</b></span>" +
          '<span class="chip">' + esc(data.institution || "Estado Dominicano") + "</span>" +
        "</div>" +
        '<div class="demo-summary">' + esc(data.summary) + "</div>" +
        (src ? '<div class="demo-sources"><h4>Fuentes oficiales</h4>' + src + "</div>" : "");
      out.classList.add("show");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      btn.disabled = true;
      out.innerHTML = '<div style="display:flex;gap:12px;align-items:center;color:var(--muted)"><span class="spinner"></span> Consultando fuentes oficiales…</div>';
      out.classList.add("show");
      fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: q }),
      })
        .then(function (r) { return r.json(); })
        .then(render)
        .catch(function () {
          render({ ok: false, error: "No se pudo conectar con la API." });
        })
        .finally(function () { btn.disabled = false; });
    });
  }

  // ---- Hero ASCII animation (terminal reveal cycling frames) ----
  (function () {
    var canvas = document.querySelector("[data-ascii-canvas]");
    var dataEl = document.getElementById("asciiFrames");
    if (!canvas || !dataEl) return;
    var frames;
    try { frames = JSON.parse(dataEl.textContent || "[]"); } catch (e) { return; }
    if (!Array.isArray(frames) || !frames.length) return;

    var HEIGHT = frames[0].length;
    var WIDTH = Math.max.apply(null, frames[0].map(function (r) { return r.length; }));
    var ROW_MS = 160;       // reveal each row (slow, terminal-like)
    var HOLD_MS = 2400;     // hold full frame
    var CLEAR_ROW_MS = 80;  // clear rows quickly between frames

    // build the canvas as HEIGHT rows of equal-width padded strings
    function padTo(s, w) { return (s.length >= w ? s : s + new Array(w - s.length + 1).join(" ")); }
    function frameRows(f) { return f.map(function (s) { return padTo(s, WIDTH); }); }

    function setText(rows) { canvas.textContent = rows.join("\n"); }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    var frameIdx = 0;

    function revealFrame(rows) {
      // Reveal row by row from top
      return new Promise(function (resolve) {
        var built = [];
        var i = 0;
        function step() {
          built.push(rows[i]);
          var display = built.slice();
          for (var k = i + 1; k < HEIGHT; k++) display.push("");
          setText(display);
          i++;
          if (i < HEIGHT) setTimeout(step, ROW_MS);
          else resolve();
        }
        step();
      });
    }

    function clearFrame() {
      return new Promise(function (resolve) {
        // Pop rows from the bottom upward
        var rows = frameRows(frames[frameIdx]);
        var i = HEIGHT;
        function step() {
          i--;
          rows[i] = new Array(WIDTH + 1).join(" ");
          setText(rows);
          if (i > 0) setTimeout(step, CLEAR_ROW_MS);
          else resolve();
        }
        step();
      });
    }

    // Eye-specific iris swing: center → left → center → right → center.
    // Each iris position rebuilds the whole row from scratch (░ haze + ████ block)
    // so the previous position's █ is overwritten — no stale trail.
    // Layout (38 cols): "  │" + 31× inner + "│   " (right border + 3 pad).
    var EYE_IDX = 1;
    var IRIS = "████";
    var IRIS_W = IRIS.length;
    var EYE_ROWS = [2, 3];            // rows containing the iris
    var EYE_LEFT = "  │";             // 3 cols → left border at col 2
    var EYE_RIGHT = "│   ";           // 4 cols → right border at col 34, 3 trailing pad
    var INNER_W = 31;                 // cols between │ borders
    var FILL = "░";
    var IRIS_CENTER_INNER = 14;        // inner-space col 14 → full col 17 (current center)
    var IRIS_SWING = 4;                // ± cols to swing from center
    var IRIS_STEP_MS = 90;              // base ms per iris column-step (in the middle)
    var IRIS_PAUSE_MS = 350;            // pause at center after each cycle (shorter → quicker start of next frame change)

    function setIrisAt(rows, irisCol) {
      // Build a clean row: EYE_LEFT + (░ × irisCol) + ████ + (░ × rest) + EYE_RIGHT
      var inner = new Array(irisCol + 1).join(FILL)
                + IRIS
                + new Array(INNER_W - irisCol - IRIS_W + 1).join(FILL);
      inner = inner.slice(0, INNER_W);                 // safety clamp
      var line = EYE_LEFT + inner + EYE_RIGHT;
      if (line.length < WIDTH) line = line + new Array(WIDTH + 1 - line.length).join(" ");
      if (line.length > WIDTH) line = line.slice(0, WIDTH);
      EYE_ROWS.forEach(function (r) { rows[r] = line; });
    }

    function swingEyeIris() {
      // Build a smooth trajectory: center → left → center → right → center,
      // stepping ONE column at a time so the iris glides instead of jumping.
      // Delay per step is eased: longer at the ends (slow-in/slow-out),
      // shorter in the middle (faster transit).
      var N = IRIS_SWING;
      var a = IRIS_CENTER_INNER;          // absolute inner-col for iris start
      var path = [];                      // sequence of target cols
      function push(from, to) {
        var dir = to > from ? 1 : -1;
        for (var c = from; c !== to; c += dir) path.push(c);
        path.push(to);
      }
      push(a, a - N);                     // → left
      push(a - N, a);                     // → center
      push(a, a + N);                     // → right
      push(a + N, a);                     // → center

      var baseDelay = 55;                 // ms per step in the middle of the arc
      var easeFactor = 1;                 // multiplier applied at ends (eased)

      function ease(i) {
        // distance from nearest turning point in path → multiplier (1..3.2)
        var segs = [N, N, N, N];          // each leg has N+1 steps (we push N+1)
        var segStart = 0;
        for (var s = 0; s < segs.length; s++) {
          var segLen = segs[s];
          if (i <= segStart + segLen) {
            var local = i - segStart;          // 0..N
            var fromEnd = Math.min(local, segLen - local);  // distance to either end of leg
            // 0 at endpoints (slow), N/2 in middle (fast) → multiplier inversely
            return 1 + 2.2 * Math.pow(1 - (fromEnd / (segLen / 2)), 1.7);
          }
          segStart += segLen;
        }
        return 1;
      }

      return new Promise(function (resolve) {
        var i = 0;
        function step() {
          var rows = frameRows(frames[EYE_IDX]);
          var col = path[i];
          if (col < 0) col = 0;
          if (col > INNER_W - IRIS_W) col = INNER_W - IRIS_W;
          setIrisAt(rows, col);
          setText(rows);
          i++;
          if (i < path.length) {
            setTimeout(step, baseDelay * ease(i));
          } else {
            setTimeout(resolve, IRIS_PAUSE_MS);
          }
        }
        step();
      });
    }

    function loop() {
      var rows = frameRows(frames[frameIdx]);
      revealFrame(rows)
        .then(function () {
          // For the eye, start swinging right after reveal — no hold.
          if (frameIdx !== EYE_IDX) return sleep(HOLD_MS);
        })
        .then(function () {
          if (frameIdx === EYE_IDX) return swingEyeIris();
        })
        .then(function () { return clearFrame(); })
        .then(function () {
          frameIdx = (frameIdx + 1) % frames.length;
          loop();
        });
    }

    loop();
  })();

  // ---- EOF ----
})();
