/**
 * 포트폴리오.
 *
 * 두 갈래를 한 화면에서 봅니다.
 *   선생님 등록 — 엑셀로 올리거나 직접 적어 넣은 자료. 선생님만 봅니다.
 *   학생 업로드 — 학생이 자기 화면에서 올린 자료.
 *
 * 학생 화면에서는 자기가 올린 것만 보고 고칩니다.
 */
import { portfolios, profiles, session } from "../board.js";
import {
  formatStudentNumber,
  portfolioService,
  studentService,
} from "../services.js";
import { parsePortfolioSheet, buildPortfolioPlan } from "../portfolio-sheet.js";
import { readSpreadsheet, SheetError } from "../sheet.js";
import { TRASH_DAYS } from "../trash.js";
import { TEACHER } from "../roles.js";
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
  linkField,
  openPostForm,
  profileSnapshot,
  renderBody,
  renderLinks,
  renderPostMeta,
} from "./post-parts.js";
import {
  clearFormError,
  confirmDialog,
  emptyState,
  esc,
  on,
  openModal,
  showFormError,
  toast,
} from "../ui.js";

export const meta = {
  id: "portfolio",
  icon: "🎒",
  title: "포트폴리오",
  needs: ["portfolios", "profiles"],
  // 선생님이 등록한 자료는 선생님 계정 안(users/{uid}/portfolios)에 있습니다.
  owns: ["portfolios"],
};

// 선생님 화면에서 펼쳐 둔 학생을 기억합니다.
const expanded = new Set();

/** 화면을 다시 그려도 검색 조건은 유지합니다. */
const filter = createFilter([...STUDENT_FIELDS, FIELDS.keyword]);

/* =========================================================
   쓰기 (학생)
   ========================================================= */
function openEntryForm(entry, onSaved) {
  openPostForm({
    title: entry ? "포트폴리오 수정" : "포트폴리오 추가",
    subtitle: entry ? "" : "활동 기록, 수상, 독서, 진로 탐색 등 무엇이든 남겨보세요.",
    body: `
      <div class="field">
        <label class="field__label" for="f-title">제목</label>
        <input class="input" id="f-title" name="title" value="${esc(entry?.title ?? "")}"
               placeholder="예: 의료 계열 진로 탐색 보고서" />
      </div>
      <div class="field">
        <label class="field__label" for="f-body">내용</label>
        <textarea class="textarea" id="f-body" name="body" rows="8"
                  placeholder="무엇을 했고 무엇을 느꼈는지 적어보세요.">${esc(entry?.body ?? "")}</textarea>
      </div>
      ${linkField(entry?.links ?? [], { label: "자료 링크" })}`,
    draftKey: `portfolio:${entry?.id ?? "new"}`,
    draftFields: ["title", "body", "links"],
    read(get, links) {
      const title = get("title");
      if (!title) return { ok: false, error: "제목을 입력해주세요." };

      return {
        ok: true,
        fields: { title, body: get("body"), links, profile: profileSnapshot() },
      };
    },
    save: (fields) =>
      entry ? portfolios.update(entry.id, fields) : portfolios.add(fields),
    done: entry ? "포트폴리오를 수정했습니다." : "포트폴리오를 추가했습니다.",
    onSaved,
  });
}

/* =========================================================
   쓰기 (선생님 — 학생 한 명)
   ========================================================= */
/** 학생을 고르는 칸. 명렬표에 있는 학생만 고를 수 있습니다. */
function studentPicker(students, selectedId) {
  return `
    <div class="field">
      <label class="field__label" for="t-student">학생</label>
      <select class="select" id="t-student" name="studentId">
        <option value="">학생을 선택하세요</option>
        ${students
          .map(
            (student) =>
              `<option value="${student.id}" ${student.id === selectedId ? "selected" : ""}>
                 ${esc(student.display)}
               </option>`
          )
          .join("")}
      </select>
    </div>`;
}

