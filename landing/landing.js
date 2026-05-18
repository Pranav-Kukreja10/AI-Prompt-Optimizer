/**
 * landing.js — PromptForge Landing Page
 * Updated with correct product content and enhanced interactions.
 */

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS = [
  { name: "Claude",   color: "#e8652a" },
  { name: "ChatGPT",  color: "#10a37f" },
  { name: "Gemini",   color: "#4285f4" },
  { name: "DeepSeek", color: "#e63946" },
  { name: "Grok",     color: "#8b5cf6" },
  { name: "Copilot",  color: "#06b6d4" },
];

// ─────────────────────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────────────────────

function getStoredTheme() {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark")  return true;
    if (stored === "light") return false;
  } catch (_) {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function persistTheme(dark) {
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (_) {}
}

let isDark = getStoredTheme();

function applyTheme() {
  document.body.classList.toggle("dark",  isDark);
  document.body.classList.toggle("light", !isDark);

  const thumb = document.getElementById("themeThumb");
  const icon  = document.getElementById("themeIcon");
  if (thumb) thumb.style.left = isDark ? "22px" : "2px";
  if (icon)  icon.textContent  = isDark ? "🌙" : "☀️";

  const btn = document.getElementById("themeToggle");
  if (btn) btn.setAttribute("aria-checked", String(isDark));

  const mainTexts = [
    document.getElementById("heroTextMain"),
    document.getElementById("heroTextMain2"),
  ];
  mainTexts.forEach(el => {
    if (el) el.setAttribute("fill", `url(#${isDark ? "gradDark" : "gradLight"})`);
  });

  restartCanvas();
}

function toggleTheme() {
  isDark = !isDark;
  persistTheme(isDark);
  applyTheme();
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE CANVAS
// ─────────────────────────────────────────────────────────────────────────────

let canvasRAF     = null;
let canvasCleanup = null;

function restartCanvas() {
  if (canvasCleanup) canvasCleanup();
  initCanvas();
}

function initCanvas() {
  const canvas = document.getElementById("particleCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let W = window.innerWidth;
  let H = window.innerHeight;
  canvas.width  = W;
  canvas.height = H;

  const COUNT   = W < 768 ? 60 : 130;
  const CONNECT = 160;
  const REPEL_R = 120;

  const pts = Array.from({ length: COUNT }, () => ({
    x:       Math.random() * W,
    y:       Math.random() * H,
    vx:      (Math.random() - 0.5) * 0.8,
    vy:      (Math.random() - 0.5) * 0.8,
    r:       Math.random() * 2.2 + 0.8,
    hue:     Math.random() * 60 + 220,
    opacity: Math.random() * 0.5 + 0.4,
  }));

  let mx = W / 2, my = H / 2;
  const onMouseMove = e => { mx = e.clientX; my = e.clientY; };
  window.addEventListener("mousemove", onMouseMove);

  const frame = () => {
    ctx.clearRect(0, 0, W, H);

    for (const p of pts) {
      const dx = p.x - mx, dy = p.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < REPEL_R && dist > 0) {
        const force = (REPEL_R - dist) / REPEL_R;
        p.vx += (dx / dist) * force * 0.35;
        p.vy += (dy / dist) * force * 0.35;
      }
      p.vx *= 0.985; p.vy *= 0.985;
      p.x  += p.vx;  p.y  += p.vy;

      if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
      if (p.x > W) { p.x = W; p.vx = -Math.abs(p.vx); }
      if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
      if (p.y > H) { p.y = H; p.vy = -Math.abs(p.vy); }

      const col = isDark
        ? `hsla(${p.hue},80%,65%,${p.opacity})`
        : `hsla(${p.hue},70%,45%,${p.opacity * 0.7})`;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }

    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < CONNECT) {
          const alpha = (1 - d / CONNECT) * (isDark ? 0.25 : 0.12);
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = isDark
            ? `rgba(139,92,246,${alpha})`
            : `rgba(79,70,229,${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    canvasRAF = requestAnimationFrame(frame);
  };
  frame();

  const onResize = () => {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W; canvas.height = H;
  };
  window.addEventListener("resize", onResize);

  canvasCleanup = () => {
    cancelAnimationFrame(canvasRAF);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("resize", onResize);
    canvasCleanup = null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV SCROLL SHADOW
// ─────────────────────────────────────────────────────────────────────────────

function initNavScroll() {
  const nav = document.getElementById("mainNav");
  if (!nav) return;
  const update = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  window.addEventListener("scroll", update, { passive: true });
  update();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCROLL REVEAL
// ─────────────────────────────────────────────────────────────────────────────

function initScrollReveal() {
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el    = entry.target;
        const delay = el.dataset.delay ?? "0";
        el.style.transitionDelay = `${delay}ms`;
        el.classList.add("revealed");
        observer.unobserve(el);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -48px 0px" }
  );
  document.querySelectorAll(".sr").forEach(el => observer.observe(el));
}

// ─────────────────────────────────────────────────────────────────────────────
// TICKER
// ─────────────────────────────────────────────────────────────────────────────

function initTicker() {
  const track = document.getElementById("tickerTrack");
  if (!track) return;

  const items = [...PROVIDERS, ...PROVIDERS, ...PROVIDERS, ...PROVIDERS];
  items.forEach(p => {
    const wrap = document.createElement("div");
    wrap.className = "ticker-item";

    const dot = document.createElement("div");
    dot.className = "ticker-dot";
    dot.style.background = p.color;
    dot.style.boxShadow  = `0 0 10px ${p.color}`;

    const name = document.createElement("span");
    name.className   = "ticker-name";
    name.textContent = p.name;

    wrap.appendChild(dot);
    wrap.appendChild(name);
    track.appendChild(wrap);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA BUTTON STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

let btnState = "idle";

function setBtnState(state) {
  btnState = state;
  const buttons = [
    document.getElementById("btnPrimary"),
    document.getElementById("btnNavCta"),
    document.getElementById("btnCtaMain"),
  ];

  buttons.forEach(btn => {
    if (!btn) return;
    if (btn.id === "btnNavCta") return;

    btn.disabled = state !== "idle";

    if (state === "idle") {
      btn.classList.remove("loading", "success");
      btn.innerHTML = "⚡ Initialize Middleware";
    } else if (state === "loading") {
      btn.classList.add("loading");
      btn.classList.remove("success");
      btn.innerHTML = `<span class="btn-spinner"></span>`;
    } else if (state === "success") {
      btn.classList.remove("loading");
      btn.classList.add("success");
      btn.innerHTML = "✓ Ready — Opening...";
    }
  });
}

function handleInitialization() {
  if (btnState !== "idle") return;
  setBtnState("loading");
  setTimeout(() => {
    setBtnState("success");
    setTimeout(() => {
      window.location.href = "../tool/index.html";
    }, 600);
  }, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

function initEvents() {
  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  const ctaIds = ["btnPrimary", "btnNavCta", "btnCtaMain"];
  ctaIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", handleInitialization);
  });

  const secBtn = document.getElementById("btnSecondary");
  if (secBtn) secBtn.addEventListener("click", () => {
    document.getElementById("how")?.scrollIntoView({ behavior: "smooth" });
  });

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("mouseenter", () => {
      link.style.color = getComputedStyle(document.body).getPropertyValue("--text").trim();
    });
    link.addEventListener("mouseleave", () => {
      link.style.color = "";
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  applyTheme();
  initNavScroll();
  initTicker();
  initScrollReveal();
  initEvents();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}