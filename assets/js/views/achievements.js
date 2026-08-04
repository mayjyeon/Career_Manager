/**
 * 세특 및 활동 — 선생님 전용.
 *
 * 엑셀을 올리거나 직접 적어 넣고, 필요할 때 다시 엑셀로 내보냅니다.
 * 엑셀에서 읽은 ‘모르는 칸’ 은 그대로 보관했다가 내보낼 때 함께 내보냅니다.
 * 바이트 수는 저장하지 않고 내용에서 그때그때 세므로 늘 내용과 맞습니다.
 */
import {
  achievementService,
  byteLength,
  formatStudentNumber,
  studentService,
} from "../services.js";
import { parseAchievementWorkbook, buildAchievementPlan } from "../achievement-sheet.js";
import { readSpreadsheet, SheetError } from "../sheet.js";
import { buildXlsx } from "../xlsx.js";
import { TRASH_DAYS } from "../trash.js";
import {
  FIELDS,
  STUDENT_FIELDS,
  bindSearchBar,
  createFilter,
  hasFilter,
  numberOrNull,
  searchBar,
} from "./search-bar.js";
import {
  clearFormError,
  confirmDialog,
  downloadBlob,
  emptyState,
  esc,
  on,
  openModal,
  showFormError,
  toast,
} from "../ui.js";

export const meta = {
  id: "achievements",
  icon: "📚",
  title: "세특 및 활동",
  // 선생님 계정 안(users/{uid}/achievements)에 있고, 이 화면을 열 때 붙입니다.
  owns: ["achievements"],
};

/** 화면을 다시 그려도 검색 조건은 유지합니다. */
const SEARCH_FIELDS = [
  ...STUDENT_FIELDS,
  { ...FIELDS.keyword, placeholder: "세특 내용으로 검색" },
];
const filter = createFilter(SEARCH_FIELDS);

/** 일괄 삭제를 위해 고른 세특. */
const selected = new Set();

const number = (value) => value.toLocaleString("ko-KR");

/* =========================================================
   덧붙인 칸 입력
   ========================================================= */
/** 칸 이름과 값을 한 줄씩 적습니다. 이름을 비우면 그 줄은 버립니다. */
function extraRow(label = "", value = "") {
  return `
    <div class="form-grid" data-extra-row>
      <div class="field">
        <label class="field__label">칸 이름</label>
        <input class="input" data-extra-label value="${esc(label)}" placeholder="예: 과목" />
      </div>
      <div class="field">
        <label class="field__label">값</label>
        <input class="input" data-extra-value value="${esc(value)}" placeholder="예: 국어" />
      </div>
    </div>`;
}

/**
 * 폼에서 덧붙인 칸을 읽습니다.
 * @returns {Array<{ label: string, value: string }>}
 */
function readExtras(form) {
  return [...form.querySelectorAll("[data-extra-row]")]
    .map((row) => ({
      label: row.querySelector("[data-extra-label]").value.trim(),
      value: row.querySelector("[data-extra-value]").value.trim(),
    }))
    .filter((extra) => extra.label && extra.value);
}

/** 내용을 적는 동안 바이트 수를 같이 보여 줍니다. */
function bindByteCounter(form) {
  const input = form.elements.content;
  const output = form.querySelector("[data-bytes]");
  if (!input || !output) return;

  const update = () => {
    output.textContent = `${number(byteLength(input.value))}바이트`;
  };

  input.addEventListener("input", update);
  update();
}

/* =========================================================
   직접 작성 (선생님)
   ========================================================= */
