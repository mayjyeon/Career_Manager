/**
 * 상담일지 — 학생별 상담 기록 조회 및 추가,
 * 진로상담일지·진로상담총괄표 내보내기.
 *
 * 입력 칸은 진로상담일지 서식의 칸을 그대로 따릅니다.
 */
import { studentService, counselingService } from "../services.js";
import { buildCounselingSummary, toFormEntries } from "../counseling-form.js";
import {
  JOURNAL_TOPICS,
  MEETING_TYPES,
  buildCounselingJournal,
  toJournalRecords,
} from "../counseling-journal.js";
import {
  esc,
  formatDate,
  categoryClass,
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

/** 목록에 짧게 보여 줄 상담 시간대. */
function meetingLabel(session) {
  if (session.meetingType === "class") {
    return session.period ? `${session.period}교시` : "수업 중";
  }
  return MEETING_TYPES.find((type) => type.value === session.meetingType)?.label ?? "";
}

function sessionCard(session) {
  const when = meetingLabel(session);
  const topics = session.topics?.length ? session.topics : [session.category];

  return `
    <article class="session">
      <div class="session__head">
        <span class="session__date">${esc(formatDate(session.sessionDate))}</span>
        ${session.sessionNo ? `<span class="session__no">${session.sessionNo}회기</span>` : ""}
        ${topics
          .filter(Boolean)
          .map((topic) => `<span class="badge ${categoryClass(topic)}">${esc(topic)}</span>`)
          .join("")}
        ${when ? `<span class="badge badge--muted">${esc(when)}</span>` : ""}
        ${
          session.durationMinutes
            ? `<span class="badge badge--muted">${session.durationMinutes}분</span>`
            : ""
        }
      </div>
      <p class="session__content">${esc(session.content)}</p>
      <div class="session__actions">
        <button class="btn btn--secondary btn--sm" data-journal-session="${session.id}">
          📄 일지
        </button>
        <button class="btn btn--secondary btn--sm" data-edit-session="${session.id}">수정</button>
        <button class="btn btn--danger btn--sm" data-remove-session="${session.id}">삭제</button>
      </div>
      ${
        session.subject || session.topicOther || session.intervention
          ? `<div class="session__meta">
               ${
                 session.subject
                   ? `<p class="session__meta-row"><b>교과명</b>${esc(session.subject)}</p>`
                   : ""
               }
               ${
                 session.topicOther
                   ? `<p class="session__meta-row"><b>기타 사유</b>${esc(session.topicOther)}</p>`
                   : ""
               }
               ${
                 session.intervention
                   ? `<p class="session__meta-row"><b>소견 및 개입</b>${esc(session.intervention)}</p>`
                   : ""
               }
             </div>`
          : ""
      }
    </article>`;
}

function sessionFormBody(nextNo, session) {
  const date = session ? formatDate(session.sessionDate) : formatDate(new Date());
  const duration = session ? (session.durationMinutes ?? "") : DEFAULT_DURATION;
  // 새 기록의 기본값은 서식 첫 줄과 같은 '수업 중' 입니다.
  const meetingType = session?.meetingType ?? "class";
  const topics = session?.topics?.length
    ? session.topics
    : session?.category
      ? [session.category]
      : [];

  return `
    <div class="form-grid form-grid--3">
      <div class="field">
        <label class="field__label" for="s-date">상담 날짜</label>
        <input class="input" id="s-date" name="sessionDate" type="date" value="${date}" />
      </div>
      <div class="field">
        <label class="field__label" for="s-meeting">상담 시간대</label>
        <select class="select" id="s-meeting" name="meetingType">
          ${MEETING_TYPES.map(
            (type) =>
              `<option value="${type.value}" ${type.value === meetingType ? "selected" : ""}>
                 ${esc(type.label)}
               </option>`
          ).join("")}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="s-duration">소요시간(분)</label>
        <input class="input" id="s-duration" name="duration" inputmode="numeric"
               value="${duration}" />
      </div>
    </div>

    <div class="form-grid" data-when="class">
      <div class="field">
        <label class="field__label" for="s-period">교시</label>
        <input class="input" id="s-period" name="period" inputmode="numeric"
               placeholder="선택 입력" value="${session?.period ?? ""}" />
      </div>
      <div class="field">
        <label class="field__label" for="s-subject">교과명</label>
        <input class="input" id="s-subject" name="subject"
               placeholder="선택 입력" value="${esc(session?.subject ?? "")}" />
      </div>
    </div>

    <div class="field">
      <span class="field__label">상담 주제 <span class="caption">(해당 사항 모두 선택)</span></span>
      <div class="check-group">
        ${JOURNAL_TOPICS.map(
          (topic) => `
          <label class="check-item">
            <input type="checkbox" name="topics" value="${esc(topic)}"
                   ${topics.includes(topic) ? "checked" : ""} />
            <span>${esc(topic)}</span>
          </label>`
        ).join("")}
      </div>
    </div>

    <div class="field" data-when="other">
      <label class="field__label" for="s-other">기타 사유</label>
      <input class="input" id="s-other" name="topicOther"
             value="${esc(session?.topicOther ?? "")}" />
    </div>

    <div class="field">
      <label class="field__label" for="s-content">내담자가 진술한 문제와 상황</label>
      <textarea class="textarea" id="s-content" name="content" rows="6"
                placeholder="${nextNo}회기 상담에서 학생이 이야기한 내용을 적습니다.">${esc(
                  session?.content ?? ""
                )}</textarea>
    </div>

    <div class="field">
      <label class="field__label" for="s-intervention">상담자 소견 및 개입</label>
      <textarea class="textarea" id="s-intervention" name="intervention" rows="6"
                placeholder="선택 입력">${esc(session?.intervention ?? "")}</textarea>
    </div>`;
}

/** 고른 시간대와 주제에 따라 필요한 칸만 보여 줍니다. */
function bindConditionalFields(form) {
  const update = () => {
    const inClass = form.elements.meetingType.value === "class";
    const other = [...form.elements.topics].some(
      (box) => box.checked && box.value === "기타"
    );

    form.querySelector('[data-when="class"]').hidden = !inClass;
    form.querySelector('[data-when="other"]').hidden = !other;
  };

  form.elements.meetingType.addEventListener("change", update);
  [...form.elements.topics].forEach((box) => box.addEventListener("change", update));
  update();
}

/** 상담 기록을 추가하거나 고칩니다. session 이 없으면 추가입니다. */
function openSessionForm(student, session, onSaved) {
  const nextNo = session?.sessionNo ?? counselingService.getForStudent(student.id).length + 1;

  const form = openModal({
    title: session ? `${nextNo}회기 상담 기록 수정` : "상담 기록 추가",
    subtitle: `대상: ${student.affiliation} · ${student.name}`,
    body: sessionFormBody(nextNo, session),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: (action, modalForm) => {
      if (action !== "submit") return;

      clearFormError(modalForm);
      const get = (name) => modalForm.elements[name].value.trim();

      const content = get("content");
      if (!content) {
        showFormError(modalForm, "내담자가 진술한 문제와 상황을 입력해주세요.");
        return false;
      }

      const topics = [...modalForm.elements.topics]
        .filter((box) => box.checked)
        .map((box) => box.value);

      if (topics.length === 0) {
        showFormError(modalForm, "상담 주제를 하나 이상 선택해주세요.");
        return false;
      }

      const topicOther = get("topicOther");
      if (topics.includes("기타") && !topicOther) {
        showFormError(modalForm, "상담 주제로 ‘기타’를 골랐으면 사유를 적어주세요.");
        return false;
      }

      const rawDuration = get("duration");
      const duration = rawDuration ? Number.parseInt(rawDuration, 10) : null;

      if (rawDuration && (Number.isNaN(duration) || duration <= 0)) {
        showFormError(modalForm, "소요시간을 분 단위 숫자로 입력해주세요.");
        return false;
      }

      const meetingType = get("meetingType");
      const rawPeriod = get("period");
      const period = rawPeriod ? Number.parseInt(rawPeriod, 10) : null;

      if (meetingType === "class" && rawPeriod && (Number.isNaN(period) || period <= 0)) {
        showFormError(modalForm, "교시를 숫자로 입력해주세요.");
        return false;
      }

      const raw = get("sessionDate");
      const date = raw ? new Date(`${raw}T00:00:00`) : new Date();

      const record = {
        date: date.toISOString(),
        topics,
        topicOther: topics.includes("기타") ? topicOther : null,
        meetingType,
        period,
        subject: get("subject"),
        durationMinutes: duration,
        content,
        intervention: get("intervention"),
      };

      if (session) {
        const result = counselingService.update(session.id, record);

        if (!result.ok) {
          showFormError(modalForm, result.error);
          return false;
        }

        toast(`${nextNo}회기 상담 기록을 수정했습니다.`, "success");
      } else {
        const no = counselingService.add(student.id, record);
        toast(`${no}회기 상담 기록을 저장했습니다.`, "success");
      }

      onSaved();
      return true;
    },
  });

  bindConditionalFields(form);
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

/* =========================================================
   진로상담일지 내보내기
   ========================================================= */
const JOURNAL_KEY = "career-manager.journal-form";

/** 원본 서식에 인쇄되어 있던 값이 기본값입니다. */
const DEFAULT_JOURNAL = {
  school: "대전반석고",
  staff: "진로진학부장 홍지연",
  extension: "7895",
};

function loadJournalSettings() {
  try {
    return { ...DEFAULT_JOURNAL, ...JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_JOURNAL };
  }
}

function saveJournalSettings(settings) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(settings));
  } catch {
    /* 저장할 수 없으면 이번 세션에만 적용됩니다. */
  }
}

