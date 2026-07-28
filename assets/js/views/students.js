/** 학생 관리 — 검색, 추가, 수정, 비활성화, 명렬표 업로드, 학생 계정 연결 확인. */
import { studentService } from "../services.js";
import { profiles } from "../board.js";
import { readSpreadsheet, SheetError } from "../sheet.js";
import { parseRoster, buildImportPlan } from "../roster.js";
import {
  esc,
  initials,
  emptyState,
  openModal,
  confirmDialog,
  showFormError,
  clearFormError,
  toast,
} from "../ui.js";

export const meta = { id: "students", icon: "👥", title: "학생 관리" };

// 화면을 다시 그려도 검색 조건은 유지합니다.
const filter = { name: "", grade: "", classNo: "" };

function row(item) {
  return `
    <tr data-id="${item.id}">
      <td>
        <div class="person">
          <div class="avatar" aria-hidden="true">${esc(initials(item.name))}</div>
          <div>
            <div class="person__name">${esc(item.name)}</div>
            <div class="person__sub">${esc(item.affiliation)}</div>
          </div>
        </div>
      </td>
      <td class="num"><span class="badge badge--muted">${item.sessionCount}회</span></td>
      <td>${item.memo ? esc(item.memo) : `<span class="caption">—</span>`}</td>
      <td class="actions">
        <button class="btn btn--secondary btn--sm" data-edit="${item.id}">수정</button>
        <button class="btn btn--danger btn--sm" data-deactivate="${item.id}">비활성화</button>
      </td>
    </tr>`;
}

function studentFormBody(data) {
  const year = data?.schoolYear ?? new Date().getFullYear();
  const value = (v) => (v ? esc(v) : "");

  return `
    <div class="form-grid form-grid--4">
      <div class="field">
        <label class="field__label" for="f-year">학년도</label>
        <input class="input" id="f-year" name="schoolYear" inputmode="numeric" value="${year}" />
      </div>
      <div class="field">
        <label class="field__label" for="f-grade">학년</label>
        <input class="input" id="f-grade" name="grade" inputmode="numeric" value="${value(data?.grade)}" />
      </div>
      <div class="field">
        <label class="field__label" for="f-class">반</label>
        <input class="input" id="f-class" name="classNo" inputmode="numeric" value="${value(data?.classNo)}" />
      </div>
      <div class="field">
        <label class="field__label" for="f-no">번호</label>
        <input class="input" id="f-no" name="studentNo" inputmode="numeric" value="${value(data?.studentNo)}" />
      </div>
    </div>
    <div class="field">
      <label class="field__label" for="f-name">이름</label>
      <input class="input" id="f-name" name="name" value="${esc(data?.name ?? "")}"
             placeholder="학생 이름" />
    </div>
    <div class="field">
      <label class="field__label" for="f-memo">메모</label>
      <textarea class="textarea" id="f-memo" name="memo"
                placeholder="희망 진로, 특이 사항 등">${esc(data?.memo ?? "")}</textarea>
    </div>`;
}

/** 학생 추가/수정 모달. data 가 null 이면 추가입니다. */
function openStudentForm(data, onSaved) {
  openModal({
    title: data ? "학생 수정" : "학생 추가",
    subtitle: data ? `${data.name} 학생의 정보를 수정합니다.` : "새 학생을 등록합니다.",
    body: studentFormBody(data),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const get = (name) => form.elements[name].value.trim();

      const name = get("name");
      if (!name) return showFormError(form, "이름을 입력해주세요."), false;

      const numeric = [
        ["schoolYear", "학년도"],
        ["grade", "학년"],
        ["classNo", "반"],
        ["studentNo", "번호"],
      ];

      const values = {};
      for (const [field, label] of numeric) {
        const parsed = Number.parseInt(get(field), 10);
        if (Number.isNaN(parsed)) {
          return showFormError(form, `${label}을(를) 숫자로 입력해주세요.`), false;
        }
        values[field] = parsed;
      }

      const memo = get("memo") || null;

      const result = data
        ? studentService.update(
            data.id,
            values.schoolYear,
            values.grade,
            values.classNo,
            values.studentNo,
            name,
            memo
          )
        : studentService.add(
            values.schoolYear,
            values.grade,
            values.classNo,
            values.studentNo,
            name,
            memo
          );

      if (!result.ok) {
        showFormError(form, result.error);
        return false;
      }

      toast(data ? "학생 정보를 수정했습니다." : "학생을 추가했습니다.", "success");
      onSaved();
      return true;
    },
  });
}

