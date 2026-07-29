/**
 * tool.js — AI Prompt Middleware
 * Refactored: Proxy State Management & Lazy Loading
 */

"use strict";

const MODELS = {
  "claude-opus-4-6":   { label: "Claude Opus 4.6",   provider: "Claude",   free: false },
  "claude-sonnet-4-6": { label: "Claude Sonnet 4.6",  provider: "Claude",   free: false },
  "claude-haiku-4-5":  { label: "Claude Haiku 4.5",   provider: "Claude",   free: false },
  "gpt-5.2":           { label: "GPT-5.2",            provider: "ChatGPT",  free: true  },
  "gpt-5.2-mini":      { label: "GPT-5.2 Mini",       provider: "ChatGPT",  free: true  },
  "o3-pro":            { label: "o3 Pro",             provider: "ChatGPT",  free: false },
  "o3":                { label: "o3",                 provider: "ChatGPT",  free: false },
  "gpt-5.3-codex":     { label: "Codex 5.3",          provider: "ChatGPT",  free: false },
  "gemini-3.1-pro":    { label: "Gemini 3.1 Pro",     provider: "Gemini",   free: false },
  "gemini-3-flash":    { label: "Gemini 3 Flash",     provider: "Gemini",   free: true  },
  "gemini-2.5-pro":    { label: "Gemini 2.5 Pro",     provider: "Gemini",   free: false },
  "gemini-2.5-flash":  { label: "Gemini 2.5 Flash",   provider: "Gemini",   free: true  },
  "deepseek-v3.2":     { label: "DeepSeek V3.2",      provider: "DeepSeek", free: true  },
  "deepseek-v3.1":     { label: "DeepSeek V3.1",      provider: "DeepSeek", free: true  },
  "deepseek-r1":       { label: "DeepSeek R1",        provider: "DeepSeek", free: true  },
  "grok-3":            { label: "Grok 3",             provider: "Grok",     free: false },
  "grok-3-mini":       { label: "Grok 3 Mini",        provider: "Grok",     free: true  },
  "copilot-web":       { label: "Copilot Web",        provider: "Copilot",  free: true  },
  "copilot-pro":       { label: "Copilot Pro",        provider: "Copilot",  free: false },
};

const ALL_MODEL_IDS  = Object.keys(MODELS);
const FREE_MODEL_IDS = ALL_MODEL_IDS.filter(id => MODELS[id].free);
const PRO_MODEL_IDS  = ALL_MODEL_IDS.filter(id => !MODELS[id].free);
const ALL_PROVIDERS  = ["Claude", "ChatGPT", "Gemini", "DeepSeek", "Grok", "Copilot"];

const STYLES = [
  { id: "Professional",   icon: "💼" },
  { id: "Nerdy",          icon: "🤓" },
  { id: "Creative",       icon: "🎨" },
  { id: "Direct",         icon: "⚡" },
  { id: "Academic",       icon: "📚" },
  { id: "Code",           icon: "💻" },
  { id: "Analysis",       icon: "🔍" },
  { id: "Marketing",      icon: "📣" }
];

const GROUPED = {};
ALL_PROVIDERS.forEach(p => { GROUPED[p] = []; });
ALL_MODEL_IDS.forEach(id => GROUPED[MODELS[id].provider].push(id));

const API_BASE = "http://127.0.0.1:8000";

// ─────────────────────────────────────────────────────────────────────────────
// STATE MANAGEMENT (PROXY)
// ─────────────────────────────────────────────────────────────────────────────

const rawState = {
  input:         "",
  refined:       null,
  suggestion:    null,
  loading:       false,
  suggesting:    false,
  activeStyle:   "Professional",
  targetModel:   null,
  activeTab:     "formatted",
  showAutoPanel: false,
  showStyleDropdown: false,
  showModelDropdown: false,
  enabledModels: new Set(FREE_MODEL_IDS),
  tierView:      "all",
};

