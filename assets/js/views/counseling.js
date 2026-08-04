/**
 * 상담일지 — 학생별 상담 기록 조회 및 추가,
 * 진로상담일지·진로상담총괄표 내보내기.
 *
 * 입력 칸은 진로상담일지 서식의 칸을 그대로 따릅니다.
 */
import { counselingService, currentTerm, studentInfo, studentService } from "../services.js";
import {
  JOURNAL_TOPICS,
  MEETING_TYPES,
  buildCounselingJournal,
  buildCounselingSummary,
  toFormEntries,
  toJournalRecords,
} from "../counseling-docs.js";
import { loadSettings, saveSettings } from "../local.js";
import { TRASH_DAYS } from "../trash.js";
import {
  FIELDS,
  STUDENT_FIELDS,
  bindSearchBar,
  createFilter,
  hasFilter,
  matches,
  numberOrNull,
  searchBar,
} from "./search-bar.js";
import {
  esc,
  formatDate,
  categoryClass,
  emptyState,
  on,
  openModal,
  showFormError,
  clearFormError,
  confirmDialog,
  downloadBlob,
  toast,
} from "../ui.js";

export const meta = { id: "counseling", icon: "📝", title: "상담일지" };

// 화면을 다시 열어도 선택한 학생과 검색 조건을 기억합니다.
let selectedId = null;

/** 학생을 고를 때 쓰는 조건. 학생 관리 탭과 같은 칸입니다. */
const studentFilter = createFilter(STUDENT_FIELDS);

/** 고른 학생의 상담 기록 안에서 찾을 때 쓰는 조건. */
const RECORD_FIELDS = [
  { ...FIELDS.keyword, label: "기록 검색", placeholder: "날짜·주제·내용으로 검색" },
];
const recordFilter = createFilter(RECORD_FIELDS);

/** 상담 한 회기의 기본 소요시간(분). */
const DEFAULT_DURATION = 30;

/** 검색어가 상담 기록 어딘가에 들어 있는지. */
const sessionMatches = (session, keyword) =>
  matches(
    keyword,
    formatDate(session.sessionDate),
    session.sessionNo ? `${session.sessionNo}회기` : "",
    (session.topics ?? []).join(" "),
    session.topicOther,
    session.subject,
    session.content,
    session.intervention
  );

/* =========================================================
   상담 기록 보여주기
   ========================================================= */
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

/* =========================================================
   상담 기록 남기기
   ========================================================= */
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
    const other = [...form.elements.topics].some((box) => box.checked && box.value === "기타");

    form.querySelector('[data-when="class"]').hidden = !inClass;
    form.querySelector('[data-when="other"]').hidden = !other;
  };

  form.elements.meetingType.addEventListener("change", update);
  [...form.elements.topics].forEach((box) => box.addEventListener("change", update));
  update();
}

/**
 * 폼에서 상담 기록을 읽습니다.
 * @returns {{ ok: true, record: object } | { ok: false, error: string }}
 */
