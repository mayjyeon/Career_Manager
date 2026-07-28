/** 상담일지 — 학생별 상담 기록 조회 및 추가, 진로상담총괄표 내보내기. */
import { studentService, counselingService } from "../services.js";
import { buildCounselingSummary, toFormEntries } from "../counseling-form.js";
import {
  esc,
  formatDate,
  categoryClass,
  CATEGORIES,
  emptyState,
  openModal,
  showFormError,
  clearFormError,
  confirmDialog,
  downloadBlob,
  toast,
} from "../ui.js";

export const meta = { id: "counseling", icon: "📝", title: "상담일지" };

// 화면을 다시 열어도 선택한 학생을 기억합니다.
let selectedId = null;

/** 상담 한 회기의 기본 소요시간(분). */
const DEFAULT_DURATION = 30;

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
        ${
          session.durationMinutes
            ? `<span class="badge badge--muted">${session.durationMinutes}분</span>`
            : ""
        }
      </div>
      <p class="session__content">${esc(session.content)}</p>
      <div class="session__actions">
        <button class="btn btn--secondary btn--sm" data-edit-session="${session.id}">수정</button>
        <button class="btn btn--danger btn--sm" data-remove-session="${session.id}">삭제</button>
      </div>
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

function sessionFormBody(nextNo, session) {
  const date = session ? formatDate(session.sessionDate) : formatDate(new Date());
  const duration = session ? (session.durationMinutes ?? "") : DEFAULT_DURATION;

  return `
    <div class="form-grid form-grid--3">
      <div class="field">
        <label class="field__label" for="s-date">상담 날짜</label>
        <input class="input" id="s-date" name="sessionDate" type="date" value="${date}" />
      </div>
      <div class="field">
        <label class="field__label" for="s-category">상담 분류</label>
        <select class="select" id="s-category" name="category">
          ${CATEGORIES.map(
            (c) =>
              `<option value="${esc(c)}" ${session?.category === c ? "selected" : ""}>${esc(c)}</option>`
          ).join("")}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="s-duration">소요시간(분)</label>
        <input class="input" id="s-duration" name="duration" inputmode="numeric"
               value="${duration}" />
      </div>
    </div>
    <div class="field">
      <label class="field__label" for="s-content">상담 내용</label>
      <textarea class="textarea" id="s-content" name="content" rows="6"
                placeholder="${nextNo}회기 상담 내용을 입력하세요.">${esc(session?.content ?? "")}</textarea>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="s-follow">후속 조치</label>
        <textarea class="textarea" id="s-follow" name="followUp" rows="3"
                  placeholder="선택 입력">${esc(session?.followUpAction ?? "")}</textarea>
      </div>
      <div class="field">
        <label class="field__label" for="s-next">다음 계획</label>
        <textarea class="textarea" id="s-next" name="nextPlan" rows="3"
                  placeholder="선택 입력">${esc(session?.nextPlan ?? "")}</textarea>
      </div>
    </div>`;
}

/** 상담 기록을 추가하거나 고칩니다. session 이 없으면 추가입니다. */
function openSessionForm(student, session, onSaved) {
  const nextNo = session?.sessionNo ?? counselingService.getForStudent(student.id).length + 1;

  openModal({
    title: session ? `${nextNo}회기 상담 기록 수정` : "상담 기록 추가",
    subtitle: `대상: ${student.affiliation} · ${student.name}`,
    body: sessionFormBody(nextNo, session),
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

      const rawDuration = get("duration");
      const duration = rawDuration ? Number.parseInt(rawDuration, 10) : null;

      if (rawDuration && (Number.isNaN(duration) || duration <= 0)) {
        showFormError(form, "소요시간을 분 단위 숫자로 입력해주세요.");
        return false;
      }

      const raw = get("sessionDate");
      const date = raw ? new Date(`${raw}T00:00:00`) : new Date();

      if (session) {
        const result = counselingService.update(session.id, {
          date: date.toISOString(),
          category: get("category"),
          content,
          followUp: get("followUp") || null,
          nextPlan: get("nextPlan") || null,
          durationMinutes: duration,
        });

        if (!result.ok) {
          showFormError(form, result.error);
          return false;
        }

        toast(`${nextNo}회기 상담 기록을 수정했습니다.`, "success");
      } else {
        const no = counselingService.add(
          student.id,
          date.toISOString(),
          get("category"),
          content,
          get("followUp") || null,
          get("nextPlan") || null,
          duration
        );

        toast(`${no}회기 상담 기록을 저장했습니다.`, "success");
      }

      onSaved();
      return true;
    },
  });
}

/* =========================================================
   진로상담총괄표 내보내기
   ========================================================= */
const SETTINGS_KEY = "career-manager.summary-form";

const DEFAULT_SETTINGS = {
  school: "대전반석고등학교",
  department: "진로진학부",
  weeks: 17,
  classHours: 10,
};

/** 지난번에 입력한 학교·시수 정보를 기억합니다. */
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 저장할 수 없으면 이번 세션에만 적용됩니다. */
  }
}

