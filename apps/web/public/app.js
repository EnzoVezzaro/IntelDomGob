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
})();