function readSessionForm(form) {
  const get = (name) => form.elements[name].value.trim();

  const content = get("content");
  if (!content) return { ok: false, error: "내담자가 진술한 문제와 상황을 입력해주세요." };

  const topics = [...form.elements.topics].filter((box) => box.checked).map((box) => box.value);
  if (topics.length === 0) return { ok: false, error: "상담 주제를 하나 이상 선택해주세요." };

  const topicOther = get("topicOther");
  if (topics.includes("기타") && !topicOther) {
    return { ok: false, error: "상담 주제로 ‘기타’를 골랐으면 사유를 적어주세요." };
  }

  const rawDuration = get("duration");
  const duration = rawDuration ? Number.parseInt(rawDuration, 10) : null;
  if (rawDuration && (Number.isNaN(duration) || duration <= 0)) {
    return { ok: false, error: "소요시간을 분 단위 숫자로 입력해주세요." };
  }

  const meetingType = get("meetingType");
  const rawPeriod = get("period");
  const period = rawPeriod ? Number.parseInt(rawPeriod, 10) : null;
  if (meetingType === "class" && rawPeriod && (Number.isNaN(period) || period <= 0)) {
    return { ok: false, error: "교시를 숫자로 입력해주세요." };
  }

  const raw = get("sessionDate");
  const date = raw ? new Date(`${raw}T00:00:00`) : new Date();

  return {
    ok: true,
    record: {
      date: date.toISOString(),
      topics,
      topicOther: topics.includes("기타") ? topicOther : null,
      meetingType,
      period,
      subject: get("subject"),
      durationMinutes: duration,
      content,
      intervention: get("intervention"),
    },
  };
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
      const parsed = readSessionForm(modalForm);

      if (!parsed.ok) {
        showFormError(modalForm, parsed.error);
        return false;
      }

      if (session) {
        const result = counselingService.update(session.id, parsed.record);
        if (!result.ok) {
          showFormError(modalForm, result.error);
          return false;
        }
        toast(`${nextNo}회기 상담 기록을 수정했습니다.`, "success");
      } else {
        const no = counselingService.add(student.id, parsed.record);
        toast(`${no}회기 상담 기록을 저장했습니다.`, "success");
      }

      onSaved();
      return true;
    },
  });

  bindConditionalFields(form);
}

/* =========================================================
   내보내기 — 두 서식이 함께 쓰는 부분

   진로상담일지와 진로상담총괄표 모두 ‘기간 안의 상담 기록’ 을 뽑아
   학년도·학기를 머리에 얹는 구조라 기간 칸과 검사를 함께 씁니다.
   ========================================================= */
/** 기간·학년도·학기 입력 칸. prefix 는 label 과 input 을 잇는 id 앞머리입니다. */
function termFields(prefix) {
  const term = currentTerm();

  return `
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="${prefix}-from">시작일</label>
        <input class="input" id="${prefix}-from" name="from" type="date" value="${term.from}" />
      </div>
      <div class="field">
        <label class="field__label" for="${prefix}-to">종료일</label>
        <input class="input" id="${prefix}-to" name="to" type="date" value="${term.to}" />
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="${prefix}-year">학년도</label>
        <input class="input" id="${prefix}-year" name="year" inputmode="numeric"
               value="${term.year}" />
      </div>
      <div class="field">
        <label class="field__label" for="${prefix}-term">학기</label>
        <select class="select" id="${prefix}-term" name="term">
          <option value="1" ${term.term === 1 ? "selected" : ""}>1학기</option>
          <option value="2" ${term.term === 2 ? "selected" : ""}>2학기</option>
        </select>
      </div>
    </div>`;
}

/**
 * 기간·학년도·학기 칸을 검사합니다.
 * @returns {{ ok: true, values: { from, to, year, term } } | { ok: false, error: string }}
 */
function readTermFields(get) {
  const from = get("from");
  const to = get("to");

  if (!from || !to) return { ok: false, error: "시작일과 종료일을 입력해주세요." };
  if (from > to) return { ok: false, error: "종료일이 시작일보다 빠릅니다." };

  const year = Number.parseInt(get("year"), 10);
  if (Number.isNaN(year)) return { ok: false, error: "학년도를 숫자로 입력해주세요." };

  return { ok: true, values: { from, to, year, term: Number.parseInt(get("term"), 10) } };
}

/** 내보내기 창을 엽니다. 문서를 만드는 부분만 화면마다 다릅니다. */
function openExportDialog({ title, body, build }) {
  openModal({
    title,
    subtitle: "기간 안의 상담 기록을 서식에 채워 한글 문서로 저장합니다.",
    body,
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "내보내기", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const get = (name) => form.elements[name]?.value.trim() ?? "";

      const term = readTermFields(get);
      if (!term.ok) {
        showFormError(form, term.error);
        return false;
      }

      const result = await build(get, term.values, form);
      if (result?.error) {
        showFormError(form, result.error);
        return false;
      }

      return true;
    },
  });
}