function achievementFormBody(entry, students) {
  // 이미 쓰고 있는 칸은 미리 보여 주고, 새로 만들 수 있게 빈 줄을 하나 답니다.
  const extras = entry
    ? (entry.extras ?? [])
    : achievementService.getExtraColumns().map((label) => ({ label, value: "" }));

  return `
    ${
      entry
        ? ""
        : `<div class="field">
             <label class="field__label" for="a-student">학생</label>
             <select class="select" id="a-student" name="studentId">
               <option value="">학생을 선택하세요</option>
               ${students
                 .map(
                   (student) =>
                     `<option value="${student.id}">${esc(student.display)}</option>`
                 )
                 .join("")}
             </select>
           </div>`
    }
    <div class="field">
      <label class="field__label" for="a-content">
        세특 내용 <span class="caption" data-bytes></span>
      </label>
      <textarea class="textarea" id="a-content" name="content" rows="10"
                placeholder="세부능력 및 특기사항 또는 활동 내용을 적습니다.">${esc(entry?.content ?? "")}</textarea>
      <p class="caption">바이트 수는 나이스와 같은 기준입니다(한글 3바이트, 영문·숫자·기호·공백 1바이트).</p>
    </div>
    <div data-extras>${extras.map((extra) => extraRow(extra.label, extra.value)).join("")}</div>
    <button class="btn btn--ghost btn--sm" type="button" data-add-extra>+ 칸 추가</button>
    <p class="caption" style="margin-top:6px">
      과목·학기·비고처럼 덧붙인 칸은 엑셀로 내보낼 때 그대로 함께 나갑니다.
    </p>`;
}

/** 세특 한 건을 적거나 고칩니다. entry 가 없으면 새로 씁니다. */
function openAchievementForm(entry, onSaved) {
  const students = studentService.getStudents({ includeInactive: true });

  if (!entry && students.length === 0) {
    toast("먼저 학생 관리에서 학생을 등록해주세요.", "error");
    return;
  }

  const form = openModal({
    title: entry ? "세특 수정" : "세특 직접 작성",
    subtitle: entry
      ? `${entry.studentName ?? ""} 학생의 세특을 고칩니다.`
      : "선생님만 볼 수 있습니다. 학생 화면에는 나오지 않습니다.",
    body: achievementFormBody(entry, students),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: async (action, modalForm) => {
      if (action !== "submit") return;

      clearFormError(modalForm);

      const content = modalForm.elements.content.value.trim();
      if (!content) {
        showFormError(modalForm, "세특 내용을 입력해주세요.");
        return false;
      }

      const extras = readExtras(modalForm);

      if (entry) {
        const result = achievementService.update(entry.id, { content, extras });
        if (!result.ok) {
          showFormError(modalForm, result.error);
          return false;
        }
        toast("세특을 수정했습니다.", "success");
        onSaved();
        return true;
      }

      const student = students.find(
        (item) => item.id === modalForm.elements.studentId.value
      );
      if (!student) {
        showFormError(modalForm, "학생을 선택해주세요.");
        return false;
      }

      try {
        await achievementService.addMany([
          { student, content, extras, source: "직접 작성" },
        ]);
      } catch (error) {
        showFormError(modalForm, error?.message ?? "저장하지 못했습니다.");
        return false;
      }

      toast("세특을 저장했습니다.", "success");
      onSaved();
      return true;
    },
  });

  bindByteCounter(form);

  on(form, "[data-add-extra]", () => {
    form.querySelector("[data-extras]").insertAdjacentHTML("beforeend", extraRow());
  });
}

/* =========================================================
   엑셀 업로드
   ========================================================= */
const PLAN_STATUS = {
  ready: `<span class="badge badge--success">등록</span>`,
  noStudent: `<span class="badge badge--warning">학생 없음</span>`,
  error: `<span class="badge badge--danger">확인 필요</span>`,
};