/** 서식의 내담자 정보 칸에 들어갈 값. */
const journalStudent = (student) => ({
  name: student.name,
  grade: student.grade,
  classNo: student.classNo,
  studentNo: student.studentNo,
});

/** 상담일지를 한글 문서로 저장합니다. 상담 한 건이 한 쪽입니다. */
async function saveJournal(sessions, { year, term, ...settings }) {
  const blob = await buildCounselingJournal({
    ...settings,
    year,
    term,
    records: toJournalRecords(sessions),
  });

  downloadBlob(blob, `진로상담일지_${year}학년도_${term}학기.hwpx`);
}

/** 상담 한 건을 바로 내보냅니다. 학년도·학기는 상담 날짜에서 정합니다. */
async function exportOneJournal(session, student) {
  const { year, term } = currentTerm(new Date(session.sessionDate));

  try {
    await saveJournal([{ ...session, student: journalStudent(student) }], {
      ...loadJournalSettings(),
      year,
      term,
    });
    toast("상담일지를 내보냈습니다.", "success");
  } catch (error) {
    toast(error?.message ?? "문서를 만들지 못했습니다.", "error");
  }
}

function journalFormBody(selected) {
  const term = currentTerm();
  const settings = loadJournalSettings();

  return `
    ${
      selected
        ? `<div class="field">
             <label class="field__label" for="j-scope">대상</label>
             <select class="select" id="j-scope" name="scope">
               <option value="student">${esc(selected.name)} 학생만</option>
               <option value="all">모든 학생</option>
             </select>
           </div>`
        : ""
    }
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="j-from">시작일</label>
        <input class="input" id="j-from" name="from" type="date" value="${term.from}" />
      </div>
      <div class="field">
        <label class="field__label" for="j-to">종료일</label>
        <input class="input" id="j-to" name="to" type="date" value="${term.to}" />
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="j-year">학년도</label>
        <input class="input" id="j-year" name="year" inputmode="numeric" value="${term.year}" />
      </div>
      <div class="field">
        <label class="field__label" for="j-term">학기</label>
        <select class="select" id="j-term" name="term">
          <option value="1" ${term.term === 1 ? "selected" : ""}>1학기</option>
          <option value="2" ${term.term === 2 ? "selected" : ""}>2학기</option>
        </select>
      </div>
    </div>
    <div class="form-grid form-grid--3">
      <div class="field">
        <label class="field__label" for="j-school">학교명</label>
        <input class="input" id="j-school" name="school" value="${esc(settings.school)}" />
      </div>
      <div class="field">
        <label class="field__label" for="j-staff">담당자</label>
        <input class="input" id="j-staff" name="staff" value="${esc(settings.staff)}" />
      </div>
      <div class="field">
        <label class="field__label" for="j-ext">내선번호</label>
        <input class="input" id="j-ext" name="extension" value="${esc(settings.extension)}" />
      </div>
    </div>
    <p class="caption" style="margin-top:4px">
      상담 한 건이 한 쪽입니다. 한글 문서(.hwpx)로 저장되며, 한글에서 열어 그대로 인쇄하거나
      ‘다른 이름으로 저장’으로 .hwp·PDF 로 바꿀 수 있습니다.
    </p>`;
}

