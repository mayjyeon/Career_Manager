/**
 * 진로상담일지 만들기.
 *
 * 학교에서 쓰는 서식을 그대로 옮긴 것으로, 용지·칸 너비·줄 높이·글자 크기·정렬은
 * 모두 원본 한글 파일에서 읽은 값을 씁니다. 상담 한 건이 한 쪽입니다.
 *
 * 원본 서식
 *   (      )학년도 대전반석고 (   )학기 진로상담일지      ← 가운데, 18pt 진하게
 *   진로진학부장 홍지연(내선 7895)                        ← 오른쪽, 12pt
 *   ┌───────────────┬──────────────────────────────────┐
 *   │ 내담자 정보   │ (  )학년 (  )반 (  )번  이름 (  ) │
 *   │ 상담일시      │ (  )월 (  )일 (  )요일 (  )교시 … │
 *   │               │ (  )월 (  )일 (  )요일 ( 점심시간 / 하교 후 ) │
 *   │ 상담 주제     │ 진로 (  ) 진학 (  ) 선택교과 (  ) 학업 (  )   │
 *   │ (해당 사항 √) │ 기타(사유:                      ) │
 *   │ 내담자가 진술한 문제와 상황 │                      │
 *   │ 상담자 소견 및 개입        │                      │
 *   └───────────────┴──────────────────────────────────┘
 */
import { ALIGN, buildHwpx, font, paragraph, table } from "./hwpx.js";

/** 원본 서식의 용지 — A4 세로, 좌우 여백 5669, 위아래 2834. */
const PAGE = {
  width: 59528,
  height: 84186,
  margin: { left: 5669, right: 5669, top: 2834, bottom: 2834, header: 4252, footer: 4252 },
};

/** 원본 서식의 열 너비 (HWPUNIT) — 라벨 칸과 내용 칸. */
const COLUMNS = [10339, 37558];

/** 원본 서식의 줄 높이. */
const ROW = {
  info: 4604,
  when: 4418,
  topic: 6598,
  statement: 24859,
  intervention: 18124,
};

/** 원본 서식에서 쓰는 글자 모양. */
const F = {
  title: font(18, { bold: true }), // 진로상담일지 제목 줄
  staff: font(12), // 진로진학부장 …
  label: font(13, { bold: true }), // 표 왼쪽 라벨
  body: font(12), // 표 오른쪽 내용
  bodyMark: font(12, { bold: true }), // 고른 항목 표시
};

/** 서식의 상담 주제 5종. 여러 개를 함께 고를 수 있습니다. */
export const JOURNAL_TOPICS = ["진로", "진학", "선택교과", "학업", "기타"];

/** 서식의 상담 시간대. 상담 한 건은 이 중 하나입니다. */
export const MEETING_TYPES = [
  { value: "class", label: "수업 중(교시)" },
  { value: "lunch", label: "점심시간" },
  { value: "after", label: "하교 후" },
];

/**
 * 해당 사항 표시. 원본은 윙딩스 체크(✔)를 쓰지만 그 글꼴이 없는 곳에서는
 * 네모로 깨져서, 어느 한글 글꼴에나 있는 √ 를 씁니다.
 */
const MARK = "√";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 진로상담총괄표는 진로·진학·기타 3종만 씁니다.
 * 선택교과와 학업은 총괄표에서 기타로 셉니다.
 *
 * @param {string[]} topics
 * @returns {string} "진로" | "진학" | "기타"
 */
export function topicsToCategory(topics) {
  const chosen = topics ?? [];
  if (chosen.includes("진로")) return "진로";
  if (chosen.includes("진학")) return "진학";
  return "기타";
}

/* =========================================================
   빈칸 채우기

   원본의 괄호 안 빈칸은 너비가 정해져 있습니다. 값이 있으면 그 너비 안에
   가운데로 넣고, 없으면 원본처럼 빈칸 그대로 둡니다.
   ========================================================= */
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
   표 만들기
   ========================================================= */
const label = (text) => ({ text, align: ALIGN.center, char: F.label });

const content = (text, options = {}) => ({
  text,
  align: ALIGN.justify,
  char: F.body,
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

  return [
    {
      text: `  (${slot(3, month)})월  (${slot(3, day)})일  (${slot(3, weekday)})요일  ( `,
      char: F.body,
    },
    { text: "점심시간", char: isLunch ? F.bodyMark : F.body },
    { text: "  /  ", char: F.body },
    { text: "하교 후", char: isAfter ? F.bodyMark : F.body },
    { text: " )", char: F.body },
  ];
}

/** 상담 한 건을 표 하나로 만듭니다. */
function recordTable(record) {
  const student = record.student ?? {};

  return table({
    widths: COLUMNS,
    rows: [
      {
        height: ROW.info,
        cells: [
          label("내담자 정보"),
          content(
            `(${slot(4, student.grade)})학년 (${slot(4, student.classNo)})반` +
              ` (${slot(4, student.studentNo)})번  이름 (${slot(11, student.name)})`
          ),
        ],
      },
      {
        height: ROW.when,
        cells: [{ ...label("상담일시"), rowSpan: 2 }, content(classTimeRow(record))],
      },
      { height: ROW.when, cells: [content(breakTimeRow(record))] },
      {
        height: ROW.topic,
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
        height: ROW.statement,
        cells: [
          label("내담자가 진술한 문제와 상황"),
          content(record.statement ?? "", { vertAlign: "TOP" }),
        ],
      },
      {
        height: ROW.intervention,
        cells: [
          label("상담자 소견 및 개입"),
          content(record.intervention ?? "", { vertAlign: "TOP" }),
        ],
      },
    ],
  });
}

/* =========================================================
   문서 만들기
   ========================================================= */
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
    paragraph(
      `(${slot(6, year)})학년도 ${school} (${slot(3, term)})학기 진로상담일지 `,
      { align: ALIGN.center, char: F.title, pageBreak: index > 0 }
    ),
    paragraph(staffLine, { align: ALIGN.right, char: F.staff }),
    paragraph(""),
    recordTable(record),
  ]);

  return buildHwpx({
    title: `진로상담일지 ${year}학년도 ${term}학기`,
    page: PAGE,
    blocks,
  });
}

/**
 * 상담 기록을 서식에 넣을 형태로 바꿉니다.
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
