/** 학생 관리 — 검색, 추가, 수정, 비활성화. */
import { studentService } from "../services.js";
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
      <button class="btn btn--primary" data-add>+ 학생 추가</button>
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
    </section>`;

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

  container.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const data = studentService.getEditData(Number(btn.dataset.edit));
      if (data) openStudentForm(data, rerender);
    })
  );

  container.querySelectorAll("[data-deactivate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.deactivate);
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
