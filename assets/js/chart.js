/**
 * 작은 차트 모음.
 *
 * 외부 차트 라이브러리를 쓰지 않고 필요한 만큼만 직접 그립니다.
 * 색은 style.css 에 정의한 --series-1..3 을 쓰며, 라이트·다크 모두에서
 * 색약으로도 구분되는지 확인한 값입니다.
 *
 * 막대는 HTML 로 그립니다. SVG 를 가로로 늘리면 그 안의 글자까지 늘어나
 * 축 이름이 서로 겹치기 때문입니다.
 *
 * 모든 차트는 값을 그대로 읽을 수 있는 표를 함께 내놓습니다.
 * 색이나 마우스 올리기에만 기대지 않기 위함입니다.
 */
import { esc } from "./ui.js";

/** 계열 색. 순서를 바꾸면 안 됩니다(이 순서로 색약 판별을 확인했습니다). */
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

const number = (value) => new Intl.NumberFormat("ko-KR").format(Math.round(value * 10) / 10);

/** 값이 모두 0이면 눈금이 무너지므로 최소 1로 둡니다. */
const scaleMax = (values) => Math.max(1, ...values);

/**
 * 눈금 꼭대기로 쓸 만한 값을 고릅니다.
 * 너무 큰 값을 고르면 그래프가 납작해지므로 촘촘한 단계에서 찾습니다.
 */
function niceMax(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => value <= s * magnitude) ?? 10;
  return step * magnitude;
}

const emptyBox = (message) => `<p class="chart-empty">${esc(message)}</p>`;

/* =========================================================
   세로 막대 — 달마다처럼 순서가 있는 값에 씁니다.
   ========================================================= */
/**
 * @param {object} options
 * @param {Array<{ label: string, value: number }>} options.items
 * @param {string} [options.unit] 값 뒤에 붙일 단위
 */
export function columnChart({ items, unit = "", title = "" }) {
  if (!items.length) return emptyBox("표시할 자료가 없습니다.");

  const top = niceMax(scaleMax(items.map((i) => i.value)));

  // 가장 큰 값에만 숫자를 답니다. 모든 막대에 숫자를 달면 읽히지 않습니다.
  const peak = items.reduce((best, item, index) => (item.value > items[best].value ? index : best), 0);

  const columns = items
    .map(
      (item, index) => `
      <div class="col" title="${esc(`${item.label} ${number(item.value)}${unit}`)}">
        <span class="col__value">${
          index === peak && item.value > 0 ? `${number(item.value)}${esc(unit)}` : ""
        }</span>
        <span class="col__track">
          <span class="col__fill${item.value > 0 ? "" : " is-empty"}"
                style="height:${((item.value / top) * 100).toFixed(1)}%"></span>
        </span>
        <span class="col__label">${esc(item.label)}</span>
      </div>`
    )
    .join("");

  return `
    <div class="columns" role="img"
         aria-label="${esc(title || "막대 그래프")}: ${esc(
           items.map((i) => `${i.label} ${i.value}${unit}`).join(", ")
         )}">${columns}</div>`;
}

/* =========================================================
   가로 막대 — 반처럼 항목이 많고 이름이 긴 값에 씁니다.
   ========================================================= */
export function barList({ items, unit = "" }) {
  if (!items.length) return emptyBox("표시할 자료가 없습니다.");

  const top = scaleMax(items.map((i) => i.value));

  const rows = items
    .map(
      (item) => `
      <li class="bar-row">
        <span class="bar-row__label">${esc(item.label)}</span>
        <span class="bar-row__track">
          <span class="bar-row__fill" style="width:${((item.value / top) * 100).toFixed(1)}%"></span>
        </span>
        <span class="bar-row__value">${number(item.value)}${esc(unit)}</span>
      </li>`
    )
    .join("");

  return `<ul class="bar-list">${rows}</ul>`;
}

/* =========================================================
   비율 막대 — 전체에서 차지하는 몫을 한눈에 봅니다.
   ========================================================= */
export function shareBar({ items, unit = "건" }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return emptyBox("표시할 자료가 없습니다.");

  // 조각 사이는 테두리 대신 바탕색 틈으로 나눕니다.
  const segments = items
    .map((item, index) => ({ ...item, color: SERIES[index % SERIES.length] }))
    .filter((item) => item.value > 0)
    .map(
      (item) => `
      <span class="share-bar__part" title="${esc(`${item.label} ${number(item.value)}${unit}`)}"
            style="flex:${item.value};background:${item.color}"></span>`
    )
    .join("");

  const legend = items
    .map(
      (item, index) => `
      <li class="legend__item">
        <span class="legend__swatch" style="background:${SERIES[index % SERIES.length]}"></span>
        <span>${esc(item.label)}</span>
        <b>${number(item.value)}${esc(unit)}</b>
        <span class="caption">${Math.round((item.value / total) * 100)}%</span>
      </li>`
    )
    .join("");

  return `
    <div class="share-bar" role="img"
         aria-label="${esc(items.map((i) => `${i.label} ${i.value}${unit}`).join(", "))}">${segments}</div>
    <ul class="legend">${legend}</ul>`;
}

/* =========================================================
   표 — 그래프와 같은 값을 글자로도 읽을 수 있게 합니다.
   ========================================================= */
export function chartTable({ columns, rows, caption = "" }) {
  if (!rows.length) return "";

  return `
    <details class="chart-table">
      <summary>표로 보기</summary>
      <div class="table-wrap">
        <table class="table table--compact">
          ${caption ? `<caption class="caption">${esc(caption)}</caption>` : ""}
          <thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${row
                    .map((cell, index) => `<td${index ? ' class="num"' : ""}>${esc(cell)}</td>`)
                    .join("")}</tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </details>`;
}
