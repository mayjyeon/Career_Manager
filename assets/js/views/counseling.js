/** 상담일지 — 학생별 상담 기록 조회 및 추가. */
import { studentService, counselingService } from "../services.js";
import {
  esc,
  formatDate,
  categoryClass,
  CATEGORIES,
  emptyState,
  openModal,
  showFormError,
  clearFormError,
  toast,
} from "../ui.js";

export const meta = { id: "counseling", icon: "📝", title: "상담일지" };

// 화면을 다시 열어도 선택한 학생을 기억합니다.
let selectedId = null;

function sessionCard(session) {
  const meta = [
    session.followUpAction ? ["후속 조치", session.followUpAction] : null,
    session.nextPlan ? ["다음 계획", session.nextPlan] : null,
  ].filter(Boolean);

  return `
    <article class="session">
      <div class="session__head">
        <span class="session__date">${esc(formatDate(session.sessionDate))}</span>
        ${session.sessionNo ? `<span class="session__no">${session.sessionNo}회기</span>` : ""}
        <span class="badge ${categoryClass(session.category)}">${esc(session.category)}</span>
      </div>
      <p class="session__content">${esc(session.content)}</p>
      ${
        meta.length
          ? `<div class="session__meta">
               ${meta
                 .map(
                   ([label, text]) =>
                     `<p class="session__meta-row"><b>${label}</b>${esc(text)}</p>`
                 )
                 .join("")}
             </div>`
          : ""
      }
    </article>`;
}

function sessionFormBody(nextNo) {
  return `
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="s-date">상담 날짜</label>
        <input class="input" id="s-date" name="sessionDate" type="date"
               value="${formatDate(new Date())}" />
      </div>
      <div class="field">
        <label class="field__label" for="s-category">상담 분류</label>
        <select class="select" id="s-category" name="category">
          ${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field">
      <label class="field__label" for="s-content">상담 내용</label>
      <textarea class="textarea" id="s-content" name="content" rows="6"
                placeholder="${nextNo}회기 상담 내용을 입력하세요."></textarea>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="s-follow">후속 조치</label>
        <textarea class="textarea" id="s-follow" name="followUp" rows="3"
                  placeholder="선택 입력"></textarea>
      </div>
      <div class="field">
        <label class="field__label" for="s-next">다음 계획</label>
        <textarea class="textarea" id="s-next" name="nextPlan" rows="3"
                  placeholder="선택 입력"></textarea>
      </div>
    </div>`;
}

function openSessionForm(student, onSaved) {
  const nextNo = counselingService.getForStudent(student.id).length + 1;

  openModal({
    title: "상담 기록 추가",
    subtitle: `대상: ${student.affiliation} · ${student.name}`,
    body: sessionFormBody(nextNo),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const get = (name) => form.elements[name].value.trim();

      const content = get("content");
      if (!content) {
        showFormError(form, "상담 내용을 입력해주세요.");
        return false;
      }

      const raw = get("sessionDate");
      const date = raw ? new Date(`${raw}T00:00:00`) : new Date();

      const no = counselingService.add(
        student.id,
        date.toISOString(),
        get("category"),
        content,
        get("followUp") || null,
        get("nextPlan") || null
      );

      toast(`${no}회기 상담 기록을 저장했습니다.`, "success");
      onSaved();
      return true;
    },
  });
}

export function render(container, { navigate }) {
  const students = studentService.getStudents(null, null, null);

  // 이전에 선택한 학생이 사라졌으면 선택을 해제합니다.
  if (selectedId != null && !students.some((s) => s.id === selectedId)) {
    selectedId = null;
  }

  const selected = students.find((s) => s.id === selectedId) ?? null;
  const sessions = selected ? counselingService.getForStudent(selected.id) : [];
  const rerender = () => render(container, { navigate });

  if (students.length === 0) {
    container.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">상담일지</h1>
          <p class="page-subtitle">학생별 상담 기록을 남기고 확인합니다.</p>
        </div>
      </div>
      <section class="card">
        ${emptyState({
          icon: "👥",
          title: "먼저 학생을 등록해주세요",
          desc: "상담 기록은 등록된 학생에게만 남길 수 있습니다.",
          action: `<button class="btn btn--primary" data-go="students">학생 관리로 이동</button>`,
        })}
      </section>`;

    container
      .querySelector("[data-go]")
      ?.addEventListener("click", () => navigate("students"));
    return;
  }

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">상담일지</h1>
        <p class="page-subtitle">학생별 상담 기록을 남기고 확인합니다.</p>
      </div>
    </div>

    <section class="card" style="margin-bottom:16px">
      <div class="filter-bar">
        <div class="field field--name">
          <label class="field__label" for="pick-student">학생</label>
          <select class="select" id="pick-student">
            <option value="">학생을 선택하세요</option>
            ${students
              .map(
                (s) =>
                  `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>
                     ${esc(s.display)}
                   </option>`
              )
              .join("")}
          </select>
        </div>
        <button class="btn btn--primary" data-add ${selected ? "" : "disabled"}>
          + 상담 기록 추가
        </button>
      </div>
    </section>

    <section class="card">
      ${
        !selected
          ? emptyState({
              icon: "🧑‍🏫",
              title: "학생을 선택해주세요",
              desc: "학생을 선택하면 상담 기록이 표시됩니다.",
            })
          : sessions.length
            ? `<div class="card__head">
                 <h2 class="section-title">${esc(selected.name)} 학생의 상담 기록</h2>
                 <span class="caption">총 ${sessions.length}건</span>
               </div>
               <div class="timeline">${sessions.map(sessionCard).join("")}</div>`
            : emptyState({
                icon: "🗒️",
                title: "상담 기록이 없습니다",
                desc: "‘상담 기록 추가’로 첫 기록을 남겨보세요.",
                action: `<button class="btn btn--primary" data-add>+ 상담 기록 추가</button>`,
              })
      }
    </section>`;

  container.querySelector("#pick-student").addEventListener("change", (event) => {
    selectedId = event.target.value || null;
    rerender();
  });

  container.querySelectorAll("[data-add]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (selected) openSessionForm(selected, rerender);
    })
  );
}
