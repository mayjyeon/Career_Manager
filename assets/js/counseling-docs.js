/**
 * 진로상담 서식 만들기 — 진로상담일지와 진로상담총괄표.
 *
 * 학교에서 쓰는 한글 서식을 그대로 옮긴 것으로, 용지·칸 너비·줄 높이·글자 크기·
 * 배경색은 모두 원본 한글 파일에서 읽은 값을 씁니다.
 *
 * 두 서식은 상담 주제 구분(진로·진학·기타)과 날짜 표기를 함께 쓰기 때문에
 * 한 파일에 두고 위쪽에 공통 값을 모아 두었습니다.
 *
 *   진로상담일지    상담 한 건이 한 쪽. 학생과 나눈 이야기를 자세히 적는 서식.
 *   진로상담총괄표  한 학기 상담을 한 표로 모아 결재에 올리는 별지 서식.
 */
import { ALIGN, PAGE_B4, buildHwpx, font, paragraph, table } from "./hwpx.js";

/* =========================================================
   두 서식이 함께 쓰는 값
   ========================================================= */
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 진로상담일지의 상담 주제 5종. 여러 개를 함께 고를 수 있습니다. */
export const JOURNAL_TOPICS = ["진로", "진학", "선택교과", "학업", "기타"];

/** 진로상담일지의 상담 시간대. 상담 한 건은 이 중 하나입니다. */
export const MEETING_TYPES = [
  { value: "class", label: "수업 중(교시)" },
  { value: "lunch", label: "점심시간" },
  { value: "after", label: "하교 후" },
];

/** 진로상담총괄표의 상담 구분 3종. */
export const FORM_CATEGORIES = ["진로", "진학", "기타"];

/**
 * 진로상담총괄표는 진로·진학·기타 3종만 씁니다.
 * 선택교과와 학업은 총괄표에서 기타로 셉니다.
 *
 * @param {string[]} topics
 * @returns {"진로"|"진학"|"기타"}
 */
export function topicsToCategory(topics) {
  const chosen = topics ?? [];
  if (chosen.includes("진로")) return "진로";
  if (chosen.includes("진학")) return "진학";
  return "기타";
}

