/**
 * 진로상담총괄표(별지) 만들기.
 *
 * 학교에서 쓰는 결재 서식을 그대로 옮긴 것으로,
 * 칸 너비·높이·글자 크기·배경색은 원본 한글 파일에서 읽은 값을 씁니다.
 */
import { ALIGN, PAGE_B4, buildHwpx, font, paragraph, table } from "./hwpx.js";
import { topicsToCategory } from "./counseling-journal.js";

/** 원본 서식의 열 너비 (HWPUNIT) */
const COLUMNS = [2434, 10968, 4561, 3585, 5317, 2451, 2451, 2418, 21223];

/** 원본 서식의 줄 높이 */
const ROW = { headTop: 2001, headBottom: 2552, data: 1282, total: 1903 };

/** 머리글 배경색 — 원본과 같은 연한 파랑입니다. */
const HEAD_FILL = "#DFE6F7";

/** 번호가 매겨진 줄 수와, 그 뒤에 두는 여분의 빈 줄 수. */
const NUMBERED_ROWS = 32;
const SPARE_ROWS = 9;

/**
 * 수업 시수 기준. 이 서식은 50분을 한 시간(차시)으로 셉니다.
 * (원본 서식의 예시값 "3350분 = 67시간" 이 3350 ÷ 50 = 67 로 맞습니다.)
 */
const MINUTES_PER_HOUR = 50;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 서식의 상담 구분 3종. */
export const FORM_CATEGORIES = ["진로", "진학", "기타"];

/** 원본 서식에서 쓰는 글자 모양. */
const F = {
  title: font(22, { bold: true }), // 진로상담총괄표
  titleSub: font(18, { bold: true }), // 년 학기
  titleHours: font(16, { bold: true }), // 총시간 : 시간
  school: font(13), // 학교명 · 부서명
  head: font(10, { bold: true }), // 표 머리글
  body: font(10), // 표 본문
  summary: font(12, { bold: true }), // 하단 누계표
  summaryRed: font(12, { bold: true, color: "#FF0000" }),
  note: font(10), // ※ 안내 문구
};

/* =========================================================
   값 다듬기
   ========================================================= */
/** 5자리 학번을 만듭니다. 1학년 3반 5번 → 10305 */
export function formatStudentId({ grade, classNo, studentNo }) {
  if (grade == null || classNo == null || studentNo == null) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${grade}${pad(classNo)}${pad(studentNo)}`;
}

/** 상담일자 — "7월 28일(화)" */
function formatSessionDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}월 ${date.getDate()}일(${WEEKDAYS[date.getDay()]})`;
}

const toHours = (minutes) => minutes / MINUTES_PER_HOUR;

/** 소수점이 필요할 때만 붙입니다. */
function trimNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** 표에 넣을 상담 내용 — 줄바꿈을 없애 한 줄로 만듭니다. */
function summarize(session) {
  return [session.content, session.intervention]
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" / ");
}

/* =========================================================
   표 만들기
   ========================================================= */
const head = (text, options = {}) => ({
  text,
  align: ALIGN.center,
  char: F.head,
  header: true,
  ...options,
});

/** 머리글 두 줄. 아래쪽 테두리는 원본처럼 두 줄로 그립니다. */
function headerRows() {
  return [
    {
      height: ROW.headTop,
      fill: HEAD_FILL,
      cells: [
        head("연번", { rowSpan: 2 }),
        head("상담일자", { rowSpan: 2 }),
        head("상담시간\n(분)", { rowSpan: 2 }),
        head("학번", { rowSpan: 2 }),
        head("성 명", { rowSpan: 2 }),
        head("상담 구분", { colSpan: 3 }),
        head("상  담  내  용"),
      ],
    },
    {
      height: ROW.headBottom,
      fill: HEAD_FILL,
      doubleBottom: true,
      cells: [...FORM_CATEGORIES.map((name) => head(name)), head("진로, 진학, 기타 상담내용 간략히 기록")],
    },
  ];
}

/** 번호가 붙은 상담 줄. entry 가 없으면 번호만 있는 빈 줄입니다. */
function dataRow(index, entry) {
  const cell = (text, align = ALIGN.center) => ({ text, align, char: F.body });

  if (!entry) {
    return {
      height: ROW.data,
      cells: [cell(String(index + 1)), ...Array.from({ length: 8 }, () => cell(""))],
    };
  }

  return {
    height: ROW.data,
    cells: [
      cell(String(index + 1)),
      cell(entry.date),
      cell(entry.minutes ? String(entry.minutes) : ""),
      cell(entry.studentId),
      cell(entry.name),
      ...FORM_CATEGORIES.map((name) => cell(entry.category === name ? "○" : "")),
      cell(entry.summary, ALIGN.left),
    ],
  };
}

/** 번호 없이 비워 두는 여분의 줄. */
function spareRow() {
  return {
    height: ROW.data,
    cells: Array.from({ length: 9 }, () => ({ text: "", align: ALIGN.center, char: F.body })),
  };
}