/* =========================================================
   명렬표 업로드
   ========================================================= */
const STATUS_LABEL = {
  new: `<span class="badge badge--success">신규</span>`,
  duplicate: `<span class="badge badge--warning">중복</span>`,
  error: `<span class="badge badge--danger">확인 필요</span>`,
};

function previewRow(row) {
  const seat =
    row.status === "error"
      ? "—"
      : `${row.grade}학년 ${row.classNo}반 ${row.studentNo}번`;

  const action =
    row.status === "duplicate"
      ? `<select class="select select--sm" data-action-for="${row.index}">
           <option value="skip">건너뛰기</option>
           <option value="overwrite">덮어쓰기</option>
         </select>`
      : row.status === "new"
        ? `<span class="caption">등록</span>`
        : `<span class="caption">제외</span>`;

  return `
    <tr>
      <td>${STATUS_LABEL[row.status]}</td>
      <td class="nowrap">${esc(seat)}</td>
      <td>${esc(row.name)}</td>
      <td>${row.gender ? esc(row.gender) : `<span class="caption">—</span>`}</td>
      <td>${row.message ? `<span class="caption">${esc(row.message)}</span>` : ""}</td>
      <td class="actions">${action}</td>
    </tr>`;
}

function previewBody(parsed, plan) {
  const count = (status) => plan.filter((row) => row.status === status).length;

  const info = [
    parsed.schoolYear ? `${parsed.schoolYear}학년도` : null,
    parsed.grade ? `${parsed.grade}학년` : null,
    `${parsed.layout} 형식`,
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <p class="import-summary">
      ${esc(info)}에서 <b>${plan.length}명</b>을 읽었습니다.
      신규 ${count("new")}명 · 중복 ${count("duplicate")}명 · 확인 필요 ${count("error")}명
    </p>
    ${
      count("duplicate")
        ? `<div class="import-bulk">
             <span class="caption">중복된 자리를</span>
             <button class="btn btn--ghost btn--sm" type="button" data-bulk="skip">모두 건너뛰기</button>
             <button class="btn btn--ghost btn--sm" type="button" data-bulk="overwrite">모두 덮어쓰기</button>
           </div>`
        : ""
    }
    <div class="table-wrap table-wrap--scroll">
      <table class="table table--compact">
        <thead>
          <tr>
            <th>상태</th><th>자리</th><th>이름</th><th>성별</th><th>안내</th><th class="actions">처리</th>
          </tr>
        </thead>
        <tbody>${plan.map(previewRow).join("")}</tbody>
      </table>
    </div>`;
}

/** 읽어 들인 명렬표를 확인하고 등록합니다. */
function openImportPreview(parsed, onSaved) {
  const plan = buildImportPlan(parsed.entries, (key) => studentService.findSeat(key));

  if (plan.length === 0) {
    toast("명렬표에서 학생을 찾지 못했습니다. 파일 형식을 확인해주세요.", "error");
    return;
  }

  const form = openModal({
    title: "명렬표 미리보기",
    subtitle: "등록할 내용을 확인한 뒤 저장하세요.",
    body: previewBody(parsed, plan),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "등록", variant: "primary", value: "submit" },
    ],
    onAction: async (action) => {
      if (action !== "submit") return;

      const rows = plan.filter((row) => row.action !== "skip");
      if (rows.length === 0) {
        toast("등록할 학생이 없습니다.");
        return true;
      }

      try {
        const result = await studentService.importRoster(rows);
        const parts = [
          result.added ? `${result.added}명 등록` : null,
          result.updated ? `${result.updated}명 수정` : null,
        ].filter(Boolean);

        toast(`${parts.join(" · ")}했습니다.`, "success");
        onSaved();
      } catch (error) {
        toast(error?.message ?? "명렬표를 저장하지 못했습니다.", "error");
      }

      return true;
    },
  });

  const selects = form.querySelectorAll("[data-action-for]");

  selects.forEach((select) =>
    select.addEventListener("change", () => {
      const row = plan[Number.parseInt(select.dataset.actionFor, 10)];
      if (row) row.action = select.value;
    })
  );

  form.querySelectorAll("[data-bulk]").forEach((button) =>
    button.addEventListener("click", () => {
      selects.forEach((select) => {
        select.value = button.dataset.bulk;
        select.dispatchEvent(new Event("change"));
      });
    })
  );
}

/** 업로드한 파일을 읽어 미리보기를 띄웁니다. */
async function handleRosterFile(file, onSaved) {
  try {
    const sheets = await readSpreadsheet(file);

    // 학생이 가장 많이 잡히는 시트를 고릅니다.
    const parsedSheets = sheets
      .map((sheet) => parseRoster(sheet.rows))
      .sort((a, b) => b.entries.length - a.entries.length);

    const parsed = parsedSheets[0];

    if (!parsed || parsed.entries.length === 0) {
      toast("명렬표에서 학생을 찾지 못했습니다. ‘○반’ 제목과 ‘번호’ 열이 있는지 확인해주세요.", "error");
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
   학생 계정 연결 확인
   ========================================================= */
const LINK_STATUS = {
  matched: `<span class="badge badge--success">연결됨</span>`,
  nameMismatch: `<span class="badge badge--warning">이름 다름</span>`,
  notFound: `<span class="badge badge--danger">명렬표에 없음</span>`,
};

/**
 * 학생이 스스로 적은 정보를 명렬표와 맞춰 봅니다.
 * 학생 계정은 각자 로그인해 등록하므로, 잘못 적은 경우를 여기서 찾습니다.
 */
function accountSection() {
  const accounts = profiles
    .all()
    .map((profile) => ({ profile, ...studentService.matchProfile(profile) }))
    .sort(
      (a, b) =>
        (a.profile.grade ?? 0) - (b.profile.grade ?? 0) ||
        (a.profile.classNo ?? 0) - (b.profile.classNo ?? 0) ||
        (a.profile.studentNo ?? 0) - (b.profile.studentNo ?? 0)
    );

  if (accounts.length === 0) return "";

  const problems = accounts.filter((row) => row.status !== "matched").length;

  const rows = accounts
    .map(
      ({ profile, status, student }) => `
      <tr>
        <td>${LINK_STATUS[status]}</td>
        <td class="nowrap">${profile.grade}학년 ${profile.classNo}반 ${profile.studentNo}번</td>
        <td>${esc(profile.name)}</td>
        <td class="caption">${esc(profile.email ?? "")}</td>
        <td class="caption">
          ${
            status === "nameMismatch"
              ? `명렬표에는 ‘${esc(student.name)}’ 학생입니다.`
              : status === "notFound"
                ? "그 자리에 등록된 학생이 없습니다."
                : ""
          }
        </td>
      </tr>`
    )
    .join("");

  return `
    <section class="card card--flush" style="margin-top:16px">
      <div class="card__head">
        <h2 class="section-title">학생 계정 연결</h2>
        <span class="caption">
          ${accounts.length}명 등록${problems ? ` · 확인 필요 ${problems}명` : ""}
        </span>
      </div>
      <div class="table-wrap">
        <table class="table table--compact">
          <thead>
            <tr><th>상태</th><th>자리</th><th>이름</th><th>계정</th><th>안내</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="caption" style="padding:0 18px 16px">
        학생이 직접 적은 값이라 틀릴 수 있습니다. ‘이름 다름’ 이나 ‘명렬표에 없음’ 은
        학생에게 다시 확인해 주세요.
      </p>
    </section>`;
}

export function render(container) {
  const grade = Number.parseInt(filter.grade, 10);
  const classNo = Number.parseInt(filter.classNo, 10);

  const items = studentService.getStudents(
    filter.name,
    Number.isNaN(grade) ? null : grade,
    Number.isNaN(classNo) ? null : classNo
  );

  const hasFilter = Boolean(filter.name || filter.grade || filter.classNo);
  const rerender = () => render(container);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">학생 관리</h1>
        <p class="page-subtitle">학생 ${items.length}명이 조회되었습니다.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--secondary" data-upload>📄 명렬표 업로드</button>
        <button class="btn btn--primary" data-add>+ 학생 추가</button>
        <input type="file" data-roster-file hidden
               accept=".xlsx,.xlsm,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      </div>
    </div>

    <section class="card" style="margin-bottom:16px">
      <form class="filter-bar" data-search>
        <div class="field field--name">
          <label class="field__label" for="q-name">이름</label>
          <input class="input" id="q-name" name="name" value="${esc(filter.name)}"
                 placeholder="이름으로 검색" />
        </div>
        <div class="field field--num">
          <label class="field__label" for="q-grade">학년</label>
          <input class="input" id="q-grade" name="grade" inputmode="numeric"
                 value="${esc(filter.grade)}" />
        </div>
        <div class="field field--num">
          <label class="field__label" for="q-class">반</label>
          <input class="input" id="q-class" name="classNo" inputmode="numeric"
                 value="${esc(filter.classNo)}" />
        </div>
        <button class="btn btn--secondary" type="submit">검색</button>
        ${hasFilter ? `<button class="btn btn--ghost" type="button" data-reset>초기화</button>` : ""}
      </form>
    </section>

    <section class="card card--flush">
      ${
        items.length
          ? `<div class="table-wrap">
               <table class="table">
                 <thead>
                   <tr>
                     <th>학생</th>
                     <th class="num">상담</th>
                     <th>메모</th>
                     <th class="actions">관리</th>
                   </tr>
                 </thead>
                 <tbody>${items.map(row).join("")}</tbody>
               </table>
             </div>`
          : emptyState({
              icon: hasFilter ? "🔍" : "👥",
              title: hasFilter ? "조건에 맞는 학생이 없습니다" : "등록된 학생이 없습니다",
              desc: hasFilter
                ? "검색 조건을 바꾸거나 초기화해 보세요."
                : "‘학생 추가’로 첫 학생을 등록해 보세요.",
              action: hasFilter
                ? `<button class="btn btn--secondary" data-reset>검색 조건 초기화</button>`
                : `<button class="btn btn--primary" data-add>+ 학생 추가</button>`,
            })
      }
    </section>

    ${accountSection()}`;

  /* --- 이벤트 --- */
  const form = container.querySelector("[data-search]");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    filter.name = form.elements.name.value.trim();
    filter.grade = form.elements.grade.value.trim();
    filter.classNo = form.elements.classNo.value.trim();
    rerender();
  });

  container.querySelectorAll("[data-reset]").forEach((btn) =>
    btn.addEventListener("click", () => {
      filter.name = filter.grade = filter.classNo = "";
      rerender();
    })
  );

  container.querySelectorAll("[data-add]").forEach((btn) =>
    btn.addEventListener("click", () => openStudentForm(null, rerender))
  );

  const fileInput = container.querySelector("[data-roster-file]");

  container.querySelector("[data-upload]")?.addEventListener("click", () => fileInput.click());

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    // 같은 파일을 다시 골라도 change 가 일어나도록 값을 비웁니다.
    fileInput.value = "";
    if (file) await handleRosterFile(file, rerender);
  });

  container.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const data = studentService.getEditData(btn.dataset.edit);
      if (data) openStudentForm(data, rerender);
    })
  );

  container.querySelectorAll("[data-deactivate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deactivate;
      const student = items.find((s) => s.id === id);
      if (!student) return;

      const ok = await confirmDialog({
        title: "학생 비활성화",
        message: `${student.name} 학생을 비활성화할까요?\n상담 기록은 삭제되지 않습니다.`,
        confirmLabel: "비활성화",
      });

      if (!ok) return;

      studentService.deactivate(id);
      toast(`${student.name} 학생을 비활성화했습니다.`);
      rerender();
    })
  );
}
