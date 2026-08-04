/**
 * 세특 및 활동 엑셀 해석.
 *
 * 학생을 가리키는 방법이 파일마다 다릅니다. 둘 다 읽습니다.
 *
 *   ① 학번 한 칸 (5자리)         ② 학년·반·번호가 따로
 *   ┌───────┬─────────────┐      ┌──────┬──────┬──────┬─────────────┐
 *   │ 학번  │  교과세특    │      │ 반   │ 번호 │ 이름 │  교과세특    │
 *   ├───────┼─────────────┤      ├──────┼──────┼──────┼─────────────┤
 *   │ 10203 │ 수업 중 …    │      │  2   │  3   │박바다│ 수업 중 …    │
 *
 * ②처럼 학년이 아예 없는 파일도 있습니다(학년마다 파일을 따로 두는 경우).
 * 그때는 제목 줄이나 시트 이름에서 찾아보고, 그래도 없으면
 * 미리보기에서 선생님이 고른 값을 씁니다.
 *
 * 세특 내용 칸의 이름도 학교마다 다릅니다(교과세특·세특·세부능력 및 특기사항 …).
 * 이름이 정확히 같지 않아도 알아볼 수 있게 견줍니다.
 *
 * 선생님이 덧붙인 칸(과목·학기·비고 등)은 무엇인지 모르지만
 * **이름 그대로 담아 두었다가 내보낼 때 함께 내보냅니다.**
 *
 * 바이트 수는 파일에 적힌 값을 믿지 않고 세특 내용에서 다시 셉니다.
 * 내용을 고치면 값이 어긋나기 때문입니다.
 */
import { parseStudentNumber } from "./services.js";

const HEADER_SCAN_ROWS = 20; // 머리글은 위쪽 몇 줄 안에 있습니다.

/** 머리글을 견주기 좋게 다듬습니다. 공백과 괄호 종류 차이는 무시합니다. */
const key = (value) =>
  (value ?? "")
    .replace(/\s+/g, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .toLowerCase();

/**
 * 기본 칸으로 볼 머리글.
 *
 * exact 는 이름이 정확히 같아야 하고, loose 는 그 말이 들어 있기만 하면 됩니다.
 * ‘반’·‘번호’ 처럼 짧은 이름을 느슨하게 견주면 ‘일반선택’·‘번호표’ 같은 엉뚱한 칸까지
 * 걸려들기 때문에, 헷갈릴 일이 없는 이름만 loose 에 둡니다.
 */
const KNOWN = [
  ["studentNumber", { exact: ["학번", "현재학번", "현학번", "학번(5자리)"], loose: ["학번"] }],
  ["grade", { exact: ["학년"], loose: [] }],
  ["classNo", { exact: ["반", "학급", "반명"], loose: [] }],
  ["studentNo", { exact: ["번호", "번", "출석번호", "no", "no."], loose: ["출석번호"] }],
  ["name", { exact: ["이름", "성명", "학생명", "학생이름"], loose: [] }],
  [
    "content",
    {
      exact: [
        "교과세특",
        "세특내용",
        "세특",
        "세부능력및특기사항",
        "세부능력특기사항",
        "특기사항",
        "활동내용",
        "내용",
      ],
      // 교과세특·과목세특·창체활동특기사항처럼 앞뒤에 말이 붙어도 알아봅니다.
      loose: ["세특", "특기사항", "활동내용"],
    },
  ],
  ["bytes", { exact: ["바이트수", "바이트", "byte", "bytes", "byte수"], loose: ["바이트", "byte"] }],
];

function matchKnown(text) {
  for (const [field, { exact }] of KNOWN) {
    if (exact.map(key).includes(text)) return field;
  }
  for (const [field, { loose }] of KNOWN) {
    if (loose.map(key).some((name) => text.includes(name))) return field;
  }
  return null;
}

/** 없을 때 사용자에게 보여 줄 칸 이름. */
const CONTENT_LABEL = "세특 내용(교과세특)";
const SEAT_LABEL = "학번 또는 번호";

/**
 * 자리를 알아낼 수 있는 줄인지.
 * 학번 한 칸이 있거나, 적어도 번호가 있으면 됩니다
 * (학년·반은 없으면 제목이나 미리보기에서 채웁니다).
 */
const hasSeat = (fields) => fields.studentNumber != null || fields.studentNo != null;

/**
 * 머리글 줄을 찾습니다.
 *
 * @returns {{ index, fields, extras, missing: string[] }|null}
 *          missing 은 세특 내용 칸이나 자리 칸 중 무엇이 없었는지입니다.
 */
function findHeader(rows) {
  let best = null;

  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const row = rows[index] ?? [];
    const fields = {};
    const extras = [];

    row.forEach((cell, column) => {
      const label = String(cell ?? "").trim();
      if (!label) return;

      const field = matchKnown(key(label));

      // 같은 뜻의 칸이 두 개면 첫 번째만 기본 칸으로 보고 나머지는 덧붙인 칸으로 둡니다.
      if (field && fields[field] == null) fields[field] = column;
      else extras.push({ column, label });
    });

    const found = { index, fields, extras };

    if (fields.content != null && hasSeat(fields)) return { ...found, missing: [] };

    // 못 찾았으면 무엇이 없었는지 알려 주려고 가장 그럴듯한 줄을 기억해 둡니다.
    const score = (fields.content != null ? 1 : 0) + (hasSeat(fields) ? 1 : 0);
    if (score > 0 && (!best || score > best.score)) best = { ...found, score };
  }

  if (!best) return null;

  return {
    ...best,
    missing: [
      best.fields.content == null && CONTENT_LABEL,
      !hasSeat(best.fields) && SEAT_LABEL,
    ].filter(Boolean),
  };
}