const state = new Proxy(rawState, {
  set(target, property, value) {
    if (target[property] !== value) {
      target[property] = value;
      requestAnimationFrame(() => updateUI(property));
    }
    return true;
  }
});

// Helper for Set mutations to trigger proxy
function setEnabledModels(newSet) {
  state.enabledModels = newSet;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  textarea:            $("promptTextarea"),
  btnRefine:           $("btnRefine"),
  btnAutoTrigger:      $("btnAutoTrigger"),
  autoPanel:           $("autoPanel"),
  autoPanelWrapper:    $("autoPanelWrapper"),
  proToggle:           $("proToggle"),
  tierTabs:            $("tierTabs"),
  autoModelList:       $("autoModelList"),
  enabledCount:        $("enabledCount"),
  btnFindBest:         $("btnFindBest"),
  modelDropdownWrapper: $("modelDropdownWrapper"),
  modelDropdownTrigger: $("modelDropdownTrigger"),
  modelDropdownMenu:    $("modelDropdownMenu"),
  modelDot:             $("modelDot"),
  modelTriggerLabel:    $("modelTriggerLabel"),
  styleDropdownWrapper: $("styleDropdownWrapper"),
  styleDropdownTrigger: $("styleDropdownTrigger"),
  styleDropdownMenu:    $("styleDropdownMenu"),
  styleIcon:            $("styleIcon"),
  suggestionOverlay:   $("suggestionOverlay"),
  suggestionFreeBadge: $("suggestionFreeBadge"),
  suggestionModelName: $("suggestionModelName"),
  suggestionReason:    $("suggestionReason"),
  suggestionStrengths: $("suggestionStrengths"),
  btnUseModel:         $("btnUseModel"),
  btnDismiss:          $("btnDismiss"),
  emptyState:          $("emptyState"),
  emptyIcon:           $("emptyIcon"),
  emptyMsg:            $("emptyMsg"),
  tabFormatted:        $("tabFormatted"),
  tabStructured:       $("tabStructured"),
  formattedPre:        $("formattedPre"),
  structuredBody:      $("structuredBody"),
  outputBody:          document.querySelector(".output-body"),
  btnCopy:             $("btnCopy"),
  waitingMsg:          $("waitingMsg"),
  modelFooterInfo:     $("modelFooterInfo"),
  footerDot:           $("footerDot"),
  footerText:          $("footerText"),
};

// Lazy loading flags
let modelDropdownRendered = false;
let styleDropdownRendered = false;
let autoPanelRendered = false;

// ─────────────────────────────────────────────────────────────────────────────
// REACTIVE UI UPDATES
// ─────────────────────────────────────────────────────────────────────────────

