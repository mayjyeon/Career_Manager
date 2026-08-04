/**
 * 세특 및 활동 엑셀 해석.
 *
 * 기본 칸은 **학번 · 이름 · 세특 내용 · 바이트 수** 네 개입니다.
 * 그 밖에 선생님이 덧붙인 칸(과목·학기·비고 등)은 무엇인지 모르지만
 * **이름 그대로 담아 두었다가 내보낼 때 함께 내보냅니다.**
 *
 *   ┌──────┬──────┬─────────────────────┬──────────┬──────┬──────┐
 *   │ 학번 │ 이름 │      세특 내용       │ 바이트 수 │ 과목 │ 비고 │
 *   ├──────┼──────┼─────────────────────┼──────────┼──────┼──────┤
 *   │10203 │박바다│ 수업 중 발표에서 …    │   1,024  │ 국어 │      │
 *                                          └── 다시 세므로 읽지 않습니다
 *                                                          └── 모르는 칸(그대로 보관)
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
 * 앞에 적은 이름과 정확히 같은 것을 먼저 찾고, 없으면 이름이 들어 있는 칸을 씁니다.
 */
const KNOWN = [
  ["studentNumber", ["학번", "현재학번", "현학번", "학번(5자리)"]],
  ["name", ["이름", "성명", "학생명", "학생이름"]],
  [
    "content",
    ["세특내용", "세특", "세부능력및특기사항", "세부능력특기사항", "특기사항", "활동내용", "내용"],
  ],
  ["bytes", ["바이트수", "바이트", "byte", "bytes", "byte수"]],
];

function matchKnown(text) {
  for (const [field, names] of KNOWN) {
    if (names.map(key).includes(text)) return field;
  }
  // 정확히 같은 이름이 없으면 이름이 들어 있는지로 봅니다.
  for (const [field, names] of KNOWN) {
    if (names.map(key).some((name) => text.includes(name))) return field;
  }
  return null;
}

/**
 * 머리글 줄을 찾습니다.
 * 학번 칸과 세특 내용 칸이 모두 있는 줄이어야 합니다.
 *
 * @returns {{ index: number, fields: object, extras: Array<{ column: number, label: string }> }|null}
 */
function findHeader(rows) {
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

    if (fields.studentNumber != null && fields.content != null) {
      return { index, fields, extras };
    }
  }
  return null;
}

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

/**
 * 시트 하나를 읽습니다.
 *
 * @param {string[][]} rows
 * @returns {{ header: object|null, columns: string[], entries: Array<object> }}
 */
export function parseAchievementSheet(rows) {
  const header = findHeader(rows);
  if (!header) return { header: null, columns: [], entries: [] };

  const { fields, extras } = header;
  const entries = [];

  for (let row = header.index + 1; row < rows.length; row += 1) {
    const cells = rows[row] ?? [];
    const at = (column) => (column == null ? "" : clean(cells[column]));

    const rawNumber = at(fields.studentNumber);
    const content = at(fields.content);
    const name = at(fields.name);

    // 덧붙인 칸까지 모두 비어 있으면 표 아래의 빈 줄입니다.
    const extraValues = extras.map(({ label, column }) => ({ label, value: at(column) }));
    if (!rawNumber && !content && !name && extraValues.every((extra) => !extra.value)) continue;

    const seat = parseStudentNumber(rawNumber);

    entries.push({
      index: entries.length,
      source: `${row + 1}행`,
      rawNumber,
      name,
      content,
      // 값이 있는 칸만 남깁니다. 칸 이름은 내보낼 때 그대로 씁니다.
      extras: extraValues.filter((extra) => extra.value),
      grade: seat?.grade ?? null,
      classNo: seat?.classNo ?? null,
      studentNo: seat?.studentNo ?? null,
    });
  }

  return { header, columns: extras.map((extra) => extra.label), entries };
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
  const found = sheets
    .map((sheet) => ({ name: sheet.name, ...parseAchievementSheet(sheet.rows) }))
    .filter((sheet) => sheet.header);

  if (found.length === 0) return { sheets: [], entries: [] };

  const entries = [];

  for (const sheet of found) {
    for (const entry of sheet.entries) {
      entries.push({
        ...entry,
        index: entries.length,
        source: found.length > 1 ? `${sheet.name} ${entry.source}` : entry.source,
        extras:
          found.length > 1
            ? [{ label: "시트", value: sheet.name }, ...entry.extras]
            : entry.extras,
      });
    }
  }

  // 파일 안에서 학번이 뒤죽박죽이어도 학년·반·번호 순으로 정리합니다.
  // 학번을 읽지 못한 줄은 눈에 띄도록 맨 뒤로 보냅니다.
  entries.sort(
    (a, b) =>
      Number(a.grade == null) - Number(b.grade == null) ||
      (a.grade ?? 0) - (b.grade ?? 0) ||
      (a.classNo ?? 0) - (b.classNo ?? 0) ||
      (a.studentNo ?? 0) - (b.studentNo ?? 0) ||
      a.index - b.index
  );

  return { sheets: found.map((sheet) => sheet.name), entries };
}

/**
 * 읽어 들인 줄을 명렬표 학생과 맞춰 봅니다.
 *
 * @param {Array<object>} entries parseAchievementWorkbook 의 결과
 * @param {number} schoolYear 어느 학년도 명렬표에서 찾을지
 * @param {(seat: object) => object|null} findStudent
 * @returns {Array<{ status: "ready"|"noStudent"|"error", student: object|null, ... }>}
 */
export function buildAchievementPlan(entries, schoolYear, findStudent) {
  return entries.map((entry) => {
    if (!Number.isInteger(schoolYear)) {
      return { ...entry, status: "error", student: null, message: "학년도를 숫자로 입력해주세요." };
    }

    if (entry.grade == null) {
      return {
        ...entry,
        status: "error",
        student: null,
        message: entry.rawNumber
          ? `학번 ‘${entry.rawNumber}’ 을 5자리(학년1+반2+번호2)로 읽지 못했습니다.`
          : "학번이 비어 있습니다.",
      };
    }

    if (!entry.content) {
      return { ...entry, status: "error", student: null, message: "세특 내용이 비어 있습니다." };
    }

    const student = findStudent({
      schoolYear,
      grade: entry.grade,
      classNo: entry.classNo,
      studentNo: entry.studentNo,
    });

    if (!student) {
      return {
        ...entry,
        status: "noStudent",
        student: null,
        message: `${schoolYear}학년도 명렬표에 그 자리의 학생이 없습니다.`,
      };
    }

    return {
      ...entry,
      status: "ready",
      student,
      // 파일의 이름과 명렬표의 이름이 다르면 알려 줍니다(저장은 명렬표를 따릅니다).
      message: entry.name && entry.name !== student.name ? `명렬표에는 ‘${student.name}’ 입니다.` : "",
    };
  });
}