/** 선생님이 포트폴리오 한 건을 직접 적어 넣습니다. entry 가 있으면 수정입니다. */
function openTeacherEntryForm(entry, onSaved) {
  const students = studentService.getStudents({ includeInactive: true });

  if (!entry && students.length === 0) {
    toast("먼저 학생 관리에서 학생을 등록해주세요.", "error");
    return;
  }

  openModal({
    title: entry ? "포트폴리오 수정" : "포트폴리오 등록",
    subtitle: entry
      ? `${entry.studentName ?? ""} 학생의 자료를 고칩니다.`
      : "선생님이 정리한 자료를 학생에게 붙입니다. 학생에게는 보이지 않습니다.",
    body: `
      ${entry ? "" : studentPicker(students, null)}
      <div class="field">
        <label class="field__label" for="t-title">제목</label>
        <input class="input" id="t-title" name="title" value="${esc(entry?.title ?? "")}"
               placeholder="예: 2026학년도 1학기 활동기록" />
      </div>
      <div class="field">
        <label class="field__label" for="t-body">글내용</label>
        <textarea class="textarea" id="t-body" name="body" rows="10"
                  placeholder="정리한 내용을 붙여 넣으세요.">${esc(entry?.body ?? "")}</textarea>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const get = (name) => form.elements[name]?.value.trim() ?? "";

      const title = get("title");
      if (!title) {
        showFormError(form, "제목을 입력해주세요.");
        return false;
      }

      const body = get("body");
      if (!body) {
        showFormError(form, "글내용을 입력해주세요.");
        return false;
      }

      if (entry) {
        const result = portfolioService.update(entry.id, { title, body });
        if (!result.ok) {
          showFormError(form, result.error);
          return false;
        }
        toast("포트폴리오를 수정했습니다.", "success");
        onSaved();
        return true;
      }

      const student = students.find((item) => item.id === get("studentId"));
      if (!student) {
        showFormError(form, "학생을 선택해주세요.");
        return false;
      }

      try {
        await portfolioService.addMany([{ student, title, body, source: "직접 등록" }]);
      } catch (error) {
        showFormError(form, error?.message ?? "저장하지 못했습니다.");
        return false;
      }

      toast("포트폴리오를 등록했습니다.", "success");
      onSaved();
      return true;
    },
  });
}

/* =========================================================
   엑셀 업로드 (선생님)
   ========================================================= */
const PLAN_STATUS = {
  ready: `<span class="badge badge--success">등록</span>`,
  noStudent: `<span class="badge badge--warning">학생 없음</span>`,
  error: `<span class="badge badge--danger">확인 필요</span>`,
};

function planRow(row) {
  const seat =
    row.grade == null ? "—" : `${row.grade}학년 ${row.classNo}반 ${row.studentNo}번`;

  return `
    <tr>
      <td>${PLAN_STATUS[row.status]}</td>
      <td class="nowrap">${esc(row.rawNumber || "—")}</td>
      <td class="nowrap">${esc(seat)}</td>
      <td class="nowrap">${row.student ? esc(row.student.name) : `<span class="caption">—</span>`}</td>
      <td>
        ${esc(row.body.slice(0, 50))}${row.body.length > 50 ? "…" : ""}
        ${row.message ? `<div class="caption">${esc(row.message)}</div>` : ""}
      </td>
    </tr>`;
}

function previewBody(entries, years) {
  const year = years[0] ?? new Date().getFullYear();

  return `
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="p-year">학년도</label>
        ${
          years.length
            ? `<select class="select" id="p-year" name="schoolYear">
                 ${years
                   .map(
                     (value) =>
                       `<option value="${value}" ${value === year ? "selected" : ""}>
                          ${value}학년도
                        </option>`
                   )
                   .join("")}
               </select>`
            : `<input class="input" id="p-year" name="schoolYear" inputmode="numeric" value="${year}" />`
        }
        <p class="caption">이 학년도의 명렬표에서 학번에 해당하는 학생을 찾습니다.</p>
      </div>
      <div class="field">
        <label class="field__label" for="p-title">제목</label>
        <input class="input" id="p-title" name="title"
               placeholder="예: 2026학년도 1학기 활동기록" />
        <p class="caption">엑셀에 제목 칸이 없어 올리는 자료 전체에 같은 제목을 씁니다.</p>
      </div>
    </div>
    <div data-plan></div>`;
}

/** 고른 학년도에 맞춰 미리보기 표를 다시 그립니다. */
function renderPlan(form, entries, schoolYear) {
  const plan = buildPortfolioPlan(entries, schoolYear, (seat) =>
    studentService.findSeatItem(seat)
  );

  const count = (status) => plan.filter((row) => row.status === status).length;

  form.querySelector("[data-plan]").innerHTML = `
    <p class="import-summary">
      엑셀에서 <b>${plan.length}줄</b>을 읽어 학번 순으로 정리했습니다.
      등록 ${count("ready")}건 · 학생 없음 ${count("noStudent")}건 · 확인 필요 ${count("error")}건
    </p>
    <div class="table-wrap table-wrap--scroll">
      <table class="table table--compact">
        <thead>
          <tr>
            <th>상태</th><th>학번</th><th>자리</th><th>학생</th><th>글내용</th>
          </tr>
        </thead>
        <tbody>${plan.map(planRow).join("")}</tbody>
      </table>
    </div>`;

  return plan;
}

/** 읽어 들인 엑셀을 확인하고 등록합니다. */
function openPortfolioPreview(entries, onSaved) {
  const years = studentService.getSchoolYears();
  let plan = [];

  const form = openModal({
    title: "포트폴리오 미리보기",
    subtitle: "‘현재학번’ 과 ‘글내용(통합)’ 만 읽었습니다. 확인한 뒤 등록하세요.",
    body: previewBody(entries, years),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "등록", variant: "primary", value: "submit" },
    ],
    onAction: async (action, modalForm) => {
      if (action !== "submit") return;

      clearFormError(modalForm);

      const title = modalForm.elements.title.value.trim();
      if (!title) {
        showFormError(modalForm, "제목을 입력해주세요.");
        return false;
      }

      const rows = plan.filter((row) => row.status === "ready");
      if (rows.length === 0) {
        showFormError(modalForm, "등록할 수 있는 줄이 없습니다. 학년도와 학번을 확인해주세요.");
        return false;
      }

      try {
        const saved = await portfolioService.addMany(
          rows.map((row) => ({
            student: row.student,
            title,
            body: row.body,
            source: "엑셀 업로드",
          }))
        );

        toast(`포트폴리오 ${saved}건을 등록했습니다.`, "success");
        onSaved();
      } catch (error) {
        showFormError(modalForm, error?.message ?? "포트폴리오를 저장하지 못했습니다.");
        return false;
      }

      return true;
    },
  });

  const yearField = form.elements.schoolYear;
  const refresh = () => {
    const year = Number.parseInt(yearField.value, 10);
    plan = renderPlan(form, entries, Number.isNaN(year) ? null : year);
  };

  yearField.addEventListener("change", refresh);
  yearField.addEventListener("input", refresh);
  refresh();
}

/** 업로드한 파일을 읽어 미리보기를 띄웁니다. */
async function handlePortfolioFile(file, onSaved) {
  try {
    const sheets = await readSpreadsheet(file);

    // 두 칸이 가장 많이 잡히는 시트를 고릅니다.
    const parsed = sheets
      .map((sheet) => parsePortfolioSheet(sheet.rows))
      .sort((a, b) => b.entries.length - a.entries.length)[0];

    if (!parsed?.header) {
      toast("‘현재학번’ 과 ‘글내용(통합)’ 칸을 찾지 못했습니다. 머리글 이름을 확인해주세요.", "error");
      return;
    }

    if (parsed.entries.length === 0) {
      toast("엑셀에서 읽을 내용을 찾지 못했습니다.", "error");
      return;
    }

    openPortfolioPreview(parsed.entries, onSaved);
  } catch (error) {
    const message =
      error instanceof SheetError
        ? error.message
        : "파일을 읽지 못했습니다. 엑셀에서 다시 저장한 뒤 시도해주세요.";
    toast(message, "error");
  }
}

/* =========================================================
   보여주기
   ========================================================= */
function entryCard(entry, canEdit) {
  return `
    <article class="post">
      <div class="post__head">
        <h2 class="post__title">${esc(entry.title)}</h2>
        <div class="post__meta">${renderPostMeta(entry)}</div>
      </div>
      ${renderBody(entry.body)}
      ${renderLinks(entry.links)}
      ${
        canEdit
          ? `<div class="post__actions">
               <button class="btn btn--secondary btn--sm" data-edit="${entry.id}">수정</button>
               <button class="btn btn--danger btn--sm" data-remove="${entry.id}">삭제</button>
             </div>`
          : ""
      }
    </article>`;
}

/** 선생님이 등록한 자료. 학생 한 명이 카드 하나입니다. */
function teacherEntryCard(entry) {
  return `
    <article class="post">
      <div class="post__head">
        <h2 class="post__title">${esc(entry.title)}</h2>
        <div class="post__meta">
          ${renderPostMeta(entry)}
          ${entry.source ? `<span class="badge badge--muted">${esc(entry.source)}</span>` : ""}
        </div>
      </div>
      ${renderBody(entry.body)}
      <div class="post__actions">
        <button class="btn btn--secondary btn--sm" data-own-edit="${entry.id}">수정</button>
        <button class="btn btn--danger btn--sm" data-own-remove="${entry.id}">삭제</button>
      </div>
    </article>`;
}

function ownSection(groups) {
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);

  const sections = groups
    .map((group) => {
      const open = expanded.has(group.studentId);
      const number = formatStudentNumber(group.seat);

      return `
        <section class="card card--flush">
          <button class="student-toggle" type="button" data-own-student="${esc(group.studentId)}">
            <span>${number ? `${esc(number)} · ` : ""}${esc(group.name || "이름 없음")}</span>
            <span class="badge badge--muted">${group.entries.length}건</span>
            ${group.student ? "" : `<span class="badge badge--warning">명렬표에 없음</span>`}
            <span class="student-toggle__arrow" aria-hidden="true">${open ? "▲" : "▼"}</span>
          </button>
          ${
            open
              ? `<div class="post-list post-list--nested">
                   ${group.entries.map(teacherEntryCard).join("")}
                 </div>`
              : ""
          }
        </section>`;
    })
    .join("");

  return `
    <section class="card card--flush" style="margin-bottom:16px">
      <div class="card__head">
        <h2 class="section-title">선생님 등록</h2>
        <span class="caption">학생 ${groups.length}명 · ${total}건 · 선생님만 열람</span>
      </div>
    </section>
    ${
      groups.length
        ? `<div class="stack" style="margin-bottom:16px">${sections}</div>`
        : `<section class="card" style="margin-bottom:16px">
             ${emptyState({
               icon: "📄",
               title: hasFilter(filter)
                 ? "조건에 맞는 자료가 없습니다"
                 : "등록한 자료가 없습니다",
               desc: hasFilter(filter)
                 ? "검색 조건을 바꾸거나 초기화해 보세요."
                 : "엑셀을 올리거나 ‘+ 직접 등록’ 으로 학생별 자료를 남겨보세요.",
               action: hasFilter(filter)
                 ? `<button class="btn btn--secondary" data-search-reset="portfolio">검색 조건 초기화</button>`
                 : `<button class="btn btn--primary" data-own-add>+ 직접 등록</button>`,
             })}
           </section>`
    }`;
}

/** 학생이 올린 자료를 학생별로 묶습니다. */
function studentGroups() {
  const groups = new Map();

  for (const entry of portfolios.all()) {
    const list = groups.get(entry.studentUid) ?? [];
    list.push(entry);
    groups.set(entry.studentUid, list);
  }

  const describe = (uid, entries) => {
    const profile = profiles.find(uid) ?? entries.find((e) => e.profile)?.profile;
    if (!profile) return { label: "이름 미등록 학생", profile: null };
    return {
      label: `${profile.grade}학년 ${profile.classNo}반 ${profile.studentNo}번 ${profile.name}`,
      profile,
    };
  };

  const grade = numberOrNull(filter.grade);
  const classNo = numberOrNull(filter.classNo);

  return [...groups.entries()]
    .map(([uid, entries]) => ({ uid, entries, ...describe(uid, entries) }))
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        matches(filter.keyword, entry.title, entry.body)
      ),
    }))
    .filter(
      (group) =>
        group.entries.length > 0 &&
        matches(filter.name, group.profile?.name ?? group.label) &&
        (grade == null || group.profile?.grade === grade) &&
        (classNo == null || group.profile?.classNo === classNo)
    )
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

function uploadedSection(groups) {
  const sections = groups
    .map(({ uid, label, entries }) => {
      const open = expanded.has(uid);
      return `
        <section class="card card--flush">
          <button class="student-toggle" type="button" data-student="${esc(uid)}">
            <span>${esc(label)}</span>
            <span class="badge badge--muted">${entries.length}건</span>
            <span class="student-toggle__arrow" aria-hidden="true">${open ? "▲" : "▼"}</span>
          </button>
          ${
            open
              ? `<div class="post-list post-list--nested">
                   ${entries.map((entry) => entryCard(entry, false)).join("")}
                 </div>`
              : ""
          }
        </section>`;
    })
    .join("");

  return `
    <section class="card card--flush" style="margin-bottom:16px">
      <div class="card__head">
        <h2 class="section-title">학생 업로드</h2>
        <span class="caption">학생 ${groups.length}명</span>
      </div>
    </section>
    ${
      groups.length
        ? `<div class="stack">${sections}</div>`
        : `<section class="card">
             ${emptyState({
               icon: "🎒",
               title: hasFilter(filter)
                 ? "조건에 맞는 자료가 없습니다"
                 : "올라온 포트폴리오가 없습니다",
               desc: hasFilter(filter)
                 ? "검색 조건을 바꾸거나 초기화해 보세요."
                 : "학생이 자기 화면에서 올리면 여기에 학생별로 모입니다.",
             })}
           </section>`
    }`;
}

/* =========================================================
   화면
   ========================================================= */
function renderForTeacher(container) {
  const rerender = () => renderForTeacher(container);

  const own = portfolioService.getGroups({
    name: filter.name,
    grade: numberOrNull(filter.grade),
    classNo: numberOrNull(filter.classNo),
    keyword: filter.keyword,
  });
  const uploaded = studentGroups();

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">포트폴리오</h1>
        <p class="page-subtitle">
          선생님이 등록한 자료와 학생이 올린 자료를 함께 봅니다.
        </p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--secondary" data-upload>📄 엑셀 업로드</button>
        <button class="btn btn--primary" data-own-add>+ 직접 등록</button>
        <input type="file" data-portfolio-file hidden
               accept=".xlsx,.xlsm,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      </div>
    </div>

    <section class="card" style="margin-bottom:16px">
      ${searchBar({
        id: "portfolio",
        filter,
        fields: [...STUDENT_FIELDS, FIELDS.keyword],
      })}
    </section>

    ${ownSection(own)}
    ${uploadedSection(uploaded)}`;

  bindSearchBar(container, {
    id: "portfolio",
    filter,
    fields: [...STUDENT_FIELDS, FIELDS.keyword],
    onChange: rerender,
  });

  const fileInput = container.querySelector("[data-portfolio-file]");

  on(container, "[data-upload]", () => fileInput.click());

  on(
    container,
    "[data-portfolio-file]",
    async () => {
      const file = fileInput.files?.[0];
      // 같은 파일을 다시 골라도 change 가 일어나도록 값을 비웁니다.
      fileInput.value = "";
      if (file) await handlePortfolioFile(file, rerender);
    },
    "change"
  );

  on(container, "[data-own-add]", () => openTeacherEntryForm(null, rerender));

  on(container, "[data-own-edit]", (button) => {
    const entry = portfolioService.find(button.dataset.ownEdit);
    if (entry) openTeacherEntryForm(entry, rerender);
  });

  on(container, "[data-own-remove]", async (button) => {
    const entry = portfolioService.find(button.dataset.ownRemove);
    if (!entry) return;

    const ok = await confirmDialog({
      title: "포트폴리오 삭제",
      message:
        `‘${entry.title}’ 을 삭제할까요?\n` +
        `휴지통으로 들어가며 ${TRASH_DAYS}일 안에는 되살릴 수 있습니다.`,
      confirmLabel: "삭제",
    });
    if (!ok) return;

    try {
      await portfolioService.remove(entry.id);
      toast("포트폴리오를 휴지통으로 옮겼습니다.");
      rerender();
    } catch (error) {
      toast(error?.message ?? "삭제하지 못했습니다.", "error");
    }
  });

  const toggle = (key) => {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    rerender();
  };

  on(container, "[data-own-student]", (button) => toggle(button.dataset.ownStudent));
  on(container, "[data-student]", (button) => toggle(button.dataset.student));
}

/** 학생 화면 — 내 포트폴리오만 보고 고칩니다. */
function renderForStudent(container) {
  const entries = portfolios.mine();
  const rerender = () => renderForStudent(container);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">포트폴리오</h1>
        <p class="page-subtitle">진로 활동을 모아 두는 나만의 공간입니다. 선생님도 볼 수 있습니다.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--primary" data-add>+ 추가</button>
      </div>
    </div>
    ${
      entries.length
        ? `<div class="post-list">${entries.map((e) => entryCard(e, true)).join("")}</div>`
        : `<section class="card">
             ${emptyState({
               icon: "🎒",
               title: "아직 올린 자료가 없습니다",
               desc: "동아리·봉사·독서·진로 체험처럼 남기고 싶은 활동을 적어보세요.",
               action: `<button class="btn btn--primary" data-add>+ 추가</button>`,
             })}
           </section>`
    }`;

  on(container, "[data-add]", () => openEntryForm(null, rerender));

  on(container, "[data-edit]", (button) => {
    const entry = portfolios.find(button.dataset.edit);
    if (entry) openEntryForm(entry, rerender);
  });

  on(container, "[data-remove]", async (button) => {
    const entry = portfolios.find(button.dataset.remove);
    if (!entry) return;

    const ok = await confirmDialog({
      title: "포트폴리오 삭제",
      message: `‘${entry.title}’ 을 삭제할까요?`,
      confirmLabel: "삭제",
    });
    if (!ok) return;

    try {
      await portfolios.remove(entry.id);
      toast("삭제했습니다.");
      rerender();
    } catch {
      // 오류 메시지는 board.js 가 토스트로 알립니다.
    }
  });
}

export function render(container) {
  if (session.role() === TEACHER) renderForTeacher(container);
  else renderForStudent(container);
}
