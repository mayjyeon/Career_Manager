/** 화면 구성을 돕는 작은 유틸리티 모음. */

/** HTML 특수문자를 이스케이프합니다(사용자 입력을 그대로 넣을 때 사용). */
export function esc(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** yyyy-MM-dd 형식으로 변환합니다. */
export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "오늘", "3일 전" 같은 상대 표기. */
export function relativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86400000);

  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  if (days > 1 && days < 7) return `${days}일 전`;
  return formatDate(date);
}

/** 이름에서 아바타에 쓸 글자를 뽑습니다. */
export function initials(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  // 한글 이름은 성을 제외한 이름 부분을 사용합니다.
  return /[가-힣]/.test(trimmed) ? trimmed.slice(-2) : trimmed.slice(0, 1).toUpperCase();
}

/**
 * 상담 주제에 따라 배지 색을 정합니다.
 * 진로상담총괄표에 칸이 있는 진로·진학만 색을 나누고,
 * 선택교과·학업·기타는 총괄표에서 한데 묶이므로 같은 색을 씁니다.
 */
export function categoryClass(topic) {
  switch (topic) {
    case "진로":
      return "";
    case "진학":
      return "badge--success";
    default:
      return "badge--muted";
  }
}

/** 파일을 내려받습니다. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // 브라우저가 내려받기를 시작할 시간을 준 뒤 정리합니다.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 빈 상태 블록 HTML. */
export function emptyState({ icon, title, desc = "", action = "" }) {
  return `
    <div class="empty">
      <div class="empty__icon" aria-hidden="true">${icon}</div>
      <p class="empty__title">${esc(title)}</p>
      ${desc ? `<p class="empty__desc">${esc(desc)}</p>` : ""}
      ${action}
    </div>`;
}

/* =========================================================
   토스트
   ========================================================= */
export function toast(message, variant = "info") {
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = `toast toast--${variant}`;
  el.textContent = message;
  stack.appendChild(el);

  setTimeout(() => {
    el.classList.add("toast--out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 2600);
}

/* =========================================================
   모달
   ========================================================= */
let closeCurrentModal = null;

/**
 * 모달을 엽니다.
 * @param {object} options
 * @param {string} options.title      제목
 * @param {string} [options.subtitle] 부제목
 * @param {string} options.body       본문 HTML
 * @param {Array}  options.actions    [{ label, variant, value }]
 * @param {(value:string, form:HTMLFormElement) => boolean|void|Promise<boolean|void>} [options.onAction]
 *        false 를 돌려주면 모달을 닫지 않습니다. 비동기 함수면 끝날 때까지 기다립니다.
 */
export function openModal({ title, subtitle = "", body, actions, onAction }) {
  closeModal();

  const root = document.getElementById("modalRoot");
  root.hidden = false;
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <form class="modal__form" novalidate>
        <div class="modal__head">
          <div>
            <h2 class="modal__title">${esc(title)}</h2>
            ${subtitle ? `<p class="modal__subtitle">${esc(subtitle)}</p>` : ""}
          </div>
          <button type="button" class="modal__close" data-close aria-label="닫기">×</button>
        </div>
        <div class="modal__body">${body}</div>
        <div class="modal__foot">
          ${actions
            .map(
              (a) =>
                `<button type="${a.value === "submit" ? "submit" : "button"}"
                         class="btn btn--${a.variant}"
                         data-action="${esc(a.value)}">${esc(a.label)}</button>`
            )
            .join("")}
        </div>
      </form>
    </div>`;

  const form = root.querySelector("form");
  const previouslyFocused = document.activeElement;

  const handleKey = (event) => {
    if (event.key === "Escape") closeModal();
  };

  closeCurrentModal = () => {
    document.removeEventListener("keydown", handleKey);
    root.hidden = true;
    root.innerHTML = "";
    closeCurrentModal = null;
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  };

  document.addEventListener("keydown", handleKey);

  root.addEventListener("mousedown", (event) => {
    if (event.target === root) closeModal();
  });

  // 처리가 끝나기 전에 같은 버튼을 두 번 누르지 못하게 막습니다.
  let pending = false;

  const dispatch = async (value) => {
    if (pending) return;

    if (!onAction) {
      closeModal();
      return;
    }

    const buttons = form.querySelectorAll(".modal__foot .btn");
    pending = true;
    buttons.forEach((button) => (button.disabled = true));

    try {
      if ((await onAction(value, form)) !== false) closeModal();
    } finally {
      pending = false;
      buttons.forEach((button) => (button.disabled = false));
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    dispatch("submit");
  });

  form.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => closeModal())
  );

  form.querySelectorAll("[data-action]").forEach((btn) => {
    if (btn.type === "submit") return;
    btn.addEventListener("click", () => dispatch(btn.dataset.action));
  });

  // 첫 입력 요소에 포커스
  const firstInput = form.querySelector("input, textarea, select");
  (firstInput || form.querySelector(".modal__close"))?.focus();

  return form;
}

export function closeModal() {
  if (closeCurrentModal) closeCurrentModal();
}

/** 예/아니오 확인 모달. */
export function confirmDialog({ title, message, confirmLabel = "확인", variant = "danger" }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="white-space:pre-wrap;line-height:1.65">${esc(message)}</p>`,
      actions: [
        { label: "취소", variant: "secondary", value: "cancel" },
        { label: confirmLabel, variant, value: "confirm" },
      ],
      onAction: (value) => resolve(value === "confirm"),
    });
  });
}

/** 모달 폼의 오류 메시지를 표시합니다. */
export function showFormError(form, message) {
  let box = form.querySelector(".form-error");
  if (!box) {
    box = document.createElement("div");
    box.className = "form-error";
    form.querySelector(".modal__body").appendChild(box);
  }
  box.innerHTML = `<span aria-hidden="true">⚠</span><span>${esc(message)}</span>`;
  box.scrollIntoView({ block: "nearest" });
}

export function clearFormError(form) {
  form.querySelector(".form-error")?.remove();
}