/** 오늘 날짜를 기준으로 학년도·학기와 기간을 정합니다. */
function currentTerm(today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  // 1학기 3~8월, 2학기 9월~다음 해 2월. 1·2월은 지난 학년도의 2학기입니다.
  if (month >= 3 && month <= 8) {
    return { year, term: 1, from: `${year}-03-01`, to: `${year}-08-31` };
  }
  if (month >= 9) {
    return { year, term: 2, from: `${year}-09-01`, to: `${year + 1}-02-28` };
  }
  return { year: year - 1, term: 2, from: `${year - 1}-09-01`, to: `${year}-02-28` };
}

function exportFormBody() {
  const term = currentTerm();
  const settings = loadSettings();

  return `
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="e-from">시작일</label>
        <input class="input" id="e-from" name="from" type="date" value="${term.from}" />
      </div>
      <div class="field">
        <label class="field__label" for="e-to">종료일</label>
        <input class="input" id="e-to" name="to" type="date" value="${term.to}" />
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="e-year">학년도</label>
        <input class="input" id="e-year" name="year" inputmode="numeric" value="${term.year}" />
      </div>
      <div class="field">
        <label class="field__label" for="e-term">학기</label>
        <select class="select" id="e-term" name="term">
          <option value="1" ${term.term === 1 ? "selected" : ""}>1학기</option>
          <option value="2" ${term.term === 2 ? "selected" : ""}>2학기</option>
        </select>
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="e-school">학교명</label>
        <input class="input" id="e-school" name="school" value="${esc(settings.school)}" />
      </div>
      <div class="field">
        <label class="field__label" for="e-dept">부서명</label>
        <input class="input" id="e-dept" name="department" value="${esc(settings.department)}" />
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="e-weeks">학기 적용 주 수 (B)</label>
        <input class="input" id="e-weeks" name="weeks" inputmode="numeric" value="${settings.weeks}" />
      </div>
      <div class="field">
        <label class="field__label" for="e-hours">주당 수업시수 (D)</label>
        <input class="input" id="e-hours" name="classHours" inputmode="decimal"
               value="${settings.classHours}" />
      </div>
    </div>
    <p class="caption" style="margin-top:4px">
      한글 문서(.hwpx)로 저장됩니다. 한글에서 열어 ‘다른 이름으로 저장’하면 .hwp 로 바꿀 수 있습니다.
    </p>`;
}

function openExportForm() {
  openModal({
    title: "진로상담총괄표 내보내기",
    subtitle: "기간 안의 상담 기록을 서식에 채워 한글 문서로 저장합니다.",
    body: exportFormBody(),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "내보내기", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const get = (name) => form.elements[name].value.trim();

      const from = get("from");
      const to = get("to");

      if (!from || !to) {
        showFormError(form, "시작일과 종료일을 입력해주세요.");
        return false;
      }
      if (from > to) {
        showFormError(form, "종료일이 시작일보다 빠릅니다.");
        return false;
      }

      const year = Number.parseInt(get("year"), 10);
      const weeks = Number.parseInt(get("weeks"), 10);
      const classHours = Number.parseFloat(get("classHours"));

      if (Number.isNaN(year)) {
        showFormError(form, "학년도를 숫자로 입력해주세요.");
        return false;
      }
      if (Number.isNaN(weeks) || weeks <= 0) {
        showFormError(form, "학기 적용 주 수를 1 이상의 숫자로 입력해주세요.");
        return false;
      }
      if (Number.isNaN(classHours) || classHours < 0) {
        showFormError(form, "주당 수업시수를 숫자로 입력해주세요.");
        return false;
      }

      const sessions = counselingService.getInRange(from, to);

      if (sessions.length === 0) {
        showFormError(form, "그 기간에는 상담 기록이 없습니다.");
        return false;
      }

      const settings = { school: get("school"), department: get("department"), weeks, classHours };
      saveSettings(settings);

      const term = Number.parseInt(get("term"), 10);

      try {
        const blob = await buildCounselingSummary({
          ...settings,
          year,
          term,
          entries: toFormEntries(sessions),
        });

        downloadBlob(blob, `진로상담총괄표_${year}학년도_${term}학기.hwpx`);
        toast(`상담 ${sessions.length}건을 내보냈습니다.`, "success");
      } catch (error) {
        toast(error?.message ?? "문서를 만들지 못했습니다.", "error");
      }

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
      <div class="page-head__actions">
        <button class="btn btn--secondary" data-export>📄 총괄표 내보내기</button>
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

  container.querySelector("[data-export]")?.addEventListener("click", () => openExportForm());

  container.querySelectorAll("[data-add]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (selected) openSessionForm(selected, null, rerender);
    })
  );

  container.querySelectorAll("[data-edit-session]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const record = sessions.find((s) => s.id === btn.dataset.editSession);
      if (selected && record) openSessionForm(selected, record, rerender);
    })
  );

  container.querySelectorAll("[data-remove-session]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const record = sessions.find((s) => s.id === btn.dataset.removeSession);
      if (!record) return;

      const ok = await confirmDialog({
        title: "상담 기록 삭제",
        message:
          `${record.sessionNo ?? ""}회기 상담 기록을 삭제할까요?\n` +
          "휴지통으로 들어가며 30일 안에는 되살릴 수 있습니다.",
        confirmLabel: "삭제",
      });
      if (!ok) return;

      try {
        await counselingService.remove(record.id);
        toast("상담 기록을 휴지통으로 옮겼습니다.");
        rerender();
      } catch (error) {
        toast(error?.message ?? "삭제하지 못했습니다.", "error");
      }
    })
  );
}