function openJournalForm(selected) {
  openModal({
    title: "진로상담일지 내보내기",
    subtitle: "기간 안의 상담 기록을 서식에 채워 한글 문서로 저장합니다.",
    body: journalFormBody(selected),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "내보내기", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const get = (name) => form.elements[name]?.value.trim() ?? "";

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
      if (Number.isNaN(year)) {
        showFormError(form, "학년도를 숫자로 입력해주세요.");
        return false;
      }

      const onlyStudent = selected && get("scope") !== "all";
      const sessions = counselingService
        .getInRange(from, to)
        .filter((session) => !onlyStudent || session.studentId === selected.id);

      if (sessions.length === 0) {
        showFormError(form, "그 기간에는 상담 기록이 없습니다.");
        return false;
      }

      const settings = {
        school: get("school"),
        staff: get("staff"),
        extension: get("extension"),
      };
      saveJournalSettings(settings);

      try {
        await saveJournal(sessions, {
          ...settings,
          year,
          term: Number.parseInt(get("term"), 10),
        });
        toast(`상담일지 ${sessions.length}쪽을 내보냈습니다.`, "success");
      } catch (error) {
        toast(error?.message ?? "문서를 만들지 못했습니다.", "error");
      }

      return true;
    },
  });
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
        <button class="btn btn--secondary" data-journal>📄 상담일지 내보내기</button>
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

  container
    .querySelector("[data-journal]")
    ?.addEventListener("click", () => openJournalForm(selected));

  container.querySelectorAll("[data-journal-session]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const record = sessions.find((s) => s.id === btn.dataset.journalSession);
      if (selected && record) exportOneJournal(record, selected);
    })
  );

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
