/**
 * 탭마다 같은 모양으로 쓰는 검색 막대.
 *
 * 학생 관리 탭에서 쓰던 것을 상담일지·포트폴리오·휴지통에서도 그대로 씁니다.
 * 화면은 검색 조건을 담을 객체 하나만 들고 있으면 됩니다. 화면을 다시 그려도
 * 그 객체는 남아 있어 검색 조건이 유지됩니다.
 *
 *   const filter = createFilter(FIELDS);          // { name: "", grade: "", ... }
 *   container.innerHTML = searchBar({ id: "s", filter, fields: FIELDS });
 *   bindSearchBar(container, { id: "s", filter, fields: FIELDS, onChange: rerender });
 *
 * 값은 모두 문자열로 들고 있다가 쓸 때 numberOrNull 로 바꿉니다.
 * 빈 칸은 '조건 없음' 이라 숫자로 미리 바꿔 두면 구분할 수 없습니다.
 */
import { esc, on } from "../ui.js";

/**
 * 검색 칸 하나의 생김새.
 *
 * @typedef {object} SearchField
 * @property {string} name        조건 객체와 input 의 이름
 * @property {string} label       칸 위에 붙는 이름
 * @property {string} [placeholder]
 * @property {boolean} [numeric]  숫자만 넣는 좁은 칸(학년·반)
 * @property {boolean} [wide]     이름·검색어처럼 넓게 쓰는 칸
 * @property {Array<[string, string]>} [options] 고르는 칸이면 [값, 보이는 글] 목록
 */

/** 자주 쓰는 칸. 화면에서 골라 쓰고 필요하면 덧붙여 고칩니다. */
export const FIELDS = {
  name: { name: "name", label: "이름", placeholder: "이름으로 검색", wide: true },
  grade: { name: "grade", label: "학년", numeric: true },
  classNo: { name: "classNo", label: "반", numeric: true },
  keyword: { name: "keyword", label: "검색어", placeholder: "제목·내용으로 검색", wide: true },
};

/** 학생을 고를 때 쓰는 기본 세 칸. */
export const STUDENT_FIELDS = [FIELDS.name, FIELDS.grade, FIELDS.classNo];

/** 검색 조건을 담을 빈 객체를 만듭니다. */
export function createFilter(fields) {
  return Object.fromEntries(fields.map((field) => [field.name, ""]));
}

/** 하나라도 적혀 있는지. */
export const hasFilter = (filter) => Object.values(filter).some((value) => value !== "");

/** 검색 칸에 적은 숫자. 비어 있거나 숫자가 아니면 조건에서 뺍니다. */
export function numberOrNull(text) {
  const parsed = Number.parseInt(text, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 검색어가 들어 있는지. 검색어가 비어 있으면 모두 통과합니다. */
export function matches(keyword, ...parts) {
  const needle = String(keyword ?? "").trim().toLowerCase();
  if (!needle) return true;
  return parts.filter(Boolean).join(" ").toLowerCase().includes(needle);
}

function fieldHtml(id, field, value) {
  const inputId = `${id}-${field.name}`;
  const size = field.options
    ? "field--pick"
    : field.wide
      ? "field--name"
      : field.numeric
        ? "field--num"
        : "";

  const control = field.options
    ? `<select class="select" id="${inputId}" name="${esc(field.name)}">
         ${field.options
           .map(
             ([optionValue, label]) =>
               `<option value="${esc(optionValue)}" ${optionValue === value ? "selected" : ""}>
                  ${esc(label)}
                </option>`
           )
           .join("")}
       </select>`
    : `<input class="input" id="${inputId}" name="${esc(field.name)}"
              ${field.numeric ? `inputmode="numeric"` : ""}
              value="${esc(value)}"
              placeholder="${esc(field.placeholder ?? "")}" />`;

  return `
    <div class="field ${size}">
      <label class="field__label" for="${inputId}">${esc(field.label)}</label>
      ${control}
    </div>`;
}

/**
 * 검색 막대 HTML.
 *
 * @param {object} options
 * @param {string} options.id      한 화면에 여러 개 두어도 겹치지 않게 하는 앞머리
 * @param {object} options.filter  화면이 들고 있는 검색 조건
 * @param {SearchField[]} options.fields
 */
export function searchBar({ id, filter, fields }) {
  return `
    <form class="filter-bar" data-search="${esc(id)}">
      ${fields.map((field) => fieldHtml(id, field, filter[field.name] ?? "")).join("")}
      <button class="btn btn--secondary" type="submit">검색</button>
      ${
        hasFilter(filter)
          ? `<button class="btn btn--ghost" type="button" data-search-reset="${esc(id)}">초기화</button>`
          : ""
      }
    </form>`;
}

/**
 * 검색 막대에 동작을 붙입니다.
 * 고르는 칸은 바꾸는 즉시, 적는 칸은 ‘검색’ 을 눌렀을 때 반영합니다.
 *
 * @param {ParentNode} container
 * @param {{ id: string, filter: object, fields: SearchField[], onChange: () => void }} options
 */
export function bindSearchBar(container, { id, filter, fields, onChange }) {
  const form = container.querySelector(`[data-search="${id}"]`);
  if (!form) return;

  const read = () => {
    for (const field of fields) {
      filter[field.name] = (form.elements[field.name]?.value ?? "").trim();
    }
    onChange();
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    read();
  });

  on(form, "select", read, "change");

  on(container, `[data-search-reset="${id}"]`, () => {
    for (const field of fields) filter[field.name] = "";
    onChange();
  });
}