/**
 * 마지막 '계' 줄.
 * 원본처럼 상담시간만 합계를 넣고, 나머지 칸은 사선으로 지웁니다.
 */
function totalRow(entries) {
  const minutes = entries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0);

  return {
    height: ROW.total,
    cells: [
      { text: "계", align: ALIGN.center, char: F.body, colSpan: 2 },
      { text: minutes ? String(minutes) : "", align: ALIGN.center, char: F.body },
      ...Array.from({ length: 6 }, () => ({ text: "", slash: true })),
    ],
  };
}

/* =========================================================
   문서 만들기
   ========================================================= */
/**
 * 진로상담총괄표를 만듭니다.
 *
 * @param {object} options
 * @param {string} options.school     학교명
 * @param {string} options.department 부서명
 * @param {number} options.year       학년도
 * @param {number} options.term       학기
 * @param {number} options.weeks      학기 적용 주 수 (B)
 * @param {number} options.classHours 주당 수업시수 (D)
 * @param {Array}  options.entries    상담 목록
 * @returns {Promise<Blob>}
 */
export function buildCounselingSummary({
  school,
  department,
  year,
  term,
  weeks,
  classHours,
  entries,
}) {
  const totalMinutes = entries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0);
  const totalHours = toHours(totalMinutes);
  const average = weeks > 0 ? totalHours / weeks : 0;

  const numbered = Math.max(entries.length, NUMBERED_ROWS);
  const rows = [
    ...headerRows(),
    ...Array.from({ length: numbered }, (_, index) => dataRow(index, entries[index])),
    ...Array.from({ length: SPARE_ROWS }, spareRow),
    totalRow(entries),
  ];

  const titleTable = table({
    widths: [16737, 38152],
    rows: [
      {
        height: 5167,
        cells: [
          { text: `${school}\n${department}`, align: ALIGN.center, char: F.school },
          {
            // 첫 줄은 한 줄 안에서 글자 크기가 바뀝니다.
            text: [
              [
                { text: "진로상담총괄표", char: F.title },
                { text: `  ${year}년 ${term} 학기`, char: F.titleSub },
              ],
              [{ text: `총시간 : ${trimNumber(totalHours)}시간`, char: F.titleHours }],
            ],
            align: ALIGN.center,
          },
        ],
      },
    ],
  });

  const summaryCell = (text, char = F.summary) => ({ text, align: ALIGN.left, char });

  const summaryTable = table({
    widths: [28623, 19284],
    rows: [
      {
        height: 1798,
        cells: [
          summaryCell(`${year}년 ( ${term} )학기 누계 진로상담시간 = (A)`),
          summaryCell(`${totalMinutes}분 = ${trimNumber(totalHours)}시간`),
        ],
      },
      {
        height: 1798,
        cells: [
          summaryCell("주당 진로상담 평균시수(A/B) = (C)"),
          summaryCell(
            weeks > 0 ? `${trimNumber(totalHours)}시간÷${weeks}주 = ${trimNumber(average)}시간` : ""
          ),
        ],
      },
      {
        height: 1798,
        cells: [
          summaryCell("주당시수 = (C) + 주당 수업시수(D)"),
          summaryCell(
            weeks > 0
              ? `${trimNumber(classHours)}시간+${trimNumber(average)}시간 = ${trimNumber(
                  classHours + average
                )}시간`
              : "",
            F.summaryRed
          ),
        ],
      },
    ],
    lines: { outer: 0.12, inner: 0.12 },
  });

  const notes = [
    " ※ B: 학교별 학기 적용 주 수",
    "   - 학교별 학기 주 수의 기준은 학교 교육과정 운영계획에 의함",
    " ※ D: 주당 수업시수",
    "   - 진로전담교사가 담당하고 있는 ‘진로와 직업’등 교과수업 시수 + 창의적 체험활동 중 ‘진로활동’담당 시수",
    " ※ 집단상담은 기타항목으로 분류하고 상담시간에 합산 가능하며 실제 운영한 시간으로 계산함",
  ];

  return buildHwpx({
    title: `진로상담총괄표 ${year}년 ${term}학기`,
    page: PAGE_B4,
    blocks: [
      paragraph("［별지］ 진로상담총괄표 결재 양식", { align: ALIGN.left }),
      titleTable,
      paragraph(""),
      table({ widths: COLUMNS, rows }),
      paragraph(""),
      summaryTable,
      ...notes.map((note) => paragraph(note, { align: ALIGN.left, char: F.note })),
    ],
  });
}

/**
 * 상담 기록을 서식에 넣을 형태로 바꿉니다.
 *
 * @param {Array} sessions  상담 기록 (학생 정보 포함)
 * @returns {Array}
 */
export function toFormEntries(sessions) {
  return sessions.map((session) => ({
    date: formatSessionDate(session.sessionDate),
    minutes: session.durationMinutes ?? null,
    studentId: formatStudentId(session.student ?? {}),
    name: session.student?.name ?? "",
    // 선택교과·학업은 이 서식에 칸이 없어 기타로 셉니다.
    category: topicsToCategory(session.topics ?? [session.category]),
    summary: summarize(session),
  }));
}