function updateUI(changedProp) {
  if (["input", "targetModel", "loading"].includes(changedProp)) renderRefineButton();
  if (["input", "showAutoPanel"].includes(changedProp)) renderAutoButton();
  
  if (["showAutoPanel", "showModelDropdown", "showStyleDropdown"].includes(changedProp)) {
    applyDropdownVisibility();
  }
  
  if (changedProp === "targetModel") renderModelTrigger();
  if (changedProp === "activeStyle") renderStyleTrigger();
  if (["refined", "activeTab", "targetModel"].includes(changedProp)) renderOutput();
  if (changedProp === "suggestion") renderSuggestion();
  if (["enabledModels", "tierView"].includes(changedProp)) {
    if (autoPanelRendered) renderAutoModelList();
    renderAutoPanelFooter();
  }
  if (changedProp === "activeTab") renderTabs();
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function setVisible(el, visible) {
  if (visible) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

function renderRefineButton() {
  const canRefine = state.targetModel !== null && state.input.trim().length > 0;
  els.btnRefine.disabled = !canRefine || state.loading;
  els.btnRefine.textContent = state.loading ? "Refining Magic..." : (state.targetModel ? "Optimize Prompt ✨" : "Pick a Model First");
  els.btnRefine.classList.toggle("loading", state.loading);
}

function renderAutoButton() {
  els.btnAutoTrigger.disabled = state.input.trim().length === 0;
  els.btnAutoTrigger.classList.toggle("open", state.showAutoPanel);
  els.btnAutoTrigger.setAttribute("aria-expanded", String(state.showAutoPanel));
}

function renderModelTrigger() {
  const id = state.targetModel;
  if (id) {
    const providerClass = `var(--c-${MODELS[id].provider.toLowerCase()}-bg)`;
    setVisible(els.modelDot, true);
    els.modelDot.style.background = `var(--c-${MODELS[id].provider.toLowerCase()}-dot)`;
    els.modelTriggerLabel.textContent = MODELS[id].label;
    els.modelDropdownTrigger.style.background = providerClass;
    els.modelDropdownTrigger.style.borderColor = `var(--c-${MODELS[id].provider.toLowerCase()}-bdr)`;
    els.modelDropdownTrigger.style.color = `var(--c-${MODELS[id].provider.toLowerCase()}-text)`;
  } else {
    setVisible(els.modelDot, false);
    els.modelTriggerLabel.textContent = "Select Target";
    els.modelDropdownTrigger.style.background = "";
    els.modelDropdownTrigger.style.borderColor = "";
    els.modelDropdownTrigger.style.color = "";
  }
}

function renderStyleTrigger() {
  const styleObj = STYLES.find(s => s.id === state.activeStyle);
  if (styleObj) els.styleIcon.textContent = styleObj.icon;
  if (styleDropdownRendered) renderStyleDropdownList();
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    const active = btn.dataset.tab === state.activeTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}

function applyDropdownVisibility() {
  setVisible(els.autoPanel, state.showAutoPanel);
  setVisible(els.styleDropdownMenu, state.showStyleDropdown);
  setVisible(els.modelDropdownMenu, state.showModelDropdown);
  
  els.styleDropdownTrigger.classList.toggle("open", state.showStyleDropdown);
  els.styleDropdownTrigger.setAttribute("aria-expanded", String(state.showStyleDropdown));
  
  els.modelDropdownTrigger.classList.toggle("open", state.showModelDropdown);
  els.modelDropdownTrigger.setAttribute("aria-expanded", String(state.showModelDropdown));
}

// ── Lazy Rendered Components ──

function renderModelDropdownList() {
  els.modelDropdownMenu.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "dropdown-inner custom-scrollbar";

  ALL_PROVIDERS.forEach(provider => {
    const ids = GROUPED[provider] ?? [];
    if (!ids.length) return;
    
    const groupLabel = document.createElement("p");
    groupLabel.className = "dropdown-group-label";
    groupLabel.textContent = provider;
    inner.appendChild(groupLabel);

    ids.forEach(id => {
      const isSelected = state.targetModel === id;
      const isPaid = !MODELS[id].free;
      const shortLabel = MODELS[id].label.replace(provider + " ", "");

      const btn = document.createElement("button");
      btn.className = "model-option" + (isSelected ? " selected" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", String(isSelected));
      
      if (isSelected) {
        btn.style.background = `var(--c-${provider.toLowerCase()}-bg)`;
        btn.style.borderColor = `var(--c-${provider.toLowerCase()}-bdr)`;
        btn.style.color = `var(--c-${provider.toLowerCase()}-text)`;
      }

      const nameSpan = document.createElement("span");
      nameSpan.textContent = shortLabel;
      btn.appendChild(nameSpan);

      if (isPaid) {
        const badge = document.createElement("span");
        badge.className = "pro-badge-small";
        badge.textContent = "PRO";
        btn.appendChild(badge);
      }

      btn.addEventListener("click", () => {
        state.targetModel = id;
        state.refined = null;
        closeAllDropdowns();
        renderModelDropdownList(); // Update selected state visual
      });
      inner.appendChild(btn);
    });
  });
  els.modelDropdownMenu.appendChild(inner);
}

function renderStyleDropdownList() {
  els.styleDropdownMenu.innerHTML = "";
  const lbl = document.createElement("p");
  lbl.className = "dropdown-section-label";
  lbl.textContent = "Prompt Style";
  els.styleDropdownMenu.appendChild(lbl);

  STYLES.forEach(s => {
    const btn = document.createElement("button");
    btn.className = "style-option" + (s.id === state.activeStyle ? " active" : "");
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(s.id === state.activeStyle));
    btn.innerHTML = `<span style="font-size:0.875rem">${s.icon}</span>${s.id}`;
    
    btn.addEventListener("click", () => {
      state.activeStyle = s.id;
      closeAllDropdowns();
    });
    els.styleDropdownMenu.appendChild(btn);
  });
}

function renderAutoModelList() {
  els.autoModelList.innerHTML = "";
  const visibleIds = ALL_MODEL_IDS.filter(id => {
    if (state.tierView === "free") return MODELS[id].free;
    if (state.tierView === "paid") return !MODELS[id].free;
    return true;
  });

  ALL_PROVIDERS.forEach(provider => {
    const ids = (GROUPED[provider] ?? []).filter(id => visibleIds.includes(id));
    if (!ids.length) return;

    const group = document.createElement("div");
    group.className = "auto-provider-group";
    
    const label = document.createElement("p");
    label.className = "auto-provider-label";
    label.textContent = provider;
    group.appendChild(label);

    const chips = document.createElement("div");
    chips.className = "auto-chips";

    ids.forEach(id => {
      const on = state.enabledModels.has(id);
      const isPaid = !MODELS[id].free;
      const shortLabel = MODELS[id].label.replace(provider + " ", "");

      const chip = document.createElement("button");
      chip.className = "model-chip" + (on ? " active" : "");
      
      if (on) {
        chip.style.background = `var(--c-${provider.toLowerCase()}-bg)`;
        chip.style.borderColor = `var(--c-${provider.toLowerCase()}-bdr)`;
        chip.style.color = `var(--c-${provider.toLowerCase()}-text)`;
      }

      chip.appendChild(document.createTextNode(shortLabel));
      if (isPaid) {
        const proSpan = document.createElement("span");
        proSpan.className = "chip-pro";
        proSpan.textContent = "PRO";
        if(on) proSpan.style.color = `var(--c-${provider.toLowerCase()}-text)`;
        chip.appendChild(proSpan);
      }

      chip.addEventListener("click", () => {
        const newSet = new Set(state.enabledModels);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setEnabledModels(newSet);
      });
      chips.appendChild(chip);
    });
    group.appendChild(chips);
    els.autoModelList.appendChild(group);
  });
}

function renderAutoPanelFooter() {
  els.enabledCount.textContent = `${state.enabledModels.size} selected`;
  els.btnFindBest.disabled = state.suggesting || state.enabledModels.size === 0;
  
  const allProSelected = PRO_MODEL_IDS.every(id => state.enabledModels.has(id));
  els.proToggle.setAttribute("aria-checked", String(allProSelected));
  
  els.tierTabs.querySelectorAll(".tier-tab").forEach(btn => {
    const active = btn.dataset.tier === state.tierView;
    btn.setAttribute("aria-selected", String(active));
  });
}

// ── Output Rendering ──

function renderOutput() {
  const hasOutput = state.refined !== null;
  setVisible(els.emptyState, !hasOutput);
  setVisible(els.tabFormatted, hasOutput && state.activeTab === "formatted");
  setVisible(els.tabStructured, hasOutput && state.activeTab === "structured");
  setVisible(els.btnCopy, hasOutput);

  if (!hasOutput) {
    els.emptyIcon.querySelector("span").textContent = state.targetModel ? "✨" : "🎯";
    els.emptyMsg.textContent = state.targetModel ? "Ready to optimize your prompt." : "Select a model or use Auto to begin.";
    
    setVisible(els.waitingMsg, true);
    setVisible(els.modelFooterInfo, false);
    return;
  }

  const r = state.refined;
  els.formattedPre.textContent = r.formatted_prompt;

  els.structuredBody.innerHTML = "";
  const fields = [
    { label: "Role",   value: r.role,   color: "var(--accent)"  },
    { label: "Task",   value: r.task,   color: "var(--text)"  },
    { label: "Format", value: r.format, color: "var(--muted)"  },
  ];
  fields.forEach(({ label, value, color }) => {
    const wrap = document.createElement("div");
    const lbl = document.createElement("p");
    lbl.className = "structured-field-label";
    lbl.style.color = color;
    lbl.textContent = label;
    wrap.appendChild(lbl);
    
    const val = document.createElement("p");
    val.className = "structured-field-value";
    val.textContent = value;
    wrap.appendChild(val);
    els.structuredBody.appendChild(wrap);
  });

  const constraintsWrap = document.createElement("div");
  const constraintsLbl = document.createElement("p");
  constraintsLbl.className = "structured-field-label";
  constraintsLbl.textContent = "Constraints";
  constraintsWrap.appendChild(constraintsLbl);

  const ul = document.createElement("ul");
  ul.className = "constraints-list";
  (r.constraints || []).forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "constraint-item";
    li.innerHTML = `<span class="constraint-num">${i + 1}.</span><span>${c}</span>`;
    ul.appendChild(li);
  });
  constraintsWrap.appendChild(ul);
  els.structuredBody.appendChild(constraintsWrap);

  els.outputBody.scrollTop = 0;
  
  // Footer
  const id = state.targetModel;
  if(id) {
    const prov = MODELS[id].provider.toLowerCase();
    els.footerDot.style.background = `var(--c-${prov}-dot)`;
    els.footerText.innerHTML = `Formatted for <strong style="color:var(--c-${prov}-label)">${MODELS[id].label}</strong>`;
    setVisible(els.waitingMsg, false);
    setVisible(els.modelFooterInfo, true);
  }
}

