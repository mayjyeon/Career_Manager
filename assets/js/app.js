/**
 * 애플리케이션 셸 — 로그인 상태 관리, 사이드바 내비게이션, 화면 전환.
 * 원본의 MainWindow / MainViewModel 에 해당합니다.
 */
import { initFirebase, FirebaseConfigError } from "./firebase.js";
import { signInWithGoogle, signOutUser, watchUser } from "./auth.js";
import { startSync, stopSync } from "./store.js";
import {
  ensureSubscribed,
  isSubscribed,
  profiles,
  startBoardSync,
  stopBoardSync,
} from "./board.js";
import { TEACHER, roleOf } from "./roles.js";
import { closeModal, esc, toast } from "./ui.js";
import * as dashboard from "./views/dashboard.js";
import * as students from "./views/students.js";
import * as counseling from "./views/counseling.js";
import * as notices from "./views/notices.js";
import * as assignments from "./views/assignments.js";
import * as portfolio from "./views/portfolio.js";
import * as studentHome from "./views/student-home.js";
import * as statistics from "./views/statistics.js";
import * as trash from "./views/trash.js";
import { profileFields, readProfileForm } from "./views/profile-form.js";

/** 역할에 따라 보이는 메뉴가 다릅니다. */
const VIEWS = {
  teacher: [dashboard, students, counseling, notices, assignments, portfolio, statistics, trash],
  student: [studentHome, notices, assignments, portfolio, trash],
};

let views = VIEWS.teacher;
let byId = new Map(views.map((v) => [v.meta.id, v]));

function useViews(role) {
  views = VIEWS[role] ?? VIEWS.student;
  byId = new Map(views.map((v) => [v.meta.id, v]));
}