function planRow(row) {
  const seat =
    row.grade == null || row.classNo == null || row.studentNo == null
      ? "—"
      : `${row.grade}학년 ${row.classNo}반 ${row.studentNo}번`;

  // 학번 칸이 없는 파일이면 학년·반·번호를 모아 5자리로 만들어 보여 줍니다.
  const studentNumber = formatStudentNumber(row) || row.rawNumber || "—";

  return `
    <tr>
      <td>${PLAN_STATUS[row.status]}</td>
      <td class="nowrap">${esc(studentNumber)}</td>
      <td class="nowrap">${esc(seat)}</td>
      <td class="nowrap">${esc(row.student?.name || row.name || "—")}</td>
      <td class="num nowrap">${number(byteLength(row.content))}</td>
      <td>
        ${esc(row.content.slice(0, 50))}${row.content.length > 50 ? "…" : ""}
        ${row.message ? `<div class="caption">${esc(row.message)}</div>` : ""}
      </td>
    </tr>`;
}

function previewBody(parsed, years) {
  const { entries, context } = parsed;
  const year = context.schoolYear ?? years[0] ?? new Date().getFullYear();

  // 파일에서 찾아낸 ‘모르는 칸’ 을 알려 줍니다.
  const extras = [];
  for (const entry of entries) {
    for (const extra of entry.extras) {
      if (!extras.includes(extra.label)) extras.push(extra.label);
    }
  }

  // 표 안에 학년·반 칸이 없는 줄이 있으면 여기서 채워야 합니다.
  const needsGrade = entries.some((entry) => entry.grade == null);
  const needsClass = entries.some((entry) => entry.classNo == null);

  const yearOptions = [...new Set([year, ...years])].sort((a, b) => b - a);

  return `
    <div class="form-grid form-grid--3">
      <div class="field">
        <label class="field__label" for="a-year">학년도</label>
        ${
          years.length
            ? `<select class="select" id="a-year" name="schoolYear">
                 ${yearOptions
                   .map(
                     (value) =>
                       `<option value="${value}" ${value === year ? "selected" : ""}>
                          ${value}학년도
                        </option>`
                   )
                   .join("")}
               </select>`
            : `<input class="input" id="a-year" name="schoolYear" inputmode="numeric" value="${year}" />`
        }
      </div>
      <div class="field">
        <label class="field__label" for="a-grade">학년</label>
        <input class="input" id="a-grade" name="grade" inputmode="numeric"
               value="${context.grade ?? ""}" placeholder="${needsGrade ? "예: 1" : "파일에서 읽음"}" />
      </div>
      <div class="field">
        <label class="field__label" for="a-class">반</label>
        <input class="input" id="a-class" name="classNo" inputmode="numeric"
               value="${context.classNo ?? ""}" placeholder="${needsClass ? "예: 3" : "파일에서 읽음"}" />
      </div>
    </div>
    <p class="caption" style="margin-top:-4px">
      ${
        needsGrade || needsClass
          ? `엑셀에 ${[needsGrade && "학년", needsClass && "반"]
              .filter(Boolean)
              .join("·")} 칸이 없는 줄이 있습니다. 여기 적은 값으로 채웁니다.`
          : "엑셀에 있는 학년·반을 씁니다. 비어 있는 줄에만 여기 값을 씁니다."
      }
    </p>
    ${
      extras.length
        ? `<p class="caption">
             덧붙인 칸 ${extras.length}개를 함께 보관합니다:
             ${extras.map((label) => `<b>${esc(label)}</b>`).join(", ")}
           </p>`
        : ""
    }
    <div data-plan></div>`;
}

