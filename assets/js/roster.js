/**
 * 학급 명렬표 해석.
 *
 * 학교에서 쓰는 명렬표는 보통 아래처럼 반이 가로로 늘어선 교차표입니다.
 *
 *            ┌──────┬───────────────────────┬──────┬───────────────────────┐
 *            │ 번호 │           남          │ 번호 │           여          │
 *            │      │ 1반 │ 2반 │ 3반 │ …   │      │ 6반 │ 7반 │ 8반 │ …   │
 *            ├──────┼─────┼─────┼─────┼─────┼──────┼─────┼─────┼─────┼─────┤
 *            │  1   │홍길동│…                │  1   │김영희│…                │
 *
 * 이름이 적힌 칸의 위치에서 반(위쪽 '○반' 제목)과 번호(왼쪽 '번호' 열)를 읽습니다.
 * 학년도와 학년은 맨 위 제목("2026학년도 1학년 학급명렬표")에서 가져옵니다.
 *
 * 반이 세로로 나열된 평범한 목록형 명렬표도 읽을 수 있게 해 두었습니다.
 */

const HEADER_SCAN_ROWS = 12; // 제목·머리글은 위쪽 몇 줄 안에 있습니다.

const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();

/* =========================================================
   제목에서 학년도 · 학년 읽기
   ========================================================= */
function findTitleInfo(rows) {
  let schoolYear = null;
  let grade = null;

  for (const row of rows.slice(0, HEADER_SCAN_ROWS)) {
    for (const cell of row) {
      const text = clean(cell);
      if (!text) continue;

      const year = /(\d{4})\s*학년도/.exec(text);
      if (year && schoolYear == null) schoolYear = Number.parseInt(year[1], 10);

      // "1학년" 은 "2026학년도" 안에도 들어 있어 학년도 표기를 지운 뒤 찾습니다.
      const rest = text.replace(/\d{4}\s*학년도/g, " ");
      const level = /(\d+)\s*학년/.exec(rest);
      if (level && grade == null) grade = Number.parseInt(level[1], 10);
    }
  }

  return { schoolYear, grade };
}

/* =========================================================
   교차표 머리글 찾기
   ========================================================= */
const CLASS_LABEL = /^(\d{1,2})\s*(반|학급)$/;
const NUMBER_LABEL = /^(번호|번|No\.?|순번|연번)$/i;
const MALE_LABEL = /^(남|남자|남학생)$/;
const FEMALE_LABEL = /^(여|여자|여학생)$/;

/** '○반' 제목이 가장 많이 들어 있는 줄을 머리글 줄로 봅니다. */
function findClassRow(rows) {
  let best = null;

  rows.slice(0, HEADER_SCAN_ROWS).forEach((row, index) => {
    const classes = new Map();

    row.forEach((cell, col) => {
      const match = CLASS_LABEL.exec(clean(cell));
      if (match) classes.set(col, Number.parseInt(match[1], 10));
    });

    if (classes.size >= 1 && (!best || classes.size > best.classes.size)) {
      best = { index, classes };
    }
  });

  return best;
}

/** 머리글 위쪽에서 '번호' 열과 '남/여' 구역을 찾습니다. */
function findColumnHints(rows, classRowIndex) {
  const numberColumns = [];
  const genders = new Map();

  for (let row = 0; row <= classRowIndex; row += 1) {
    (rows[row] ?? []).forEach((cell, col) => {
      const text = clean(cell);
      if (!text) return;

      if (NUMBER_LABEL.test(text) && !numberColumns.includes(col)) numberColumns.push(col);
      // 병합된 칸은 범위 전체에 값이 채워져 있어 열마다 성별을 알 수 있습니다.
      else if (MALE_LABEL.test(text)) genders.set(col, "남");
      else if (FEMALE_LABEL.test(text)) genders.set(col, "여");
    });
  }

  numberColumns.sort((a, b) => a - b);
  return { numberColumns, genders };
}

/** 이름 칸 왼쪽에서 가장 가까운 '번호' 열을 고릅니다. */
function pickNumberColumn(numberColumns, col) {
  let left = null;
  for (const candidate of numberColumns) {
    if (candidate < col) left = candidate;
    else break;
  }
  if (left != null) return left;
  return numberColumns.find((candidate) => candidate > col) ?? null;
}

const NOT_A_NAME = /^(\d+(\.\d+)?|[-–—.·]|계|합계|소계|비고|성명|이름)$/;

function looksLikeName(text) {
  if (!text || text.length > 20) return false;
  if (NOT_A_NAME.test(text)) return false;
  if (CLASS_LABEL.test(text) || NUMBER_LABEL.test(text)) return false;
  return true;
}