const elements = {
  boot: document.getElementById("boot"),
  bootText: document.getElementById("bootText"),
  authScreen: document.getElementById("authScreen"),
  authError: document.getElementById("authError"),
  googleSignIn: document.getElementById("googleSignIn"),
  setupScreen: document.getElementById("setupScreen"),
  setupMessage: document.getElementById("setupMessage"),
  profileScreen: document.getElementById("profileScreen"),
  profileForm: document.getElementById("profileForm"),
  profileFields: document.getElementById("profileFields"),
  profileError: document.getElementById("profileError"),
  profileSubmit: document.getElementById("profileSubmit"),
  app: document.getElementById("app"),
  nav: document.getElementById("nav"),
  view: document.getElementById("view"),
  title: document.getElementById("topbarTitle"),
  sidebar: document.getElementById("sidebar"),
  scrim: document.getElementById("sidebarScrim"),
  menuToggle: document.getElementById("menuToggle"),
  themeToggle: document.getElementById("themeToggle"),
  signOutBtn: document.getElementById("signOutBtn"),
  userPhoto: document.getElementById("userPhoto"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
};

let currentId = null;
let signedIn = false;
let currentRole = null;

/* =========================================================
   화면 전환(로그인 · 로딩 · 본문)
   ========================================================= */
function showScreen(name, message) {
  elements.boot.hidden = name !== "boot";
  elements.authScreen.hidden = name !== "auth";
  elements.setupScreen.hidden = name !== "setup";
  elements.profileScreen.hidden = name !== "profile";
  elements.app.hidden = name !== "app";

  if (name === "boot" && message) elements.bootText.textContent = message;
}

function showAuthError(message) {
  elements.authError.textContent = message;
  elements.authError.hidden = !message;
}

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

/** 현재 화면만 다시 그립니다(포커스·스크롤은 건드리지 않습니다). */
function renderCurrentView() {
  if (!currentId) return;
  const view = byId.get(currentId) ?? views[0];
  const needs = view.meta.needs ?? [];

  // 화면마다 필요한 자료는 그 화면을 열 때 구독합니다.
  // 로그인하자마자 전부 붙이면 보지도 않을 자료까지 읽어 오게 됩니다.
  if (needs.length > 0 && !isSubscribed(needs)) {
    elements.view.innerHTML = `
      <div class="card card--quiet">
        <p class="muted">불러오는 중…</p>
      </div>`;

    ensureSubscribed(needs).then(scheduleRerender, (error) => {
      elements.view.innerHTML = "";
      toast(
        error?.code === "permission-denied"
          ? "자료에 접근할 권한이 없습니다. Firestore 보안 규칙을 다시 배포해주세요."
          : "자료를 불러오지 못했습니다.",
        "error"
      );
    });
    return;
  }

  elements.view.innerHTML = "";
  view.render(elements.view, { navigate });
}

export function navigate(id, { updateHash = true } = {}) {
  // 다른 역할의 주소로 들어오면 첫 화면으로 보냅니다.
  const view = byId.get(id) ?? views[0];

  currentId = view.meta.id;
  markActive(currentId);
  elements.title.textContent = view.meta.title;
  document.title = `${view.meta.title} · 진로상담 관리`;

  if (updateHash && window.location.hash.slice(1) !== currentId) {
    window.location.hash = currentId;
  }

  renderCurrentView();
  elements.view.focus({ preventScroll: true });

  setSidebar(false);
  window.scrollTo({ top: 0 });
}

/**
 * Firestore 스냅샷이 도착할 때마다 화면을 다시 그립니다.
 * 한 번의 저장으로 여러 스냅샷이 연달아 올 수 있어 한 프레임에 한 번만 처리합니다.
 */
let rerenderQueued = false;

function scheduleRerender() {
  if (rerenderQueued || !signedIn) return;
  rerenderQueued = true;
  requestAnimationFrame(() => {
    rerenderQueued = false;
    if (signedIn) renderCurrentView();
  });
}

/* =========================================================
   로그인
   ========================================================= */
function initAuthUi() {
  elements.googleSignIn.addEventListener("click", async () => {
    showAuthError("");
    elements.googleSignIn.disabled = true;

    try {
      await signInWithGoogle();
      // 다음 단계는 watchUser 콜백이 이어서 처리합니다.
    } catch (error) {
      if (!error.silent) showAuthError(error.message);
    } finally {
      elements.googleSignIn.disabled = false;
    }
  });

  elements.signOutBtn.addEventListener("click", async () => {
    try {
      await signOutUser();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function fillUserBox(user) {
  const name = user.displayName || "이름 없음";
  elements.userName.textContent = name;
  elements.userEmail.textContent = user.email ?? "";

  if (user.photoURL) {
    elements.userPhoto.src = user.photoURL;
    elements.userPhoto.alt = `${name} 프로필 사진`;
    elements.userPhoto.hidden = false;
  } else {
    elements.userPhoto.removeAttribute("src");
    elements.userPhoto.hidden = true;
  }
}

/* =========================================================
   학생 정보 등록(첫 로그인)
   ========================================================= */
/** 학생이 학년·반·번호와 이름을 적을 때까지 앱을 열지 않습니다. */
function askProfile(user) {
  return new Promise((resolve) => {
    elements.profileFields.innerHTML = profileFields(null, user);
    elements.profileError.hidden = true;
    showScreen("profile");
    elements.profileFields.querySelector("input")?.focus();

    const onSubmit = async (event) => {
      event.preventDefault();

      const parsed = readProfileForm(elements.profileForm);
      if (!parsed.ok) {
        elements.profileError.textContent = parsed.error;
        elements.profileError.hidden = false;
        return;
      }

      elements.profileSubmit.disabled = true;

      try {
        await profiles.save(user.uid, { ...parsed.values, email: user.email ?? null });
        elements.profileForm.removeEventListener("submit", onSubmit);
        resolve();
      } catch (error) {
        elements.profileError.textContent =
          error?.code === "permission-denied"
            ? "저장할 권한이 없습니다. 선생님께 Firestore 보안 규칙 배포를 요청해주세요."
            : (error?.message ?? "저장하지 못했습니다.");
        elements.profileError.hidden = false;
      } finally {
        elements.profileSubmit.disabled = false;
      }
    };

    elements.profileForm.addEventListener("submit", onSubmit);
  });
}

/* =========================================================
   로그인 상태
   ========================================================= */
let sessionToken = 0;

/** 역할에 맞는 자료를 구독합니다. */
async function loadData(user, role) {
  // 상담 기록은 선생님 계정에만 있습니다.
  if (role === TEACHER) {
    await startSync(user.uid, {
      onChange: scheduleRerender,
      onError: (message) => toast(message, "error"),
    });
  }

  await startBoardSync(user.uid, role, {
    onChange: scheduleRerender,
    onError: (message) => toast(message, "error"),
  });
}

async function handleUserChange(user) {
  const token = ++sessionToken;

  if (!user) {
    signedIn = false;
    currentId = null;
    currentRole = null;
    stopSync();
    stopBoardSync();
    closeModal();
    showScreen("auth");
    return;
  }

  const role = roleOf(user);
  showScreen("boot", role === TEACHER ? "상담 기록을 불러오는 중…" : "공지와 과제를 불러오는 중…");

  try {
    await loadData(user, role);
  } catch (error) {
    if (token !== sessionToken) return;
    showAuthError(
      error?.code === "permission-denied"
        ? "데이터 접근 권한이 없습니다. Firestore 보안 규칙을 확인해주세요."
        : "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요."
    );
    showScreen("auth");
    await signOutUser().catch(() => {});
    return;
  }

  // 로딩 중에 로그아웃했다면 이 결과는 버립니다.
  if (token !== sessionToken) return;

  // 학생은 자기가 몇 학년 몇 반인지 알려줘야 공지와 과제를 받아 볼 수 있습니다.
  if (role !== TEACHER && !profiles.mine()) {
    await askProfile(user);
    if (token !== sessionToken) return;
  }

  currentRole = role;
  useViews(role);
  renderNav();

  signedIn = true;
  fillUserBox(user);
  showAuthError("");
  showScreen("app");
  navigate(window.location.hash.slice(1) || views[0].meta.id, { updateHash: false });
}

/* =========================================================
   시작
   ========================================================= */
async function start() {
  window.appDidLoad?.();

  initTheme();
  initSidebar();
  initAuthUi();
  renderNav();

  window.addEventListener("hashchange", () => {
    if (!signedIn) return;
    const id = window.location.hash.slice(1);
    if (id !== currentId) navigate(id, { updateHash: false });
  });

  try {
    await initFirebase();
  } catch (error) {
    if (error instanceof FirebaseConfigError) {
      elements.setupMessage.textContent = error.message;
      showScreen("setup");
    } else {
      elements.setupMessage.textContent =
        "Firebase 를 초기화하지 못했습니다. 네트워크 연결과 설정값을 확인해주세요.";
      showScreen("setup");
    }
    return;
  }

  watchUser(handleUserChange);
}

start();
