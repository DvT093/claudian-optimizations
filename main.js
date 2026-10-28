/* Initiate: aanvulling op Claudian, zonder Claudian zelf aan te passen.
   - Volledige titel i.p.v. nummer (ellipsis alleen als er echt geen ruimte is).
   - Rechts in de tab een vak: status-badge, bij hover een kruisje om te sluiten.
   - Middelklik sluit ook. Rechtsklik sluit NIET meer (te makkelijk per ongeluk).
   - Plus-knop (nieuwe tab) verhuist naar direct achter de laatste tab, als kaal "+".
   - Spinner ook op de actieve tab als die bezig is (Claudian zegt dan alleen "active").
   Data komt uit Claudian's eigen tabManager.getTabBarItems(). Verandert Claudian
   z'n binnenkant, dan valt dit stil terug op Claudian's eigen tabs; er breekt niks.
   Styling: styles.css naast dit bestand.
   - Effort-keuze opent op klik i.p.v. op hover (zie patchEffortClick + styles.css).
   - Image-chipje toont een thumbnail van de geplakte afbeelding (zie thumbs).
   - Microfoonknop in de toolbar: spraak -> tekst in het chatvak, lokaal via whisper.cpp (zie voice*). */
const { Plugin, setIcon, Notice } = require("obsidian");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Obsidian start niet vanuit een shell, dus Homebrew staat niet in PATH: absolute paden.
const WHISPER_BIN = ["/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"].find((p) => fs.existsSync(p)) || "whisper-cli";
const FFMPEG_BIN = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => fs.existsSync(p)) || "ffmpeg";
const WHISPER_MODEL = path.join(os.homedir(), ".local/share/whisper/ggml-large-v3-turbo.bin");
// Hint voor Whisper: woorden die het anders verkeerd schrijft
const WHISPER_PROMPT = "Claudian, Obsidian, Initiate, Claude Code, Figma, Jira, prompt, plugin, frontmatter.";
const HOLD_MS = 400; // langer ingedrukt = vasthouden (loslaten stopt), korter = tikken (nog een klik stopt)

const VIEW_TYPE = "claudian-view";
const STATUS_SUFFIXES = [
  ", stopped with an error, ready to review",
  ", finished, ready to review",
  ", needs your input",
  ", working",
  ", active",
  ", idle",
];
const X_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function titleFromLabel(label) {
  if (!label) return "";
  for (const s of STATUS_SUFFIXES) if (label.endsWith(s)) return label.slice(0, -s.length);
  return label;
}

