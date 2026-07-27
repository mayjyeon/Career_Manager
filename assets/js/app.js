/**
 * 애플리케이션 셸 — 사이드바 내비게이션과 화면 전환을 담당합니다.
 * 원본의 MainWindow / MainViewModel 에 해당합니다.
 */
import { seedIfEmpty } from "./store.js";
import { esc } from "./ui.js";
import * as dashboard from "./views/dashboard.js";
import * as students from "./views/students.js";
import * as counseling from "./views/counseling.js";
import { calendar, statistics } from "./views/placeholder.js";

const views = [dashboard, students, counseling, calendar, statistics];
const byId = new Map(views.map((v) => [v.meta.id, v]));

const elements = {
  nav: document.getElementById("nav"),
  view: document.getElementById("view"),
  title: document.getElementById("topbarTitle"),
  sidebar: document.getElementById("sidebar"),
  scrim: document.getElementById("sidebarScrim"),
  menuToggle: document.getElementById("menuToggle"),
  themeToggle: document.getElementById("themeToggle"),
};

let currentId = null;

/* =========================================================
   테마
   ========================================================= */
const THEME_KEY = "career-manager.theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 저장할 수 없으면 이번 세션에만 적용됩니다. */
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* 무시 */
  }

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(saved ?? (prefersDark ? "dark" : "light"));

  elements.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

/* =========================================================
   사이드바(모바일)
   ========================================================= */
function setSidebar(open) {
  elements.sidebar.classList.toggle("is-open", open);
  elements.scrim.hidden = !open;
}

function initSidebar() {
  elements.menuToggle.addEventListener("click", () => setSidebar(true));
  elements.scrim.addEventListener("click", () => setSidebar(false));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSidebar(false);
  });
}

/* =========================================================
   내비게이션
   ========================================================= */
function renderNav() {
  elements.nav.innerHTML = views
    .map(
      ({ meta }) => `
        <button class="nav__item" type="button" data-view="${meta.id}">
          <span class="nav__icon" aria-hidden="true">${meta.icon}</span>
          <span>${esc(meta.title)}</span>
        </button>`
    )
    .join("");

  elements.nav.querySelectorAll("[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => navigate(btn.dataset.view))
  );
}

function markActive(id) {
  elements.nav.querySelectorAll("[data-view]").forEach((btn) => {
    if (btn.dataset.view === id) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

export function navigate(id, { updateHash = true } = {}) {
  const view = byId.get(id) ?? dashboard;

  currentId = view.meta.id;
  markActive(currentId);
  elements.title.textContent = view.meta.title;
  document.title = `${view.meta.title} · 진로상담 관리`;

  if (updateHash && window.location.hash.slice(1) !== currentId) {
    window.location.hash = currentId;
  }

  elements.view.innerHTML = "";
  view.render(elements.view, { navigate });
  elements.view.focus({ preventScroll: true });

  setSidebar(false);
  window.scrollTo({ top: 0 });
}

/* =========================================================
   시작
   ========================================================= */
function start() {
  seedIfEmpty();
  initTheme();
  initSidebar();
  renderNav();

  window.addEventListener("hashchange", () => {
    const id = window.location.hash.slice(1);
    if (id !== currentId) navigate(id, { updateHash: false });
  });

  navigate(window.location.hash.slice(1) || "dashboard");
}

start();
