/** 통계 — 상담 현황을 그래프로 봅니다(선생님 전용). */
import { counselingService, inSchoolYear, schoolYearOf, studentService } from "../services.js";
import { FORM_CATEGORIES } from "../counseling-docs.js";
import { barList, chartTable, columnChart, shareBar } from "../chart.js";
import { emptyState, on } from "../ui.js";

export const meta = { id: "statistics", icon: "📊", title: "통계" };

// 화면을 다시 그려도 고른 학년도를 기억합니다.
const state = { year: null };

/** 3월부터 다음 해 2월까지가 한 학년도입니다. */
const SCHOOL_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

/* =========================================================
   집계
   ========================================================= */
function monthlyStats(rows) {
  return SCHOOL_MONTHS.map((month) => {
    const inMonth = rows.filter((r) => new Date(r.sessionDate).getMonth() + 1 === month);
    return {
      label: `${month}월`,
      count: inMonth.length,
      minutes: inMonth.reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0),
    };
  });
}

function categoryStats(rows) {
  return FORM_CATEGORIES.map((name) => ({
    label: name,
    value: rows.filter((r) => (FORM_CATEGORIES.includes(r.category) ? r.category : "기타") === name)
      .length,
  }));
}

/** 학년·반별로 학생 수와 상담 건수를 셉니다. */
function classStats(rows) {
  // 학년·반은 학생 행에 함께 붙어 옵니다(반 문서에서 펼쳐진 값).
  const seats = new Map(studentService.getAll().map((student) => [student.id, student]));
  const groups = new Map();

  const groupOf = (seat) => {
    const key = `${seat.grade}-${seat.classNo}`;
    if (!groups.has(key)) {
      groups.set(key, { grade: seat.grade, classNo: seat.classNo, students: 0, count: 0 });
    }
    return groups.get(key);
  };

  for (const student of seats.values()) {
    if (student.grade != null && student.classNo != null) groupOf(student).students += 1;
  }

  for (const row of rows) {
    const seat = seats.get(row.studentId);
    if (seat?.grade != null && seat?.classNo != null) groupOf(seat).count += 1;
  }

  return [...groups.values()].sort((a, b) => a.grade - b.grade || a.classNo - b.classNo);
}

/* =========================================================
   화면
   ========================================================= */
export function render(container) {
  const all = counselingService.getAll();

  const years = [
    ...new Set(all.map((s) => schoolYearOf(s.sessionDate)).filter((y) => y != null)),
  ].sort((a, b) => b - a);

  if (years.length === 0) years.push(schoolYearOf(new Date()));

  const year = state.year && years.includes(state.year) ? state.year : years[0];
  state.year = year;

  const rows = all.filter((s) => inSchoolYear(s, year));
  const monthly = monthlyStats(rows);
  const categories = categoryStats(rows);
  const classes = classStats(rows);

  const totalMinutes = rows.reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0);
  const withoutTime = rows.filter((r) => !r.durationMinutes).length;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">통계</h1>
        <p class="page-subtitle">${year}학년도 (${year}년 3월 ~ ${year + 1}년 2월)</p>
      </div>
      <div class="page-head__actions">
        <label class="field__label" for="stat-year">학년도</label>
        <select class="select" id="stat-year">
          ${years
            .map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}학년도</option>`)
            .join("")}
        </select>
      </div>
    </div>

    ${
      rows.length === 0
        ? `<section class="card">
             ${emptyState({
               icon: "📊",
               title: "이 학년도에는 상담 기록이 없습니다",
               desc: "상담일지에서 기록을 남기면 여기에 모입니다.",
             })}
           </section>`
        : `
    <section class="stat-grid">
      <div class="stat">
        <div>
          <span class="stat__label">상담 건수</span>
          <strong class="stat__value">${rows.length}<span class="stat__unit">건</span></strong>
        </div>
      </div>
      <div class="stat">
        <div>
          <span class="stat__label">상담 시간</span>
          <strong class="stat__value">${totalMinutes}<span class="stat__unit">분</span></strong>
          <span class="stat__sub">${
            withoutTime ? `시간이 비어 있는 기록 ${withoutTime}건 제외` : "모든 기록에 시간 있음"
          }</span>
        </div>
      </div>
      <div class="stat">
        <div>
          <span class="stat__label">상담한 학생</span>
          <strong class="stat__value">${
            new Set(rows.map((r) => r.studentId)).size
          }<span class="stat__unit">명</span></strong>
          <span class="stat__sub">전체 ${studentService.getAll().length}명 중</span>
        </div>
      </div>
    </section>

    <div class="chart-grid">
      <section class="card">
        <div class="card__head"><h2 class="section-title">월별 상담 건수</h2></div>
        ${columnChart({ items: monthly.map((m) => ({ label: m.label, value: m.count })), unit: "건", title: "월별 상담 건수" })}
        ${chartTable({
          columns: ["월", "건수"],
          rows: monthly.map((m) => [m.label, `${m.count}건`]),
        })}
      </section>

      <section class="card">
        <div class="card__head"><h2 class="section-title">월별 상담 시간</h2></div>
        ${columnChart({ items: monthly.map((m) => ({ label: m.label, value: m.minutes })), unit: "분", title: "월별 상담 시간" })}
        ${chartTable({
          columns: ["월", "시간"],
          rows: monthly.map((m) => [m.label, `${m.minutes}분`]),
        })}
      </section>
    </div>

    <section class="card" style="margin-top:16px">
      <div class="card__head"><h2 class="section-title">상담 구분</h2></div>
      ${shareBar({ items: categories })}
      ${chartTable({
        columns: ["구분", "건수"],
        rows: categories.map((c) => [c.label, `${c.value}건`]),
      })}
    </section>

    <section class="card" style="margin-top:16px">
      <div class="card__head">
        <h2 class="section-title">학년·반별 상담 현황</h2>
        <span class="caption">학생 수 대비 상담 건수</span>
      </div>
      ${
        classes.length
          ? barList({
              items: classes.map((c) => ({
                label: `${c.grade}-${c.classNo}`,
                value: c.count,
              })),
              unit: "건",
            })
          : `<p class="chart-empty">학년·반이 등록된 학생이 없습니다.</p>`
      }
      ${chartTable({
        columns: ["학년·반", "학생 수", "상담 건수", "학생당"],
        rows: classes.map((c) => [
          `${c.grade}학년 ${c.classNo}반`,
          `${c.students}명`,
          `${c.count}건`,
          c.students ? (c.count / c.students).toFixed(1) : "0",
        ]),
      })}
    </section>`
    }`;

  on(
    container,
    "#stat-year",
    (select) => {
      state.year = Number.parseInt(select.value, 10);
      render(container);
    },
    "change"
  );
}