/** 고른 학년도·학년·반에 맞춰 미리보기 표를 다시 그립니다. */
function renderPlan(form, entries, defaults) {
  const plan = buildAchievementPlan(entries, defaults, (seat) =>
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
            <th>상태</th><th>학번</th><th>자리</th><th>이름</th>
            <th class="num">바이트</th><th>세특 내용</th>
          </tr>
        </thead>
        <tbody>${plan.map(planRow).join("")}</tbody>
      </table>
    </div>`;

  return plan;
}

function openImportPreview(parsed, onSaved) {
  const years = studentService.getSchoolYears();
  let plan = [];

  const form = openModal({
    title: "세특 미리보기",
    subtitle:
      parsed.sheets.length > 1
        ? `시트 ${parsed.sheets.length}개(${parsed.sheets.join(", ")})를 함께 읽었습니다.`
        : "학번(또는 학년·반·번호)으로 학생을 찾아 붙입니다. 확인한 뒤 등록하세요.",
    body: previewBody(parsed, years),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "등록", variant: "primary", value: "submit" },
    ],
    onAction: async (action, modalForm) => {
      if (action !== "submit") return;

      clearFormError(modalForm);

      const rows = plan.filter((row) => row.status === "ready");
      if (rows.length === 0) {
        showFormError(modalForm, "등록할 수 있는 줄이 없습니다. 학년도와 학번을 확인해주세요.");
        return false;
      }

      try {
        const saved = await achievementService.addMany(
          rows.map((row) => ({
            student: row.student,
            content: row.content,
            extras: row.extras,
            source: "엑셀 업로드",
          }))
        );

        toast(`세특 ${saved}건을 등록했습니다.`, "success");
        onSaved();
      } catch (error) {
        showFormError(modalForm, error?.message ?? "세특을 저장하지 못했습니다.");
        return false;
      }

      return true;
    },
  });

  const intOf = (name) => {
    const value = Number.parseInt(form.elements[name].value, 10);
    return Number.isNaN(value) ? null : value;
  };

  const refresh = () => {
    plan = renderPlan(form, parsed.entries, {
      schoolYear: intOf("schoolYear"),
      grade: intOf("grade"),
      classNo: intOf("classNo"),
    });
  };

  for (const name of ["schoolYear", "grade", "classNo"]) {
    form.elements[name].addEventListener("change", refresh);
    form.elements[name].addEventListener("input", refresh);
  }

  refresh();
}

async function handleFile(file, onSaved) {
  try {
    const parsed = parseAchievementWorkbook(await readSpreadsheet(file));

    // 무엇이 없어서 못 읽었는지 그대로 알려 줍니다.
    if (parsed.missing?.length) {
      toast(
        `${parsed.missing.join(" 과 ")} 칸을 찾지 못했습니다. ` +
          "학번 한 칸이거나 반·번호 두 칸이면 읽을 수 있습니다.",
        "error"
      );
      return;
    }

    if (parsed.entries.length === 0) {
      toast("엑셀에서 읽을 내용을 찾지 못했습니다.", "error");
      return;
    }

    openImportPreview(parsed, onSaved);
  } catch (error) {
    const message =
      error instanceof SheetError
        ? error.message
        : "파일을 읽지 못했습니다. 엑셀에서 다시 저장한 뒤 시도해주세요.";
    toast(message, "error");
  }
}

/* =========================================================
   엑셀 내보내기
   ========================================================= */
function openExport(found, total) {
  const filtered = hasFilter(filter);
  const today = new Date().toISOString().slice(0, 10);

  openModal({
    title: "세특 엑셀 내보내기",
    subtitle: "학번 순으로 정리하고 바이트 수를 다시 세어 내보냅니다.",
    body: `
      ${
        filtered
          ? `<div class="field">
               <label class="field__label" for="x-scope">범위</label>
               <select class="select" id="x-scope" name="scope">
                 <option value="found">검색 결과 ${number(found.length)}건</option>
                 <option value="all">전체 ${number(total)}건</option>
               </select>
             </div>`
          : ""
      }
      <div class="field">
        <label class="field__label" for="x-name">파일 이름</label>
        <input class="input" id="x-name" name="filename" value="세특_${today}" />
      </div>
      <p class="caption">
        학번·이름·세특 내용·바이트 수 뒤에 덧붙인 칸이 그대로 따라 나갑니다.
        엑셀(.xlsx)로 저장되며 구글 스프레드시트에서도 열립니다.
      </p>`,
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "내보내기", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);

      const entries =
        filtered && form.elements.scope.value === "found"
          ? found
          : achievementService.getEntries();

      if (entries.length === 0) {
        showFormError(form, "내보낼 세특이 없습니다.");
        return false;
      }

      const name = form.elements.filename.value.trim() || "세특";

      try {
        const { columns, rows } = achievementService.toSheet(entries);
        const blob = await buildXlsx({ sheets: [{ name: "세특 및 활동", columns, rows }] });

        downloadBlob(blob, `${name}.xlsx`);
        toast(`세특 ${number(entries.length)}건을 내보냈습니다.`, "success");
      } catch (error) {
        showFormError(form, error?.message ?? "파일을 만들지 못했습니다.");
        return false;
      }

      return true;
    },
  });
}

/* =========================================================
   보여주기
   ========================================================= */
function entryCard(entry) {
  const seat = formatStudentNumber(entry);

  return `
    <article class="session">
      <div class="session__head">
        <label class="check-inline">
          <input type="checkbox" data-select="${entry.id}"
                 aria-label="${esc(entry.name)} 세특 선택" ${selected.has(entry.id) ? "checked" : ""} />
        </label>
        <span class="session__date">${esc(seat || "학번 없음")}</span>
        <span class="session__no">${esc(entry.name || "이름 없음")}</span>
        <span class="badge badge--muted">${number(entry.bytes)}바이트</span>
        ${(entry.extras ?? [])
          .map(
            (extra) =>
              `<span class="badge badge--muted">${esc(extra.label)}: ${esc(extra.value)}</span>`
          )
          .join("")}
        ${entry.student ? "" : `<span class="badge badge--warning">명렬표에 없음</span>`}
      </div>
      <p class="session__content">${esc(entry.content)}</p>
      <div class="session__actions">
        <button class="btn btn--secondary btn--sm" data-edit="${entry.id}">수정</button>
        <button class="btn btn--danger btn--sm" data-remove="${entry.id}">삭제</button>
      </div>
    </article>`;
}

export function render(container, { navigate }) {
  const entries = achievementService.getEntries({
    name: filter.name,
    grade: numberOrNull(filter.grade),
    classNo: numberOrNull(filter.classNo),
    keyword: filter.keyword,
  });

  const total = achievementService.getTotalCount();
  const filtered = hasFilter(filter);
  const rerender = () => render(container, { navigate });

  // 검색 조건이 바뀌어 사라진 항목은 선택에서도 뺍니다.
  const visible = new Set(entries.map((entry) => entry.id));
  for (const id of selected) if (!visible.has(id)) selected.delete(id);
  const chosen = [...selected];

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">세특 및 활동</h1>
        <p class="page-subtitle">
          ${
            total
              ? `${number(entries.length)}건 조회 · 평균 ${number(
                  entries.length ? Math.round(totalBytes / entries.length) : 0
                )}바이트`
              : "선생님만 보는 세부능력 및 특기사항입니다."
          }
        </p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--secondary" data-upload>📄 엑셀 업로드</button>
        <button class="btn btn--secondary" data-export ${total ? "" : "disabled"}>
          ⬇ 엑셀 내보내기
        </button>
        <button class="btn btn--primary" data-add>+ 직접 작성</button>
        <input type="file" data-file hidden
               accept=".xlsx,.xlsm,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      </div>
    </div>

    ${
      total
        ? `<section class="card" style="margin-bottom:16px">
             ${searchBar({ id: "achievements", filter, fields: SEARCH_FIELDS })}
           </section>`
        : ""
    }

    ${
      chosen.length
        ? `<div class="bulk-bar">
             <span><b>${number(chosen.length)}건</b> 선택됨</span>
             <button class="btn btn--danger btn--sm" data-bulk-delete>선택 삭제</button>
             <button class="btn btn--ghost btn--sm" data-bulk-clear>선택 해제</button>
           </div>`
        : ""
    }

    <section class="card">
      ${
        entries.length
          ? `<div class="card__head">
               <h2 class="section-title">세특 ${number(entries.length)}건</h2>
               <label class="check-inline caption">
                 <input type="checkbox" data-select-all
                        ${chosen.length && chosen.length === entries.length ? "checked" : ""} />
                 모두 선택
               </label>
             </div>
             <div class="timeline">${entries.map(entryCard).join("")}</div>`
          : emptyState(
              filtered
                ? {
                    icon: "🔍",
                    title: "조건에 맞는 세특이 없습니다",
                    desc: "검색 조건을 바꾸거나 초기화해 보세요.",
                    action: `<button class="btn btn--secondary" data-search-reset="achievements">검색 조건 초기화</button>`,
                  }
                : {
                    icon: "📚",
                    title: "등록된 세특이 없습니다",
                    desc: "엑셀을 올리거나 ‘직접 작성’ 으로 남겨보세요. 학번·이름·세특 내용·바이트 수 칸을 읽습니다.",
                    action: `<button class="btn btn--primary" data-upload>📄 엑셀 업로드</button>`,
                  }
            )
      }
    </section>`;

  /* --- 이벤트 --- */
  bindSearchBar(container, {
    id: "achievements",
    filter,
    fields: SEARCH_FIELDS,
    onChange: rerender,
  });

  const fileInput = container.querySelector("[data-file]");

  on(container, "[data-upload]", () => fileInput.click());

  on(
    container,
    "[data-file]",
    async () => {
      const file = fileInput.files?.[0];
      // 같은 파일을 다시 골라도 change 가 일어나도록 값을 비웁니다.
      fileInput.value = "";
      if (file) await handleFile(file, rerender);
    },
    "change"
  );

  on(container, "[data-export]", () => openExport(entries, total));
  on(container, "[data-add]", () => openAchievementForm(null, rerender));

  on(container, "[data-edit]", (button) => {
    const entry = achievementService.find(button.dataset.edit);
    if (entry) openAchievementForm(entry, rerender);
  });

  on(container, "[data-remove]", async (button) => {
    const entry = achievementService.find(button.dataset.remove);
    if (!entry) return;

    const ok = await confirmDialog({
      title: "세특 삭제",
      message:
        `${entry.studentName ?? ""} 학생의 세특을 삭제할까요?\n` +
        `휴지통으로 들어가며 ${TRASH_DAYS}일 안에는 되살릴 수 있습니다.`,
      confirmLabel: "삭제",
    });
    if (!ok) return;

    try {
      await achievementService.remove(entry.id);
      toast("세특을 휴지통으로 옮겼습니다.");
      rerender();
    } catch (error) {
      toast(error?.message ?? "삭제하지 못했습니다.", "error");
    }
  });

  /* --- 일괄 삭제 --- */
  on(
    container,
    "[data-select]",
    (box) => {
      if (box.checked) selected.add(box.dataset.select);
      else selected.delete(box.dataset.select);
      rerender();
    },
    "change"
  );

  on(
    container,
    "[data-select-all]",
    (box) => {
      if (box.checked) entries.forEach((entry) => selected.add(entry.id));
      else selected.clear();
      rerender();
    },
    "change"
  );

  on(container, "[data-bulk-clear]", () => {
    selected.clear();
    rerender();
  });

  on(container, "[data-bulk-delete]", async () => {
    const ok = await confirmDialog({
      title: "세특 삭제",
      message:
        `고른 세특 ${number(chosen.length)}건을 삭제할까요?\n` +
        `휴지통으로 들어가며 ${TRASH_DAYS}일 안에는 되살릴 수 있습니다.`,
      confirmLabel: "삭제",
    });
    if (!ok) return;

    try {
      await achievementService.remove(chosen);
      toast(`세특 ${number(chosen.length)}건을 휴지통으로 옮겼습니다.`);
      selected.clear();
      rerender();
    } catch (error) {
      toast(error?.message ?? "삭제하지 못했습니다.", "error");
    }
  });
}
