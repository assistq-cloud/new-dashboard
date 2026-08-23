// ============================================================
// PREMIUM.JS — purely additive UI layer for the ASSISTQ Growth
// Platform. Defines window.toast() (used by a couple of small
// alert()->toast() swaps in app.js) and drives the cursor-glow /
// hover effects. Nothing here touches data, API calls, or state —
// safe to remove without breaking any dashboard functionality.
// ============================================================

(function () {
  // ---- Cursor glow + custom dot ----
  const glow = document.getElementById("cursorGlow");
  const dot = document.getElementById("cursorDot");
  if (glow && dot) {
    window.addEventListener("mousemove", (e) => {
      glow.style.setProperty("--x", e.clientX + "px");
      glow.style.setProperty("--y", e.clientY + "px");
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    });
    document.addEventListener("mouseover", (e) => {
      if (e.target.closest("button, a, .nav, select, input")) dot.classList.add("hoverable");
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest("button, a, .nav, select, input")) dot.classList.remove("hoverable");
    });
  }

  // ---- Toast notifications (replaces jarring alert() for quick confirmations) ----
  window.toast = function (message, kind) {
    kind = kind || (/fail|error|denied|invalid|required|incorrect/i.test(String(message)) ? "error" : "ok");
    const stack = document.getElementById("toastStack");
    if (!stack) { console.log(message); return; }
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.innerHTML = `<span class="dot"></span><span>${String(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.animation = "toastOut .2s ease forwards";
      setTimeout(() => el.remove(), 200);
    }, 4200);
  };

  // ---- Modal dialogs (replace native confirm()/prompt()) ----
  function escapeHtml(x) { return String(x ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])); }

  function openOverlay(innerHtml) {
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay open";
    overlay.innerHTML = `<div class="modalCard">${innerHtml}</div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  // Confirm(message) replacement. Resolves true/false.
  window.modalConfirm = function (message, opts = {}) {
    return new Promise(resolve => {
      const overlay = openOverlay(`
        <div class="modalHead"><h3>${escapeHtml(opts.title || "Are you sure?")}</h3></div>
        <div class="modalBody"><p class="muted" style="font-size:13px;line-height:1.6">${escapeHtml(message)}</p></div>
        <div class="modalFoot"><button class="btn alt" data-act="cancel">Cancel</button><button class="btn ${opts.danger ? "danger-solid" : ""}" data-act="ok">${escapeHtml(opts.okLabel || "Confirm")}</button></div>
      `);
      const done = (result) => { overlay.remove(); resolve(result); };
      overlay.addEventListener("click", e => {
        if (e.target === overlay) return done(false);
        const act = e.target.closest("[data-act]");
        if (act) done(act.dataset.act === "ok");
      });
      document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { document.removeEventListener("keydown", esc); done(false); } });
    });
  };

  // Sequence-of-prompt() replacement. fields: [{id,label,placeholder,value,type,required}].
  // Resolves an object keyed by field id, or null if cancelled.
  window.modalPrompt = function (title, fields, opts = {}) {
    return new Promise(resolve => {
      const rows = fields.map(f => `<div class="field"><label>${escapeHtml(f.label)}${f.required ? " *" : ""}</label><input class="modalInput" data-key="${f.id}" type="${f.type || "text"}" placeholder="${escapeHtml(f.placeholder || "")}" value="${escapeHtml(f.value ?? "")}"></div>`).join("");
      const overlay = openOverlay(`
        <div class="modalHead"><h3>${escapeHtml(title)}</h3><button class="modalClose" data-act="cancel">✕</button></div>
        <div class="modalBody"><div class="form" style="grid-template-columns:1fr">${rows}</div><div class="modalError"></div></div>
        <div class="modalFoot"><button class="btn alt" data-act="cancel">Cancel</button><button class="btn" data-act="ok">${escapeHtml(opts.okLabel || "Save")}</button></div>
      `);
      const firstInput = overlay.querySelector(".modalInput");
      if (firstInput) setTimeout(() => firstInput.focus(), 50);
      const done = (result) => { overlay.remove(); resolve(result); };
      function submit() {
        const result = {};
        overlay.querySelectorAll(".modalInput").forEach(inp => result[inp.dataset.key] = inp.value.trim());
        const missing = fields.find(f => f.required && !result[f.id]);
        if (missing) {
          const err = overlay.querySelector(".modalError");
          err.textContent = `${missing.label} is required.`;
          err.classList.add("show");
          return;
        }
        done(result);
      }
      overlay.addEventListener("click", e => {
        if (e.target === overlay) return done(null);
        const act = e.target.closest("[data-act]");
        if (act) act.dataset.act === "ok" ? submit() : done(null);
      });
      overlay.addEventListener("keydown", e => {
        if (e.key === "Enter" && e.target.classList.contains("modalInput")) { e.preventDefault(); submit(); }
        if (e.key === "Escape") done(null);
      });
    });
  };

  // Pick-from-a-list prompt() replacement. options: [{value,label}]. Resolves the
  // picked value, or null if cancelled.
  window.modalSelect = function (title, message, options) {
    return new Promise(resolve => {
      const rows = options.map(o => `<div class="modalOption" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`).join("");
      const overlay = openOverlay(`
        <div class="modalHead"><h3>${escapeHtml(title)}</h3><button class="modalClose" data-act="cancel">✕</button></div>
        <div class="modalBody">${message ? `<p class="muted" style="font-size:12.5px;margin-bottom:12px">${escapeHtml(message)}</p>` : ""}<div class="modalOptionList">${rows}</div></div>
        <div class="modalFoot"><button class="btn alt" data-act="cancel">Cancel</button></div>
      `);
      const done = (result) => { overlay.remove(); resolve(result); };
      overlay.addEventListener("click", e => {
        if (e.target === overlay) return done(null);
        const opt = e.target.closest(".modalOption");
        if (opt) return done(opt.dataset.value);
        const act = e.target.closest("[data-act]");
        if (act) done(null);
      });
    });
  };
})();