module.exports = class ClaudianTabTitles extends Plugin {
  onload() {
    this.patchRename();
    this.patchEffortClick();
    this.patchLinkedChip();
    this.patchVoiceHotkey();
    this.containers = new Map(); // container -> { view, obs }
    const tick = () => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        const view = leaf.view;
        const c = view?.containerEl?.querySelector(".claudian-tab-badges");
        // Knoppen ook bij 1 tab (dan rendert Claudian geen tabbalk): anders blijft de vierkant-plus staan
        try { if (view?.containerEl) this.movePlus(c, view); } catch (e) { console.warn("[claudian-tab-titles]", e); }
        try { if (view?.containerEl) this.syncLinkedChip(view); } catch (e) { console.warn("[claudian-tab-titles]", e); }
        try { if (view?.containerEl) this.voiceButtons(view); } catch (e) { console.warn("[claudian-tab-titles]", e); }
        if (!c) continue;
        try { this.thumbs(view); } catch (e) { console.warn("[claudian-tab-titles]", e); }
        for (const step of [() => this.attach(c, view), () => this.decorateAll(c, view), () => this.movePlus(c, view)]) {
          try { step(); } catch (e) { console.warn("[claudian-tab-titles]", e); }
        }
      }
      for (const [c, rec] of this.containers) {
        if (!c.isConnected) { rec.obs.disconnect(); this.containers.delete(c); }
      }
    };
    this.app.workspace.onLayoutReady(tick);
    this.registerEvent(this.app.workspace.on("layout-change", tick));
    this.registerInterval(window.setInterval(tick, 400));
  }

  /* Image-chipje: Claudian toont alleen "Image". Wij zoeken de afbeelding op in de
     imageContextManager van de tabs (chip.dataset.contextId = image-id) en zetten er een
     thumbnail in. Niet gevonden = chipje blijft zoals Claudian 'm maakt. */
  thumbs(view) {
    const chips = view.containerEl.querySelectorAll(".claudian-context-chip--image");
    if (!chips.length) return;
    let tabs = [];
    try { tabs = view.tabManager?.getAllTabs?.() ?? []; } catch (e) { return; }
    for (const chip of chips) {
      const id = chip.dataset.contextId;
      const main = chip.querySelector(".claudian-context-chip-main");
      if (!id || !main || main.querySelector(":scope > .itab-thumb")) continue;
      let img = null;
      for (const t of tabs) {
        img = t?.ui?.imageContextManager?.attachedImages?.get?.(id);
        if (img) break;
      }
      if (!img?.data || !img?.mediaType) continue;
      const el = document.createElement("img");
      el.className = "itab-thumb";
      el.alt = "";
      el.src = `data:${img.mediaType};base64,${img.data}`;
      main.prepend(el);
      chip.classList.add("itab-has-thumb");
    }
  }

  /* Microfoonknop (2026-10-28). Tikken = start, nog een klik = stop. Ingedrukt houden = opnemen
     tot je loslaat. Esc annuleert. De tekst komt op de cursor in het chatvak; versturen doe je zelf.
     Opname via MediaRecorder, daarna ffmpeg -> 16 kHz wav -> whisper-cli (Nederlands), alles lokaal. */
  voiceButtons(view) {
    for (const bar of view.containerEl.querySelectorAll(".claudian-input-toolbar:not(.claudian-inline-model-toolbar)")) {
      if (bar.querySelector(":scope > .itab-mic")) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "itab-mic";
      b.setAttribute("aria-label", "Inspreken");
      b.setAttribute("title", "Tik of ⌘D: start/stop  ·  Vasthouden: praten tot je loslaat  ·  Esc: annuleren");
      setIcon(b, "mic");
      b.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // focus blijft in het chatvak, dus de cursor ook
        this.voicePress(b);
      });
      b.addEventListener("mouseup", (e) => { if (e.button === 0) this.voiceRelease(b); });
      bar.append(b);
    }
  }

  /* Cmd+D = start/stop, zoals in VS Code. Alleen als je in Claudian zit (of al opneemt): in een
     gewone note blijft Cmd+D van de editor (volgende gelijke woord selecteren). */
  patchVoiceHotkey() {
    this.registerDomEvent(document, "keydown", (e) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== "d") return;
      if (this.voice) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (this.voice.state === "rec") this.voiceStop();
        return;
      }
      const leafEl = e.target?.closest?.('.workspace-leaf-content[data-type="' + VIEW_TYPE + '"]');
      if (!leafEl) return;
      const b = leafEl.querySelector(".claudian-active-input-slot .itab-mic") ?? leafEl.querySelector(".itab-mic");
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.voiceStart(b);
    }, true);
  }

  voicePress(b) {
    const v = this.voice;
    if (v?.state === "busy") return;
    if (v?.state === "rec") { this.voiceStop(); return; } // tweede tik
    this.voiceStart(b);
  }

  voiceRelease(b) {
    const v = this.voice;
    if (v?.state === "rec" && v.button === b && Date.now() - v.started >= HOLD_MS) this.voiceStop();
  }

  async voiceStart(b) {
    if (!fs.existsSync(WHISPER_MODEL)) { new Notice("Whisper-model ontbreekt: " + WHISPER_MODEL); return; }
    const editor = b.closest(".claudian-input-wrapper")?.querySelector(".claudian-composer-editor");
    const v = { state: "rec", button: b, editor, started: Date.now(), chunks: [], cancelled: false };
    this.voice = v;
    this.voiceUi(b, "rec");
    try {
      v.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      this.voice = null;
      this.voiceUi(b, "idle");
      new Notice("Geen toegang tot de microfoon. Zet Obsidian aan bij Systeeminstellingen > Privacy en beveiliging > Microfoon.");
      return;
    }
    if (this.voice !== v) { v.stream.getTracks().forEach((t) => t.stop()); return; } // al geannuleerd
    v.rec = new MediaRecorder(v.stream);
    v.rec.ondataavailable = (e) => { if (e.data.size) v.chunks.push(e.data); };
    v.rec.onstop = () => this.voiceDone(v);
    v.rec.start();
    if (!this.voiceKeys) {
      this.voiceKeys = true;
      this.registerDomEvent(document, "keydown", (e) => {
        if (e.key === "Escape" && this.voice?.state === "rec") { e.preventDefault(); e.stopImmediatePropagation(); this.voiceStop(true); }
      }, true);
    }
  }

  voiceStop(cancel = false) {
    const v = this.voice;
    if (!v || v.state !== "rec") return;
    v.cancelled = cancel;
    v.state = "busy";
    if (v.rec && v.rec.state !== "inactive") v.rec.stop();
    else this.voiceDone(v); // nog geen recorder (stop vóór de microfoon klaar was)
  }

  async voiceDone(v) {
    v.stream?.getTracks().forEach((t) => t.stop());
    if (v.cancelled || !v.chunks.length) { this.voiceEnd(v); return; }
    this.voiceUi(v.button, "busy");
    const base = path.join(os.tmpdir(), `claudian-voice-${Date.now()}`);
    try {
      const blob = new Blob(v.chunks, { type: v.rec.mimeType || "audio/webm" });
      fs.writeFileSync(base + ".webm", Buffer.from(await blob.arrayBuffer()));
      await this.run(FFMPEG_BIN, ["-y", "-loglevel", "error", "-i", base + ".webm", "-ar", "16000", "-ac", "1", base + ".wav"]);
      const out = await this.run(WHISPER_BIN, ["-m", WHISPER_MODEL, "-l", "nl", "-nt", "-np", "--prompt", WHISPER_PROMPT, "-f", base + ".wav"]);
      const text = out.split("\n").map((l) => l.trim()).filter(Boolean).join(" ").trim();
      if (text && !/^\[.*\]$/.test(text)) this.voiceInsert(v.editor, text);
      else new Notice("Niks verstaan. Probeer het nog eens, iets dichter bij de microfoon.");
    } catch (e) {
      console.warn("[claudian-tab-titles] voice mislukt", e);
      new Notice("Omzetten naar tekst mislukt: " + (e.message || e));
    } finally {
      for (const ext of [".webm", ".wav"]) fs.rm(base + ext, { force: true }, () => {});
      this.voiceEnd(v);
    }
  }

  voiceEnd(v) {
    if (this.voice === v) this.voice = null;
    this.voiceUi(v.button, "idle");
  }

  voiceUi(b, state) {
    if (!b) return;
    b.classList.toggle("itab-mic-rec", state === "rec");
    b.classList.toggle("itab-mic-busy", state === "busy");
    setIcon(b, state === "busy" ? "loader-2" : "mic");
  }

  run(bin, args) {
    return new Promise((resolve, reject) => {
      execFile(bin, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).toString().trim().split("\n").pop()));
        else resolve(stdout.toString());
      });
    });
  }

  /* Tekst op de cursor in het chatvak (CodeMirror). Stond de cursor er niet, dan aan het eind.
     execCommand vuurt een echt input-event, zodat Claudian de tekst ziet. */
  voiceInsert(ed, text) {
    if (!ed || !ed.isConnected) { navigator.clipboard?.writeText(text); new Notice("Chatvak niet gevonden, tekst staat op je klembord."); return; }
    const target = ed.querySelector("[contenteditable=true], textarea") ?? ed;
    const doc = target.ownerDocument;
    const sel = doc.getSelection();
    const inside = sel.rangeCount && target.contains(sel.anchorNode);
    target.focus();
    if (!inside) {
      const r = doc.createRange();
      r.selectNodeContents(target);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    const node = sel.anchorNode;
    const before = node?.nodeType === Node.TEXT_NODE ? node.textContent.slice(0, sel.anchorOffset).slice(-1) : "";
    doc.execCommand("insertText", false, (before && !/\s/.test(before) ? " " : "") + text);
  }

  /* Effort (en thinking budget): Claudian klapt de opties open op hover. Wij maken er een klik van.
     Capture-fase, want Claudian stopt de propagatie op een gekozen optie. */
  /* Notitie-chipje onder het veld (2026-10-21): klik = het @-menu opent, en wat je daar kiest wordt
     de nieuwe gekoppelde notitie van dit gesprek (het chipje wisselt mee). Werkt via Claudian's eigen
     linkedContentController.lock(pad), dezelfde functie die Claudian gebruikt bij het openen van een
     gesprek. Cmd/Ctrl-klik = Claudian's eigen gedrag (de notitie openen). */
  patchLinkedChip() {
    const SEL = ".claudian-input-info-linked-main";
    this.linkPick = null; // { controller, editorEl, until }
    this.registerDomEvent(document, "mouseover", (e) => {
      const chip = e.target.closest?.(SEL);
      if (chip && !chip.dataset.itabAt) {
        chip.dataset.itabAt = "1";
        chip.setAttribute("title", "Klik: andere notitie kiezen  \u00b7  \u2318-klik: notitie openen");
      }
    }, true);
    this.registerDomEvent(document, "click", (e) => {
      const chip = e.target.closest?.(SEL);
      if (!chip || e.metaKey || e.ctrlKey || e.button !== 0) return;
      const ctx = this.linkedContext(chip);
      if (!ctx) return; // niets gevonden: laat Claudian's eigen klik gewoon doorgaan
      e.preventDefault();
      e.stopImmediatePropagation();
      const editorEl = this.insertAt(ctx.ed);
      this.linkPick = { controller: ctx.controller, editorEl, until: Date.now() + 120000 };
    }, true);
    // Keuze in het @-menu onderscheppen zolang we in "notitie kiezen" zitten
    const itemFromEvent = (t) => {
      const item = t.closest?.(".claudian-composer-dropdown-item");
      if (!item || item.closest(".claudian-linked-content-picker")) return null;
      return item;
    };
    this.registerDomEvent(document, "mousedown", (e) => {
      if (!this.pickActive()) return;
      const item = itemFromEvent(e.target);
      if (!item) return;
      if (this.applyPick(item)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.blockNextClick = true;
      }
    }, true);
    this.registerDomEvent(document, "click", (e) => {
      if (!this.blockNextClick) return;
      this.blockNextClick = false;
      if (itemFromEvent(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    this.registerDomEvent(document, "keydown", (e) => {
      if (!this.pickActive()) return;
      if (e.key === "Escape") { this.linkPick = null; return; }
      if (e.key !== "Enter" && e.key !== "Tab") return;
      const scope = this.linkPick.editorEl?.closest(".claudian-input-container, .claudian-tab-content") ?? document;
      const dd = scope.querySelector(".claudian-composer-dropdown.is-visible");
      const item = dd?.querySelector(".claudian-composer-dropdown-item.is-selected");
      if (item && this.applyPick(item)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  /* Kruisje + leeg chipje (2026-10-21). Claudian geeft het kruisje alleen vóór het eerste bericht;
     daarna zit de notitie vast. Wij zetten er altijd een kruisje bij (= lock zonder pad), en na
     loskoppelen een licht chipje "Notitie koppelen" dat via het @-menu weer een notitie kiest. */
  syncLinkedChip(view) {
    let tab = null;
    try { tab = view.tabManager?.getActiveTab?.() ?? null; } catch (e) { return; }
    const ctrl = tab?.ui?.linkedContentController ?? tab?.session?.runtime?.model?.linkedContentController;
    if (!ctrl || typeof ctrl.getSnapshot !== "function" || typeof ctrl.lock !== "function") return;
    const snap = ctrl.getSnapshot();
    if (snap.mode !== "locked") return; // vóór het eerste bericht regelt Claudian het zelf
    const slot = view.containerEl.querySelector(".claudian-active-input-slot .claudian-input-info-linked")
      ?? view.containerEl.querySelector(".claudian-input-info-linked");
    if (!slot) return;
    if (snap.path) {
      slot.querySelector(":scope > .itab-link-empty")?.remove();
      if (slot.querySelector(":scope > .claudian-input-info-linked-main") && !slot.querySelector(":scope > .claudian-input-info-linked-remove")) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "claudian-input-info-linked-remove itab-link-remove";
        x.textContent = "\u00d7";
        x.setAttribute("aria-label", "Notitie loskoppelen");
        x.setAttribute("title", "Notitie loskoppelen van dit gesprek");
        x.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          try { ctrl.lock(undefined); } catch (err) { console.warn("[claudian-tab-titles] loskoppelen mislukt", err); }
        });
        slot.append(x);
      }
    } else if (!slot.querySelector(":scope > .itab-link-empty")) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "claudian-input-info-linked-main itab-link-empty";
      try { const ic = document.createElement("span"); ic.className = "claudian-input-info-linked-icon"; setIcon(ic, "file-plus"); b.append(ic); } catch (e) {}
      const l = document.createElement("span");
      l.className = "claudian-input-info-linked-label";
      l.textContent = "Notitie koppelen";
      b.append(l);
      slot.append(b);
    }
  }

  pickActive() {
    if (this.linkPick && Date.now() > this.linkPick.until) this.linkPick = null;
    return !!this.linkPick;
  }

  /* Zoek bij het chipje de Claudian-view, het actieve tabblad, de linked-content-controller en het veld */
  linkedContext(chip) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (!view?.containerEl?.contains(chip)) continue;
      let tab = null;
      try { tab = view.tabManager?.getActiveTab?.() ?? null; } catch (e) {}
      const controller = tab?.ui?.linkedContentController ?? tab?.session?.runtime?.model?.linkedContentController;
      if (!controller || typeof controller.lock !== "function") return null;
      const scope = chip.closest(".claudian-tab-content") ?? view.containerEl;
      const ed = scope.querySelector(".claudian-active-input-slot .claudian-composer-editor")
        ?? scope.querySelector(".claudian-composer-editor");
      return ed ? { controller, ed } : null;
    }
    return null;
  }

  /* Item uit het @-menu -> vault-pad -> nieuwe gekoppelde notitie. false = geen notitie/map, laat Claudian het doen. */
  applyPick(item) {
    const txt = (sel) => (item.querySelector(sel)?.textContent ?? "").trim();
    const label = txt(".claudian-composer-dropdown-label");
    const detail = txt(".claudian-composer-dropdown-detail");
    const clean = (p) => p.replace(/^@/, "").replace(/\/+$/, "");
    const tries = [label, detail, detail && label ? `${detail}/${label}` : ""].map(clean).filter(Boolean);
    let file = null;
    for (const p of tries) { file = this.app.vault.getAbstractFileByPath(p); if (file) break; }
    if (!file) return false;
    const pick = this.linkPick;
    this.linkPick = null;
    this.removeAtQuery(pick.editorEl);
    try {
      pick.controller.lock(file.path);
    } catch (e) {
      console.warn("[claudian-tab-titles] lock mislukt", e);
      return false;
    }
    return true;
  }

  /* Haal de "@zoekterm" die we zelf typten weer uit het veld (backspace vanaf het eind tot en met de @) */
  removeAtQuery(editorEl) {
    if (!editorEl) return;
    editorEl.focus();
    const doc = editorEl.ownerDocument;
    const sel = doc.getSelection();
    const r = doc.createRange();
    r.selectNodeContents(editorEl);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    const text = editorEl.textContent ?? "";
    const at = text.lastIndexOf("@");
    if (at < 0) return;
    let n = text.length - at;
    if (at > 0 && text[at - 1] === " " && editorEl.dataset.itabAtSpace === "1") n += 1;
    delete editorEl.dataset.itabAtSpace;
    for (let k = 0; k < n && k < 200; k++) doc.execCommand("delete", false);
  }

  insertAt(ed) {
    // Het veld is een CodeMirror-editor (.cm-content) die Claudian pas bij focus aanmaakt:
    // eerst focussen, dan het echte bewerkbare element opzoeken.
    let target = ed.querySelector("[contenteditable=true], textarea");
    if (!target) {
      ed.focus();
      ed.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target = ed.querySelector("[contenteditable=true], textarea");
    }
    if (!target) {
      const a = ed.ownerDocument.activeElement;
      target = a && ed.contains(a) ? a : ed;
    }
    target.focus();
    let before = "";
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const n = target.value.length;
      target.setSelectionRange(n, n);
      before = target.value.slice(-1);
    } else {
      const sel = target.ownerDocument.getSelection();
      const r = target.ownerDocument.createRange();
      r.selectNodeContents(target);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      before = (target.textContent || "").slice(-1);
    }
    const text = before && !/\s/.test(before) ? " @" : "@";
    if (text === " @") target.dataset.itabAtSpace = "1"; else delete target.dataset.itabAtSpace;
    // execCommand vuurt een echt input-event, daar reageert Claudian's @-menu op
    target.ownerDocument.execCommand("insertText", false, text);
    return target;
  }

  patchEffortClick() {
    const OPEN = "itab-open";
    const closeAll = (except) => {
      document.querySelectorAll(`.claudian-thinking-gears.${OPEN}`).forEach((g) => { if (g !== except) g.classList.remove(OPEN); });
    };
    this.registerDomEvent(document, "click", (e) => {
      const t = e.target;
      const current = t?.closest?.(".claudian-thinking-current");
      if (current) {
        const g = current.closest(".claudian-thinking-gears");
        closeAll(g);
        g?.classList.toggle(OPEN);
        return;
      }
      if (t?.closest?.(".claudian-thinking-gear")) { closeAll(null); return; }
      closeAll(null);
    }, true);
    this.registerDomEvent(document, "keydown", (e) => { if (e.key === "Escape") closeAll(null); }, true);
  }

  /* /rename <titel> in het Claudian-invoerveld: hernoemt het gesprek (en dus de tab) via
     Claudian's eigen renameConversation, zonder het naar Claude te sturen. Capture-fase op
     document = vóór Claudian's eigen Enter-handler. */
  patchRename() {
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const el = e.target;
      if (!el || !(el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const leafEl = el.closest?.('.workspace-leaf-content[data-type="' + VIEW_TYPE + '"]');
      if (!leafEl) return;
      const text = (el.tagName === "TEXTAREA" ? el.value : el.textContent || "").trim();
      const m = text.match(/^\/rename(?:\s+([\s\S]*))?$/);
      if (!m) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const title = (m[1] || "").trim();
      if (!title) { new Notice("Gebruik: /rename <nieuwe titel>"); return; }
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE).find((l) => l.view?.containerEl?.contains(el));
      const tm = leaf?.view?.tabManager;
      const rp = this.app.plugins?.plugins?.realclaudian;
      const claudian = [tm?.plugin, leaf?.view?.plugin, rp, rp?.host, rp?.domains?.conversations]
        .find((o) => o && typeof o.renameConversation === "function");
      try {
        const tabId = tm?.getActiveTabId?.();
        const ident = tm?.membership?.getTabIdentities?.().find((i) => i.id === tabId);
        const convId = ident?.conversationId ?? tm?.getTab?.(tabId)?.conversationId ?? tm?.getTab?.(tabId)?.state?.conversationId;
        if (!convId) { new Notice("Dit gesprek bestaat nog niet: stuur eerst een bericht, dan /rename."); return; }
        if (typeof claudian?.renameConversation !== "function") { new Notice("Claudian rename niet gevonden."); return; }
        Promise.resolve(claudian.renameConversation(convId, title)).then(() => {
          if (el.tagName === "TEXTAREA") el.value = ""; else el.textContent = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          new Notice("Hernoemd: " + title);
        }).catch((err) => { console.warn("[claudian-tab-titles] rename mislukt", err); new Notice("Hernoemen mislukt"); });
      } catch (err) { console.warn("[claudian-tab-titles] rename mislukt", err); }
    }, true);
  }

  items(view) {
    try { return view.tabManager?.getTabBarItems?.() ?? null; } catch (e) { return null; }
  }

  attach(c, view) {
    if (this.containers.has(c)) return;
    const obs = new MutationObserver(() => this.decorateAll(c, view));
    obs.observe(c, { childList: true, subtree: true, characterData: true });
    this.containers.set(c, { view, obs });
    c.classList.add("itabs");
    // Rechtsklik-sluiten van Claudian uitzetten (capture = vóór Claudian's listener).
    c.addEventListener("contextmenu", (e) => {
      if (e.target.closest?.(".claudian-tab-badge")) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  // Indeling (2026-10-21): [tabs][+] ......... [geschiedenis][nieuwe chat]
  // + (nieuwe tab) staat direct achter de laatste tab; nieuwe chat staat helemaal rechts.
  movePlus(c, view) {
    const root = c?.closest(".claudian-input-nav-content") ?? view.containerEl;
    const bar = c?.parentElement ?? root.querySelector(".claudian-input-nav-content");
    const chatBtn = root.querySelector(".claudian-new-conversation-btn");
    const tabBtn = root.querySelector(".claudian-new-tab-btn");
    const actions = root.querySelector(".claudian-input-nav-actions");
    if (bar && tabBtn) {
      const after = c && c.parentElement === bar ? c : null;
      const wanted = after ? after.nextElementSibling : bar.firstElementChild;
      if (tabBtn !== wanted) bar.insertBefore(tabBtn, wanted);
      tabBtn.classList.add("itab-new");
      // Kale plus, geen vierkant: check het echte icoon, niet een vlag
      if (!tabBtn.querySelector("svg.lucide-plus")) {
        try { setIcon(tabBtn, "plus"); } catch (e) {}
      }
    }
    if (actions && chatBtn) {
      if (chatBtn.parentElement !== actions || actions.lastElementChild !== chatBtn) actions.appendChild(chatBtn);
      chatBtn.classList.remove("itab-new");
    }
  }

  close(view, id) {
    try {
      if (typeof view.handleTabClose === "function") return view.handleTabClose(id);
      const tm = view.tabManager;
      return tm?.closeTab?.(id, tm.getTab?.(id)?.state?.isStreaming ?? false);
    } catch (e) { /* stil */ }
  }

  decorateAll(c, view) {
    const badges = Array.from(c.querySelectorAll(":scope > .claudian-tab-badge"));
    const items = this.items(view);
    const matched = Array.isArray(items) && items.length === badges.length;
    badges.forEach((b, i) => this.decorate(b, matched ? items[i] : null, view));
  }

  decorate(b, item, view) {
    const title = item?.title || titleFromLabel(b.getAttribute("aria-label"));
    if (!title) return;
    const id = item?.id ?? "";
    const canClose = !!(item && item.canClose);
    const working = !!(item && item.isWorking);
    b.classList.toggle("itab-working", working && b.classList.contains("claudian-tab-badge-active"));

    // Bezige tab: breedte vastzetten tijdens hover. Het vak rechts groeit dan (spinner + kruisje),
    // de titel krimt binnen de tab en de rest van de tabbalk blijft staan.
    if (!b.dataset.itabLock) {
      b.dataset.itabLock = "1";
      b.addEventListener("mouseenter", () => {
        if (!b.classList.contains("itab-closable")) return;
        if (!b.classList.contains("claudian-tab-badge-streaming") && !b.classList.contains("itab-working")) return;
        b.style.boxSizing = "border-box";
        b.style.width = `${b.getBoundingClientRect().width}px`;
        b.style.flexShrink = "0";
      });
      b.addEventListener("mouseleave", () => {
        b.style.width = "";
        b.style.boxSizing = "";
        b.style.flexShrink = "";
      });
    }

    const key = `${id}|${title}|${canClose}`;
    if (b.dataset.itabKey === key && b.querySelector(":scope > .itab-title")) return;
    b.dataset.itabKey = key;

    const t = document.createElement("span");
    t.className = "itab-title";
    t.textContent = title;
    const slot = document.createElement("span");
    slot.className = "itab-slot";
    const status = document.createElement("span");
    status.className = "itab-status";
    status.setAttribute("aria-hidden", "true");
    slot.append(status);
    if (canClose && id) {
      const x = document.createElement("span");
      x.className = "itab-close";
      x.setAttribute("aria-label", "Sluit tab");
      x.setAttribute("role", "button");
      x.innerHTML = X_SVG;
      x.addEventListener("mousedown", (e) => e.stopPropagation());
      x.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); this.close(view, id); });
      x.addEventListener("dblclick", (e) => e.stopPropagation());
      slot.append(x);
      b.classList.add("itab-closable");
      if (!b.dataset.itabAux) {
        b.dataset.itabAux = "1";
        b.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); this.close(view, id); } });
      }
    } else {
      b.classList.remove("itab-closable");
    }
    b.replaceChildren(t, slot);
    b.classList.add("itab", "claudian-tab-badge-expanded");
  }

  onunload() {
    if (this.voice) this.voiceStop(true);
    document.querySelectorAll(".itab-mic").forEach((b) => b.remove());
    for (const [c, rec] of this.containers) {
      rec.obs.disconnect();
      c.classList.remove("itabs");
      const chatBtn = rec.view?.containerEl?.querySelector(".claudian-new-conversation-btn");
      const tabBtn = rec.view?.containerEl?.querySelector(".claudian-new-tab-btn");
      const home = rec.view?.containerEl?.querySelector(".claudian-input-nav-actions");
      if (home) {
        if (chatBtn) { chatBtn.classList.remove("itab-new"); home.prepend(chatBtn); }
        if (tabBtn) { tabBtn.classList.remove("itab-new"); try { setIcon(tabBtn, "square-plus"); } catch (e) {} home.prepend(tabBtn); }
      }
    }
    this.containers.clear();
  }
};