function renderSuggestion() {
  const s = state.suggestion;
  if (!s) {
    setVisible(els.suggestionOverlay, false);
    return;
  }
  setVisible(els.suggestionOverlay, true);

  const modelLabel = MODELS[s.recommended_model]?.label ?? s.recommended_model;
  els.suggestionModelName.textContent = modelLabel;
  els.suggestionReason.textContent = s.reason;
  s.is_free ? setVisible(els.suggestionFreeBadge, true) : setVisible(els.suggestionFreeBadge, false);

  els.suggestionStrengths.innerHTML = "";
  (s.strengths ?? []).forEach(str => {
    const tag = document.createElement("span");
    tag.className = "strength-tag";
    tag.textContent = str;
    els.suggestionStrengths.appendChild(tag);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DROPDOWN MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

function closeAllDropdowns() {
  state.showAutoPanel = false;
  state.showStyleDropdown = false;
  state.showModelDropdown = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// API CALLS
// ─────────────────────────────────────────────────────────────────────────────

async function handleRefine() {
  if (!state.targetModel || state.loading) return;
  state.loading = true;

  try {
    const res = await fetch(`${API_BASE}/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_input:   state.input,
        style:        state.activeStyle,
        target_model: state.targetModel,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    
    state.refined = await res.json();
    state.activeTab = "formatted";
  } catch (err) {
    console.error("[REFINE ERROR]", err);
    alert("Failed to connect to the backend. Make sure FastAPI server is running on :8000");
  } finally {
    state.loading = false;
  }
}

async function handleSuggest() {
  if (state.suggesting || state.enabledModels.size === 0 || !state.input.trim()) return;
  state.suggesting = true;
  closeAllDropdowns();
  
  els.btnFindBest.textContent = "Analyzing...";
  els.btnFindBest.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/suggest-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_input:     state.input,
        budget:         "both",
        allowed_models: [...state.enabledModels],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    state.suggestion = await res.json();
  } catch (err) {
    console.error("[SUGGEST ERROR]", err);
    alert("Failed to connect to backend.");
  } finally {
    state.suggesting = false;
    els.btnFindBest.textContent = "Find Best";
  }
}

async function handleCopy() {
  if (!state.refined) return;
  const r = state.refined;
  const text = state.activeTab === "formatted"
    ? r.formatted_prompt
    : `ROLE: ${r.role}\n\nTASK: ${r.task}\n\nFORMAT: ${r.format}\n\nCONSTRAINTS:\n${(r.constraints || []).map(c => `- ${c}`).join("\n")}`;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  els.btnCopy.textContent = "✓ Copied!";
  setTimeout(() => { els.btnCopy.textContent = "Copy"; }, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

els.textarea.addEventListener("input", () => state.input = els.textarea.value);
els.btnRefine.addEventListener("click", handleRefine);

els.btnAutoTrigger.addEventListener("click", () => {
  state.showAutoPanel = !state.showAutoPanel;
  state.showStyleDropdown = false;
  state.showModelDropdown = false;
  if(state.showAutoPanel && !autoPanelRendered) {
    renderAutoModelList();
    renderAutoPanelFooter();
    autoPanelRendered = true;
  }
});

els.modelDropdownTrigger.addEventListener("click", () => {
  state.showModelDropdown = !state.showModelDropdown;
  state.showStyleDropdown = false;
  state.showAutoPanel = false;
  if(state.showModelDropdown && !modelDropdownRendered) {
    renderModelDropdownList();
    modelDropdownRendered = true;
  }
});

els.styleDropdownTrigger.addEventListener("click", () => {
  state.showStyleDropdown = !state.showStyleDropdown;
  state.showModelDropdown = false;
  state.showAutoPanel = false;
  if(state.showStyleDropdown && !styleDropdownRendered) {
    renderStyleDropdownList();
    styleDropdownRendered = true;
  }
});

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => state.activeTab = btn.dataset.tab);
});

els.btnCopy.addEventListener("click", handleCopy);

els.proToggle.addEventListener("click", () => {
  const allProSelected = PRO_MODEL_IDS.every(id => state.enabledModels.has(id));
  const newSet = new Set(state.enabledModels);
  if (allProSelected) PRO_MODEL_IDS.forEach(id => newSet.delete(id));
  else PRO_MODEL_IDS.forEach(id => newSet.add(id));
  setEnabledModels(newSet);
});

els.tierTabs.addEventListener("click", e => {
  const btn = e.target.closest(".tier-tab");
  if (btn) state.tierView = btn.dataset.tier;
});

els.btnFindBest.addEventListener("click", handleSuggest);

els.btnUseModel.addEventListener("click", () => {
  if (!state.suggestion) return;
  state.targetModel = state.suggestion.recommended_model;
  state.refined = null;
  state.suggestion = null;
});

els.btnDismiss.addEventListener("click", () => state.suggestion = null);

document.addEventListener("mousedown", e => {
  let changed = false;
  if (state.showModelDropdown && !els.modelDropdownWrapper.contains(e.target)) { state.showModelDropdown = false; changed = true; }
  if (state.showStyleDropdown && !els.styleDropdownWrapper.contains(e.target)) { state.showStyleDropdown = false; changed = true; }
  if (state.showAutoPanel && !els.autoPanelWrapper.contains(e.target)) { state.showAutoPanel = false; changed = true; }
});

document.addEventListener("keydown", e => { if (e.key === "Escape") closeAllDropdowns(); });

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISE
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  updateUI("targetModel");
  updateUI("activeStyle");
  updateUI("activeTab");
  updateUI("input");
  updateUI("refined");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}