/** 5자리 학번을 만듭니다. 1학년 3반 5번 → 10305 */
function formatStudentId({ grade, classNo, studentNo }) {
  if (grade == null || classNo == null || studentNo == null) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${grade}${pad(classNo)}${pad(studentNo)}`;
}

/** 날짜에서 월·일·요일을 뽑습니다. 읽을 수 없는 날짜는 빈칸입니다. */
function dateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { month: "", day: "", weekday: "" };

  return {
    month: date.getMonth() + 1,
    day: date.getDate(),
    weekday: WEEKDAYS[date.getDay()],
  };
}

/* =========================================================
   진로상담일지

   원본 서식
     (      )학년도 대전반석고 (   )학기 진로상담일지      ← 가운데, 18pt 진하게
     진로진학부장 홍지연(내선 7895)                        ← 오른쪽, 12pt
     ┌───────────────┬──────────────────────────────────┐
     │ 내담자 정보   │ (  )학년 (  )반 (  )번  이름 (  ) │
     │ 상담일시      │ (  )월 (  )일 (  )요일 (  )교시 … │
     │               │ (  )월 (  )일 (  )요일 ( 점심시간 / 하교 후 ) │
     │ 상담 주제     │ 진로 (  ) 진학 (  ) 선택교과 (  ) 학업 (  )   │
     │ (해당 사항 √) │ 기타(사유:                      ) │
     │ 내담자가 진술한 문제와 상황 │                      │
     │ 상담자 소견 및 개입        │                      │
     └───────────────┴──────────────────────────────────┘
   ========================================================= */
/** 원본 서식의 용지 — A4 세로, 좌우 여백 5669, 위아래 2834. */
const JOURNAL_PAGE = {
  width: 59528,
  height: 84186,
  margin: { left: 5669, right: 5669, top: 2834, bottom: 2834, header: 4252, footer: 4252 },
};

/** 원본 서식의 열 너비 (HWPUNIT) — 라벨 칸과 내용 칸. */
const JOURNAL_COLUMNS = [10339, 37558];

/** 원본 서식의 줄 높이. */
const JOURNAL_ROW = {
  info: 4604,
  when: 4418,
  topic: 6598,
  statement: 24859,
  intervention: 18124,
};

/** 원본 서식에서 쓰는 글자 모양. */
const JOURNAL_FONTS = {
  title: font(18, { bold: true }), // 진로상담일지 제목 줄
  staff: font(12), // 진로진학부장 …
  label: font(13, { bold: true }), // 표 왼쪽 라벨
  body: font(12), // 표 오른쪽 내용
  bodyMark: font(12, { bold: true }), // 고른 항목 표시
};

/**
 * 해당 사항 표시. 원본은 윙딩스 체크(✔)를 쓰지만 그 글꼴이 없는 곳에서는
 * 네모로 깨져서, 어느 한글 글꼴에나 있는 √ 를 씁니다.
 */
const MARK = "√";

/**
 * 빈칸 채우기.
 *
 * 원본의 괄호 안 빈칸은 너비가 정해져 있습니다. 값이 있으면 그 너비 안에
 * 가운데로 넣고, 없으면 원본처럼 빈칸 그대로 둡니다.
 */
function slot(width, value, align = "center") {
  const text = String(value ?? "").trim();
  if (!text) return " ".repeat(width);
  // 넣을 값이 빈칸보다 길면 칸을 늘립니다. 줄이 밀리는 것보다 낫습니다.
  if (text.length >= width) return ` ${text} `;

  const left = align === "left" ? 1 : Math.floor((width - text.length) / 2);
  return " ".repeat(left) + text + " ".repeat(width - text.length - left);
}

/** 상담 주제 한 칸 — 고른 항목에만 √ 를 넣습니다. */
const topicSlot = (topics, name) => slot(4, (topics ?? []).includes(name) ? MARK : "");

const label = (text) => ({ text, align: ALIGN.center, char: JOURNAL_FONTS.label });

const content = (text, options = {}) => ({
  text,
  align: ALIGN.justify,
  char: JOURNAL_FONTS.body,
  ...options,
});

/**
 * 수업 중 상담 줄. 점심시간·하교 후 상담이면 원본처럼 빈칸으로 둡니다.
 *
 * 시간대를 적기 전에 남긴 기록은 시간대를 모르지만 날짜는 있으므로,
 * 날짜만이라도 이 줄에 넣고 교시·교과명은 비워 둡니다.
 */
function classTimeRow(record) {
  const inClass = record.meetingType !== "lunch" && record.meetingType !== "after";
  const { month, day, weekday } = inClass ? dateParts(record.sessionDate) : {};

  return (
    `  (${slot(3, month)})월  (${slot(3, day)})일  (${slot(3, weekday)})요일` +
    ` (${slot(3, inClass ? record.period : "")})교시` +
    `  교과명: (${slot(13, inClass ? record.subject : "")})`
  );
}

/**
 * 점심시간·하교 후 상담 줄.
 * 원본의 "( 점심시간 / 하교 후 )" 는 그대로 두고 고른 쪽만 진하게 표시합니다.
 */
function breakTimeRow(record) {
  const isLunch = record.meetingType === "lunch";
  const isAfter = record.meetingType === "after";
  const { month, day, weekday } = isLunch || isAfter ? dateParts(record.sessionDate) : {};
  const { body, bodyMark } = JOURNAL_FONTS;

  return [
    {
      text: `  (${slot(3, month)})월  (${slot(3, day)})일  (${slot(3, weekday)})요일  ( `,
      char: body,
    },
    { text: "점심시간", char: isLunch ? bodyMark : body },
    { text: "  /  ", char: body },
    { text: "하교 후", char: isAfter ? bodyMark : body },
    { text: " )", char: body },
  ];
}

/** 상담 한 건을 표 하나로 만듭니다. */
function recordTable(record) {
  const student = record.student ?? {};

  return table({
    widths: JOURNAL_COLUMNS,
    rows: [
      {
        height: JOURNAL_ROW.info,
        cells: [
          label("내담자 정보"),
          content(
            `(${slot(4, student.grade)})학년 (${slot(4, student.classNo)})반` +
              ` (${slot(4, student.studentNo)})번  이름 (${slot(11, student.name)})`
          ),
        ],
      },
      {
        height: JOURNAL_ROW.when,
        cells: [{ ...label("상담일시"), rowSpan: 2 }, content(classTimeRow(record))],
      },
      { height: JOURNAL_ROW.when, cells: [content(breakTimeRow(record))] },
      {
        height: JOURNAL_ROW.topic,
        cells: [
          label(`상담 주제\n(해당 사항 ${MARK})`),
          content(
            `진로 (${topicSlot(record.topics, "진로")})` +
              `  진학 (${topicSlot(record.topics, "진학")})` +
              `  선택교과 (${topicSlot(record.topics, "선택교과")})` +
              `  학업 (${topicSlot(record.topics, "학업")})  \n` +
              // 사유는 긴 글이라 가운데가 아니라 왼쪽부터 채웁니다.
              `기타(사유:${slot(46, record.topicOther, "left")})`
          ),
        ],
      },
      {
        height: JOURNAL_ROW.statement,
        cells: [
          label("내담자가 진술한 문제와 상황"),
          content(record.statement ?? "", { vertAlign: "TOP" }),
        ],
      },
      {
        height: JOURNAL_ROW.intervention,
        cells: [
          label("상담자 소견 및 개입"),
          content(record.intervention ?? "", { vertAlign: "TOP" }),
        ],
      },
    ],
  });
}

/**
 * 진로상담일지를 만듭니다. 상담 한 건이 한 쪽입니다.
 *
 * @param {object} options
 * @param {string} options.school     학교명 (제목 줄에 들어갑니다)
 * @param {number} options.year       학년도
 * @param {number} options.term       학기
 * @param {string} [options.staff]    담당자 — "진로진학부장 홍지연"
 * @param {string} [options.extension] 내선번호
 * @param {Array}  options.records    상담 목록 (toJournalRecords 로 만든 것)
 * @returns {Promise<Blob>}
 */
export function buildCounselingJournal({ school, year, term, staff, extension, records }) {
  const staffLine = [staff, extension ? `(내선 ${extension})` : ""].filter(Boolean).join("");

  const blocks = records.flatMap((record, index) => [
    // 두 번째 상담부터는 새 쪽에서 시작합니다.
    paragraph(`(${slot(6, year)})학년도 ${school} (${slot(3, term)})학기 진로상담일지 `, {
      align: ALIGN.center,
      char: JOURNAL_FONTS.title,
      pageBreak: index > 0,
    }),
    paragraph(staffLine, { align: ALIGN.right, char: JOURNAL_FONTS.staff }),
    paragraph(""),
    recordTable(record),
  ]);

  return buildHwpx({
    title: `진로상담일지 ${year}학년도 ${term}학기`,
    page: JOURNAL_PAGE,
    blocks,
  });
}

/**
 * 상담 기록을 진로상담일지에 넣을 형태로 바꿉니다.
 *
 * @param {Array} sessions 상담 기록 (student 정보 포함)
 * @returns {Array}
 */
export function toJournalRecords(sessions) {
  return sessions.map((session) => ({
    sessionDate: session.sessionDate,
    meetingType: session.meetingType ?? null,
    period: session.period ?? null,
    subject: session.subject ?? null,
    topics: session.topics ?? [],
    topicOther: session.topicOther ?? null,
    statement: session.content ?? "",
    intervention: session.intervention ?? "",
    student: session.student ?? null,
  }));
}

/* =========================================================
   진로상담총괄표(별지)

   학교에서 쓰는 결재 서식을 그대로 옮긴 것입니다.
   ========================================================= */
/** 원본 서식의 열 너비 (HWPUNIT) */
const FORM_COLUMNS = [2434, 10968, 4561, 3585, 5317, 2451, 2451, 2418, 21223];

/** 표 한 줄의 칸 수. */
const FORM_CELLS = FORM_COLUMNS.length;

/** 원본 서식의 줄 높이 */
const FORM_ROW = { headTop: 2001, headBottom: 2552, data: 1282, total: 1903 };

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

/** 원본 서식에서 쓰는 글자 모양. */
const FORM_FONTS = {
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

/** 상담일자 — "7월 28일(화)" */
function formatSessionDate(value) {
  const { month, day, weekday } = dateParts(value);
  return month === "" ? "" : `${month}월 ${day}일(${weekday})`;
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

const totalMinutesOf = (entries) => entries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0);

const head = (text, options = {}) => ({
  text,
  align: ALIGN.center,
  char: FORM_FONTS.head,
  header: true,
  ...options,
});

const bodyCell = (text, align = ALIGN.center) => ({ text, align, char: FORM_FONTS.body });

/** 머리글 두 줄. 아래쪽 테두리는 원본처럼 두 줄로 그립니다. */
function headerRows() {
  return [
    {
      height: FORM_ROW.headTop,
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
      height: FORM_ROW.headBottom,
      fill: HEAD_FILL,
      doubleBottom: true,
      cells: [
        ...FORM_CATEGORIES.map((name) => head(name)),
        head("진로, 진학, 기타 상담내용 간략히 기록"),
      ],
    },
  ];
}

/** 번호가 붙은 상담 줄. entry 가 없으면 번호만 있는 빈 줄입니다. */
function dataRow(index, entry) {
  const number = bodyCell(String(index + 1));

  if (!entry) {
    return {
      height: FORM_ROW.data,
      cells: [number, ...Array.from({ length: FORM_CELLS - 1 }, () => bodyCell(""))],
    };
  }

  return {
    height: FORM_ROW.data,
    cells: [
      number,
      bodyCell(entry.date),
      bodyCell(entry.minutes ? String(entry.minutes) : ""),
      bodyCell(entry.studentId),
      bodyCell(entry.name),
      ...FORM_CATEGORIES.map((name) => bodyCell(entry.category === name ? "○" : "")),
      bodyCell(entry.summary, ALIGN.left),
    ],
  };
}

/** 번호 없이 비워 두는 여분의 줄. */
function spareRow() {
  return {
    height: FORM_ROW.data,
    cells: Array.from({ length: FORM_CELLS }, () => bodyCell("")),
  };
}

/**
 * 마지막 '계' 줄.
 * 원본처럼 상담시간만 합계를 넣고, 나머지 칸은 사선으로 지웁니다.
 */
function totalRow(entries) {
  const minutes = totalMinutesOf(entries);

  return {
    height: FORM_ROW.total,
    cells: [
      { ...bodyCell("계"), colSpan: 2 },
      bodyCell(minutes ? String(minutes) : ""),
      ...Array.from({ length: FORM_CELLS - 3 }, () => ({ text: "", slash: true })),
    ],
  };
}

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
 * @param {Array}  options.entries    상담 목록 (toFormEntries 로 만든 것)
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
  const totalMinutes = totalMinutesOf(entries);
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
          { text: `${school}\n${department}`, align: ALIGN.center, char: FORM_FONTS.school },
          {
            // 첫 줄은 한 줄 안에서 글자 크기가 바뀝니다.
            text: [
              [
                { text: "진로상담총괄표", char: FORM_FONTS.title },
                { text: `  ${year}년 ${term} 학기`, char: FORM_FONTS.titleSub },
              ],
              [{ text: `총시간 : ${trimNumber(totalHours)}시간`, char: FORM_FONTS.titleHours }],
            ],
            align: ALIGN.center,
          },
        ],
      },
    ],
  });

  const summaryCell = (text, char = FORM_FONTS.summary) => ({ text, align: ALIGN.left, char });

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
            FORM_FONTS.summaryRed
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
      table({ widths: FORM_COLUMNS, rows }),
      paragraph(""),
      summaryTable,
      ...notes.map((note) => paragraph(note, { align: ALIGN.left, char: FORM_FONTS.note })),
    ],
  });
}

/**
 * 상담 기록을 진로상담총괄표에 넣을 형태로 바꿉니다.
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