/* =========================================================
   학년도 · 학년 · 반 주워 오기

   학년마다 파일을 따로 두면 표 안에는 반과 번호만 있고 학년이 없습니다.
   제목 줄("2026학년도 1학년 교과세특")이나 시트 이름("1학년", "1-2")에서 찾아봅니다.
   ========================================================= */
function readContext(text) {
  const clean = (text ?? "").replace(/\s+/g, " ");
  const context = { schoolYear: null, grade: null, classNo: null };

  const year = /(\d{4})\s*학년도/.exec(clean);
  if (year) context.schoolYear = Number.parseInt(year[1], 10);

  // "1학년" 은 "2026학년도" 안에도 들어 있어 학년도 표기를 지운 뒤 찾습니다.
  const rest = clean.replace(/\d{4}\s*학년도/g, " ");

  const grade = /(\d+)\s*학년/.exec(rest);
  if (grade) context.grade = Number.parseInt(grade[1], 10);

  const classNo = /(\d+)\s*반/.exec(rest);
  if (classNo) context.classNo = Number.parseInt(classNo[1], 10);

  // 시트 이름에 흔한 "1-2"(1학년 2반) 표기.
  if (context.grade == null && context.classNo == null) {
    const short = /^\s*(\d)\s*-\s*(\d{1,2})\s*$/.exec(clean);
    if (short) {
      context.grade = Number.parseInt(short[1], 10);
      context.classNo = Number.parseInt(short[2], 10);
    }
  }

  return context;
}

/** 머리글 위쪽 줄과 시트 이름을 훑어 학년도·학년·반을 찾습니다. */
function findContext(rows, sheetName, headerIndex) {
  const found = { schoolYear: null, grade: null, classNo: null };
  let fromSheetName = false;

  const take = (context, viaSheetName) => {
    for (const field of ["schoolYear", "grade", "classNo"]) {
      if (found[field] == null && context[field] != null) {
        found[field] = context[field];
        if (viaSheetName) fromSheetName = true;
      }
    }
  };

  for (let row = 0; row < headerIndex; row += 1) {
    for (const cell of rows[row] ?? []) take(readContext(cell), false);
  }

  take(readContext(sheetName), true);

  return { ...found, fromSheetName };
}

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