/** 기간 안의 상담 기록. 없으면 오류 문구를 돌려줍니다. */
function sessionsInRange(from, to, filter = () => true) {
  const sessions = counselingService.getInRange(from, to).filter(filter);
  return sessions.length ? { sessions } : { error: "그 기간에는 상담 기록이 없습니다." };
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
    await saveJournal([{ ...session, student: studentInfo(student) }], {
      ...loadSettings(JOURNAL_KEY, DEFAULT_JOURNAL),
      year,
      term,
    });
    toast("상담일지를 내보냈습니다.", "success");
  } catch (error) {
    toast(error?.message ?? "문서를 만들지 못했습니다.", "error");
  }
}

function journalFormBody(selected) {
  const settings = loadSettings(JOURNAL_KEY, DEFAULT_JOURNAL);

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
    ${termFields("j")}
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

function openJournalExport(selected) {
  openExportDialog({
    title: "진로상담일지 내보내기",
    body: journalFormBody(selected),
    async build(get, { from, to, year, term }) {
      const onlyStudent = selected && get("scope") !== "all";
      const found = sessionsInRange(
        from,
        to,
        (session) => !onlyStudent || session.studentId === selected.id
      );
      if (found.error) return found;

      const settings = {
        school: get("school"),
        staff: get("staff"),
        extension: get("extension"),
      };
      saveSettings(JOURNAL_KEY, settings);

      try {
        await saveJournal(found.sessions, { ...settings, year, term });
        toast(`상담일지 ${found.sessions.length}쪽을 내보냈습니다.`, "success");
      } catch (error) {
        toast(error?.message ?? "문서를 만들지 못했습니다.", "error");
      }
    },
  });
}

/* =========================================================
   진로상담총괄표 내보내기
   ========================================================= */
const SUMMARY_KEY = "career-manager.summary-form";

const DEFAULT_SUMMARY = {
  school: "대전반석고등학교",
  department: "진로진학부",
  weeks: 17,
  classHours: 10,
};

function summaryFormBody() {
  const settings = loadSettings(SUMMARY_KEY, DEFAULT_SUMMARY);

  return `
    ${termFields("e")}
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

function openSummaryExport() {
  openExportDialog({
    title: "진로상담총괄표 내보내기",
    body: summaryFormBody(),
    async build(get, { from, to, year, term }) {
      const weeks = Number.parseInt(get("weeks"), 10);
      if (Number.isNaN(weeks) || weeks <= 0) {
        return { error: "학기 적용 주 수를 1 이상의 숫자로 입력해주세요." };
      }

      const classHours = Number.parseFloat(get("classHours"));
      if (Number.isNaN(classHours) || classHours < 0) {
        return { error: "주당 수업시수를 숫자로 입력해주세요." };
      }

      const found = sessionsInRange(from, to);
      if (found.error) return found;

      const settings = {
        school: get("school"),
        department: get("department"),
        weeks,
        classHours,
      };
      saveSettings(SUMMARY_KEY, settings);

      try {
        const blob = await buildCounselingSummary({
          ...settings,
          year,
          term,
          entries: toFormEntries(found.sessions),
        });

        downloadBlob(blob, `진로상담총괄표_${year}학년도_${term}학기.hwpx`);
        toast(`상담 ${found.sessions.length}건을 내보냈습니다.`, "success");
      } catch (error) {
        toast(error?.message ?? "문서를 만들지 못했습니다.", "error");
      }
    },
  });
}

/* =========================================================
   주인 없는 상담 기록 정리

   학생을 지웠는데 기록만 남는 경우가 있습니다(옛 형식에서 옮겨 온 자료,
   학생 문서만 따로 지운 경우 등). 이런 기록은 학생 목록에 없어 화면에서
   고를 수 없으면서 통계에는 계속 잡히므로 여기서 모아 지웁니다.
   ========================================================= */
function orphanRow(session, index) {
  const topics = (session.topics?.length ? session.topics : [session.category]).filter(Boolean);

  return `
    <tr>
      <td class="check">
        <input type="checkbox" data-orphan="${session.id}"
               aria-label="${esc(formatDate(session.sessionDate))} 기록 선택" />
      </td>
      <td class="nowrap">${esc(formatDate(session.sessionDate))}</td>
      <td class="nowrap">${session.sessionNo ? `${session.sessionNo}회기` : "—"}</td>
      <td>${topics.map((topic) => `<span class="badge badge--muted">${esc(topic)}</span>`).join(" ")}</td>
      <td>${esc((session.content ?? "").slice(0, 60))}</td>
    </tr>`;
}

function orphanSection(orphans) {
  if (orphans.length === 0) return "";

  return `
    <section class="card card--quiet" style="margin-top:16px">
      <div class="card__head">
        <h2 class="section-title">주인 없는 상담 기록 ${orphans.length}건</h2>
        <span class="caption">통계에서는 이미 빠져 있습니다</span>
      </div>
      <p class="muted" style="margin:8px 0 12px">
        학생이 지워졌는데 기록만 남아 있습니다. 학생 목록에 없어 평소에는 고를 수 없으니
        여기서 정리해주세요. 휴지통으로 들어가며 ${TRASH_DAYS}일 안에는 되살릴 수 있습니다.
      </p>
      <div class="import-bulk" style="margin-bottom:12px">
        <button class="btn btn--danger btn--sm" type="button" data-orphan-remove>선택 삭제</button>
        <button class="btn btn--secondary btn--sm" type="button" data-orphan-all>모두 삭제</button>
      </div>
      <div class="table-wrap table-wrap--scroll">
        <table class="table table--compact">
          <thead>
            <tr>
              <th class="check"><input type="checkbox" data-orphan-select-all aria-label="모두 선택" /></th>
              <th>날짜</th><th>회기</th><th>주제</th><th>내용</th>
            </tr>
          </thead>
          <tbody>${orphans.map(orphanRow).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function bindOrphanSection(container, orphans, rerender) {
  const boxes = () => [...container.querySelectorAll("[data-orphan]")];

  const removeAll = async (ids, message) => {
    const ok = await confirmDialog({
      title: "주인 없는 상담 기록 삭제",
      message,
      confirmLabel: "삭제",
    });
    if (!ok) return;

    try {
      await counselingService.remove(ids);
      toast(`상담 기록 ${ids.length}건을 휴지통으로 옮겼습니다.`);
      rerender();
    } catch (error) {
      toast(error?.message ?? "삭제하지 못했습니다.", "error");
    }
  };

  on(
    container,
    "[data-orphan-select-all]",
    (box) => boxes().forEach((item) => (item.checked = box.checked)),
    "change"
  );

  on(container, "[data-orphan-remove]", () => {
    const ids = boxes()
      .filter((box) => box.checked)
      .map((box) => box.dataset.orphan);

    if (ids.length === 0) {
      toast("지울 기록을 먼저 선택해주세요.");
      return;
    }

    removeAll(
      ids,
      `주인 없는 상담 기록 ${ids.length}건을 삭제할까요?\n` +
        `휴지통으로 들어가며 ${TRASH_DAYS}일 안에는 되살릴 수 있습니다.`
    );
  });

  on(container, "[data-orphan-all]", () =>
    removeAll(
      orphans.map((session) => session.id),
      `주인 없는 상담 기록 ${orphans.length}건을 모두 삭제할까요?\n` +
        `휴지통으로 들어가며 ${TRASH_DAYS}일 안에는 되살릴 수 있습니다.`
    )
  );
}

/* =========================================================
   화면
   ========================================================= */
export function render(container, { navigate }) {
  // 비활성화한 학생도 함께 부릅니다. 상담 기록은 남아 있는데 학생을 고를 수 없으면
  // 그 기록을 보거나 지울 방법이 없어집니다.
  const students = studentService.getStudents({
    name: studentFilter.name,
    grade: numberOrNull(studentFilter.grade),
    classNo: numberOrNull(studentFilter.classNo),
    includeInactive: true,
  });

  const total = studentService.getStudents({ includeInactive: true }).length;
  const orphans = counselingService.getOrphans();
  const rerender = () => render(container, { navigate });

  // 이전에 선택한 학생이 검색 조건에서 빠졌으면 선택을 해제합니다.
  if (selectedId != null && !students.some((s) => s.id === selectedId)) {
    selectedId = null;
  }

  const selected = students.find((s) => s.id === selectedId) ?? null;
  const all = selected ? counselingService.getForStudent(selected.id) : [];
  const sessions = all.filter((session) => sessionMatches(session, recordFilter.keyword));

  if (total === 0 && orphans.length === 0) {
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

    on(container, "[data-go]", () => navigate("students"));
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
      ${searchBar({ id: "counseling", filter: studentFilter, fields: STUDENT_FIELDS })}
      <div class="filter-bar">
        <div class="field field--name">
          <label class="field__label" for="pick-student">학생 ${
            hasFilter(studentFilter) ? `<span class="caption">(${students.length}/${total}명)</span>` : ""
          }</label>
          <select class="select" id="pick-student" ${students.length ? "" : "disabled"}>
            <option value="">${students.length ? "학생을 선택하세요" : "조건에 맞는 학생이 없습니다"}</option>
            ${students
              .map(
                (s) =>
                  `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>
                     ${esc(s.display)}${s.isActive ? "" : " (비활성화)"}
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
              desc: "이름·학년·반으로 걸러 찾은 뒤 선택하면 상담 기록이 표시됩니다.",
            })
          : `<div class="card__head">
               <h2 class="section-title">${esc(selected.name)} 학생의 상담 기록</h2>
               <span class="caption">
                 ${
                   hasFilter(recordFilter)
                     ? `${sessions.length}건 조회 · 총 ${all.length}건`
                     : `총 ${all.length}건`
                 }
               </span>
             </div>
             ${
               all.length
                 ? `<div style="margin-bottom:16px">
                      ${searchBar({ id: "records", filter: recordFilter, fields: RECORD_FIELDS })}
                    </div>`
                 : ""
             }
             ${
               sessions.length
                 ? `<div class="timeline">${sessions.map(sessionCard).join("")}</div>`
                 : emptyState(
                     all.length
                       ? {
                           icon: "🔍",
                           title: "조건에 맞는 상담 기록이 없습니다",
                           desc: "검색어를 바꾸거나 초기화해 보세요.",
                           action: `<button class="btn btn--secondary" data-search-reset="records">검색 조건 초기화</button>`,
                         }
                       : {
                           icon: "🗒️",
                           title: "상담 기록이 없습니다",
                           desc: "‘상담 기록 추가’로 첫 기록을 남겨보세요.",
                           action: `<button class="btn btn--primary" data-add>+ 상담 기록 추가</button>`,
                         }
                   )
             }`
      }
    </section>

    ${orphanSection(orphans)}`;

  bindSearchBar(container, {
    id: "counseling",
    filter: studentFilter,
    fields: STUDENT_FIELDS,
    onChange: rerender,
  });

  bindSearchBar(container, {
    id: "records",
    filter: recordFilter,
    fields: RECORD_FIELDS,
    onChange: rerender,
  });

  bindOrphanSection(container, orphans, rerender);

  on(
    container,
    "#pick-student",
    (select) => {
      selectedId = select.value || null;
      rerender();
    },
    "change"
  );

  on(container, "[data-export]", () => openSummaryExport());
  on(container, "[data-journal]", () => openJournalExport(selected));

  on(container, "[data-journal-session]", (button) => {
    const record = sessions.find((s) => s.id === button.dataset.journalSession);
    if (selected && record) exportOneJournal(record, selected);
  });

  on(container, "[data-add]", () => {
    if (selected) openSessionForm(selected, null, rerender);
  });

  on(container, "[data-edit-session]", (button) => {
    const record = sessions.find((s) => s.id === button.dataset.editSession);
    if (selected && record) openSessionForm(selected, record, rerender);
  });

  on(container, "[data-remove-session]", async (button) => {
    const record = sessions.find((s) => s.id === button.dataset.removeSession);
    if (!record) return;

    const ok = await confirmDialog({
      title: "상담 기록 삭제",
      message:
        `${record.sessionNo ?? ""}회기 상담 기록을 삭제할까요?\n` +
        `휴지통으로 들어가며 ${TRASH_DAYS}일 안에는 되살릴 수 있습니다.`,
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
  });
}