const toInt = (value) => {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

/* =========================================================
   교차표 읽기
   ========================================================= */
function readCrosstab(rows) {
  const classRow = findClassRow(rows);
  if (!classRow) return null;

  const { numberColumns, genders } = findColumnHints(rows, classRow.index);
  const entries = [];

  for (let row = classRow.index + 1; row < rows.length; row += 1) {
    for (const [col, classNo] of classRow.classes) {
      const name = clean(rows[row]?.[col]);
      if (!looksLikeName(name)) continue;

      const numberColumn = pickNumberColumn(numberColumns, col);
      const studentNo = numberColumn == null ? null : toInt(rows[row]?.[numberColumn]);

      entries.push({
        classNo,
        studentNo,
        name,
        gender: genders.get(col) ?? null,
        source: `${row + 1}행 ${classNo}반`,
      });
    }
  }

  return entries;
}

/* =========================================================
   목록형 읽기 (반이 세로로 나열된 명렬표)
   ========================================================= */
const LIST_HEADERS = [
  ["schoolYear", /^(학년도|년도|학년도\.?)$/],
  ["grade", /^학년$/],
  ["classNo", /^(반|학급|반명)$/],
  ["studentNo", /^(번호|번|출석번호|No\.?)$/i],
  ["name", /^(이름|성명|성 ?명|학생명|학생 이름)$/],
  ["gender", /^(성별|성)$/],
  ["memo", /^(메모|비고|특기사항|참고)$/],
];

function readList(rows) {
  let header = null;

  rows.slice(0, HEADER_SCAN_ROWS).forEach((row, index) => {
    const mapping = {};

    row.forEach((cell, col) => {
      const text = clean(cell);
      for (const [field, pattern] of LIST_HEADERS) {
        if (mapping[field] == null && pattern.test(text)) mapping[field] = col;
      }
    });

    if (mapping.name != null && mapping.studentNo != null && !header) {
      header = { index, mapping };
    }
  });

  if (!header) return null;

  const { mapping } = header;
  const entries = [];

  for (let row = header.index + 1; row < rows.length; row += 1) {
    const cells = rows[row] ?? [];
    const name = clean(cells[mapping.name]);
    if (!looksLikeName(name)) continue;

    entries.push({
      schoolYear: mapping.schoolYear == null ? null : toInt(cells[mapping.schoolYear]),
      grade: mapping.grade == null ? null : toInt(cells[mapping.grade]),
      classNo: mapping.classNo == null ? null : toInt(cells[mapping.classNo]),
      studentNo: toInt(cells[mapping.studentNo]),
      name,
      gender: mapping.gender == null ? null : clean(cells[mapping.gender]) || null,
      memo: mapping.memo == null ? null : clean(cells[mapping.memo]) || null,
      source: `${row + 1}행`,
    });
  }

  return entries;
}

/* =========================================================
   진입점
   ========================================================= */
/**
 * 명렬표 시트를 학생 목록으로 바꿉니다.
 *
 * @param {string[][]} rows
 * @returns {{ schoolYear: number|null, grade: number|null, layout: "교차표"|"목록",
 *             entries: Array<object> }}
 */
export function parseRoster(rows) {
  const title = findTitleInfo(rows);

  const crosstab = readCrosstab(rows);
  const list = crosstab && crosstab.length ? null : readList(rows);
  const found = (crosstab && crosstab.length ? crosstab : list) ?? [];

  const entries = found.map((entry) => ({
    memo: null,
    ...entry,
    schoolYear: entry.schoolYear ?? title.schoolYear,
    grade: entry.grade ?? title.grade,
  }));

  return {
    // 제목이 없는 목록형 명렬표는 읽어 들인 값에서 가져옵니다.
    schoolYear: title.schoolYear ?? entries[0]?.schoolYear ?? null,
    grade: title.grade ?? entries[0]?.grade ?? null,
    layout: crosstab && crosstab.length ? "교차표" : "목록",
    entries,
  };
}

/* =========================================================
   등록 계획 세우기
   ========================================================= */
/**
 * 읽어 들인 학생 목록을 검사하고 기존 데이터와 견주어 봅니다.
 *
 * @param {Array<object>} entries parseRoster 의 결과
 * @param {(key: {schoolYear:number, grade:number, classNo:number, studentNo:number}) => object|null} findExisting
 * @returns {Array<{ status: "new"|"duplicate"|"error", ... }>}
 */
export function buildImportPlan(entries, findExisting) {
  const seen = new Map();

  return entries.map((entry, index) => {
    const row = { ...entry, index, action: "add" };

    const missing = [
      entry.schoolYear == null && "학년도",
      entry.grade == null && "학년",
      entry.classNo == null && "반",
      entry.studentNo == null && "번호",
      !entry.name && "이름",
    ].filter(Boolean);

    if (missing.length) {
      return { ...row, status: "error", action: "skip", message: `${missing.join(", ")}를 읽지 못했습니다.` };
    }

    const key = `${entry.schoolYear}/${entry.grade}/${entry.classNo}/${entry.studentNo}`;

    if (seen.has(key)) {
      return {
        ...row,
        status: "error",
        action: "skip",
        message: `파일 안에서 ${seen.get(key)} 와 자리가 겹칩니다.`,
      };
    }
    seen.set(key, entry.source);

    const existing = findExisting({
      schoolYear: entry.schoolYear,
      grade: entry.grade,
      classNo: entry.classNo,
      studentNo: entry.studentNo,
    });

    if (existing) {
      return {
        ...row,
        status: "duplicate",
        action: "skip",
        existingId: existing.id,
        existingName: existing.name,
        message:
          existing.name === entry.name
            ? "이미 등록된 학생입니다."
            : `이 자리에 ‘${existing.name}’ 학생이 등록되어 있습니다.`,
      };
    }

    return { ...row, status: "new", message: "" };
  });
}