const toInt = (value) => {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * 시트 하나를 읽습니다.
 *
 * @param {string[][]} rows
 * @param {string} [sheetName]
 * @returns {{ header: object|null, missing: string[], context: object, entries: Array<object> }}
 */
export function parseAchievementSheet(rows, sheetName = "") {
  const header = findHeader(rows);
  if (!header || header.missing.length) {
    return { header: null, missing: header?.missing ?? [], context: {}, entries: [] };
  }

  const { fields, extras } = header;
  const context = findContext(rows, sheetName, header.index);
  const entries = [];

  for (let row = header.index + 1; row < rows.length; row += 1) {
    const cells = rows[row] ?? [];
    const at = (column) => (column == null ? "" : clean(cells[column]));

    const rawNumber = at(fields.studentNumber);
    const content = at(fields.content);
    const name = at(fields.name);

    // 덧붙인 칸까지 모두 비어 있으면 표 아래의 빈 줄입니다.
    const extraValues = extras.map(({ label, column }) => ({ label, value: at(column) }));
    const seatCells = [rawNumber, at(fields.grade), at(fields.classNo), at(fields.studentNo)];
    if (
      seatCells.every((value) => !value) &&
      !content &&
      !name &&
      extraValues.every((extra) => !extra.value)
    ) {
      continue;
    }

    // 학번 한 칸이 있으면 그것을 풀고, 없으면 학년·반·번호 칸을 그대로 씁니다.
    const fromNumber = parseStudentNumber(rawNumber);

    entries.push({
      index: entries.length,
      source: `${row + 1}행`,
      rawNumber,
      name,
      content,
      // 값이 있는 칸만 남깁니다. 칸 이름은 내보낼 때 그대로 씁니다.
      extras: extraValues.filter((extra) => extra.value),
      grade: fromNumber?.grade ?? toInt(at(fields.grade)),
      classNo: fromNumber?.classNo ?? toInt(at(fields.classNo)),
      studentNo: fromNumber?.studentNo ?? toInt(at(fields.studentNo)),
      // 학번 칸이 있는데 5자리로 못 읽은 줄인지 구분하려고 남깁니다.
      brokenNumber: Boolean(rawNumber) && !fromNumber,
    });
  }

  return { header, missing: [], context, entries };
}

/**
 * 파일 안의 모든 시트를 읽어 한 목록으로 모읍니다.
 *
 * 보통은 시트가 하나지만, 여러 개라면 어느 시트에서 왔는지 잃지 않도록
 * ‘시트’ 라는 칸을 덧붙여 둡니다.
 *
 * @param {Array<{ name: string, rows: string[][] }>} sheets
 */
export function parseAchievementWorkbook(sheets) {
  const parsed = sheets.map((sheet) => ({
    name: sheet.name,
    ...parseAchievementSheet(sheet.rows, sheet.name),
  }));

  const found = parsed.filter((sheet) => sheet.header);

  if (found.length === 0) {
    // 어느 시트에서든 가장 많이 찾아낸 쪽의 안내를 그대로 전합니다.
    // 어느 칸도 못 알아봤으면 둘 다 없다고 알립니다.
    const missing = parsed
      .map((sheet) => sheet.missing)
      .filter((list) => list.length)
      .sort((a, b) => a.length - b.length)[0];

    return {
      sheets: [],
      entries: [],
      context: {},
      missing: missing ?? [CONTENT_LABEL, SEAT_LABEL],
    };
  }

  const entries = [];

  for (const sheet of found) {
    for (const entry of sheet.entries) {
      entries.push({
        ...entry,
        index: entries.length,
        source: found.length > 1 ? `${sheet.name} ${entry.source}` : entry.source,
        // 시트 이름을 학년·반으로 이미 썼다면 칸을 또 만들지 않습니다.
        extras:
          found.length > 1 && !sheet.context.fromSheetName
            ? [{ label: "시트", value: sheet.name }, ...entry.extras]
            : entry.extras,
        // 학년·반 칸이 없는 줄은 그 시트의 제목에서 찾은 값을 씁니다.
        grade: entry.grade ?? sheet.context.grade,
        classNo: entry.classNo ?? sheet.context.classNo,
      });
    }
  }

  // 파일 안에서 학번이 뒤죽박죽이어도 학년·반·번호 순으로 정리합니다.
  // 학번을 읽지 못한 줄은 눈에 띄도록 맨 뒤로 보냅니다.
  entries.sort(
    (a, b) =>
      Number(a.studentNo == null) - Number(b.studentNo == null) ||
      (a.grade ?? 0) - (b.grade ?? 0) ||
      (a.classNo ?? 0) - (b.classNo ?? 0) ||
      (a.studentNo ?? 0) - (b.studentNo ?? 0) ||
      a.index - b.index
  );

  // 학년·반이 비어 있는 줄에 미리 채워 넣을 값(첫 시트에서 찾은 것).
  const context = found.find((sheet) => sheet.context.grade != null)?.context ?? found[0].context;

  return {
    sheets: found.map((sheet) => sheet.name),
    entries,
    context,
    missing: [],
  };
}

/**
 * 읽어 들인 줄을 명렬표 학생과 맞춰 봅니다.
 *
 * 학년·반은 줄에 있으면 그 값을, 없으면 선생님이 미리보기에서 고른 값을 씁니다.
 * 학년마다 파일을 따로 두면 표 안에 학년이 없기 때문입니다.
 *
 * @param {Array<object>} entries parseAchievementWorkbook 의 결과
 * @param {{ schoolYear: number, grade: number|null, classNo: number|null }} defaults
 * @param {(seat: object) => object|null} findStudent
 * @returns {Array<{ status: "ready"|"noStudent"|"error", student: object|null, ... }>}
 */
export function buildAchievementPlan(entries, defaults, findStudent) {
  const { schoolYear, grade: defaultGrade = null, classNo: defaultClassNo = null } = defaults ?? {};

  return entries.map((entry) => {
    const fail = (message) => ({ ...entry, status: "error", student: null, message });

    if (!Number.isInteger(schoolYear)) return fail("학년도를 숫자로 입력해주세요.");

    const seat = {
      schoolYear,
      grade: entry.grade ?? defaultGrade,
      classNo: entry.classNo ?? defaultClassNo,
      studentNo: entry.studentNo,
    };

    if (entry.brokenNumber && entry.studentNo == null) {
      return fail(`학번 ‘${entry.rawNumber}’ 을 5자리(학년1+반2+번호2)로 읽지 못했습니다.`);
    }

    const missing = [
      seat.grade == null && "학년",
      seat.classNo == null && "반",
      seat.studentNo == null && "번호",
    ].filter(Boolean);

    if (missing.length) {
      return fail(
        `${missing.join("·")} 값을 알 수 없습니다.` +
          (missing.includes("번호") ? "" : " 위에서 채워주세요.")
      );
    }

    if (!entry.content) return fail("세특 내용이 비어 있습니다.");

    const student = findStudent(seat);

    if (!student) {
      return {
        ...entry,
        ...seat,
        status: "noStudent",
        student: null,
        message: `${schoolYear}학년도 명렬표에 그 자리의 학생이 없습니다.`,
      };
    }

    return {
      ...entry,
      ...seat,
      status: "ready",
      student,
      // 파일의 이름과 명렬표의 이름이 다르면 알려 줍니다(저장은 명렬표를 따릅니다).
      message: entry.name && entry.name !== student.name ? `명렬표에는 ‘${student.name}’ 입니다.` : "",
    };
  });
}
