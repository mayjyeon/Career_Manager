/**
 * 포트폴리오 엑셀 해석.
 *
 * 선생님이 정리해 둔 표에서 **‘현재학번’ 과 ‘글내용(통합)’ 두 칸만** 읽고
 * 나머지 칸은 모두 무시합니다. 표마다 열 순서와 곁다리 칸이 달라서
 * 자리로 찾지 않고 머리글 이름으로 찾습니다.
 *
 *   ┌──────┬──────────┬────────────────────┬──────┐
 *   │ 이름 │ 현재학번 │    글내용(통합)     │ 비고 │
 *   ├──────┼──────────┼────────────────────┼──────┤
 *   │ 홍길동│  10203   │ 의료 계열 진로 탐색…│      │
 *
 * 학번은 5자리(학년 1 + 반 2 + 번호 2)입니다. 예: 10203 → 1학년 2반 3번.
 * 파일 안에서 학번이 뒤죽박죽이어도 학년·반·번호 순으로 정렬해 돌려줍니다.
 */
import { parseStudentNumber } from "./services.js";

const HEADER_SCAN_ROWS = 20; // 머리글은 위쪽 몇 줄 안에 있습니다.

/** 머리글을 견주기 좋게 다듬습니다. 공백과 괄호 종류 차이는 무시합니다. */
const key = (value) =>
  (value ?? "")
    .replace(/\s+/g, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .toLowerCase();

/** ‘현재학번’ 칸으로 볼 머리글. */
const NUMBER_HEADERS = ["현재학번", "학번", "현재학번(5자리)", "현학번"];

/** ‘글내용(통합)’ 칸으로 볼 머리글. */
const BODY_HEADERS = ["글내용(통합)", "글내용통합", "글내용", "내용(통합)", "통합글내용"];

function findColumn(row, candidates) {
  const wanted = candidates.map(key);

  // 정확히 같은 이름을 먼저 찾고, 없으면 이름이 들어 있는 칸을 씁니다.
  for (const match of [
    (text) => wanted.includes(text),
    (text) => wanted.some((name) => text.includes(name)),
  ]) {
    const at = row.findIndex((cell) => {
      const text = key(cell);
      return text && match(text);
    });
    if (at >= 0) return at;
  }

  return -1;
}

/** 두 칸이 모두 있는 줄을 머리글 줄로 봅니다. */
function findHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const row = rows[index] ?? [];
    const number = findColumn(row, NUMBER_HEADERS);
    const body = findColumn(row, BODY_HEADERS);

    if (number >= 0 && body >= 0) return { index, number, body };
  }
  return null;
}

/** 셀 안의 줄바꿈을 살리고 앞뒤 공백만 다듬습니다. */
const cleanBody = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

/**
 * 시트 하나에서 포트폴리오로 옮길 줄을 읽습니다.
 *
 * @param {string[][]} rows
 * @returns {{ header: object|null, entries: Array<{
 *   index: number, source: string, rawNumber: string, body: string,
 *   grade: number|null, classNo: number|null, studentNo: number|null,
 * }> }}
 */
export function parsePortfolioSheet(rows) {
  const header = findHeader(rows);
  if (!header) return { header: null, entries: [] };

  const entries = [];

  for (let row = header.index + 1; row < rows.length; row += 1) {
    const cells = rows[row] ?? [];
    const rawNumber = String(cells[header.number] ?? "").trim();
    const body = cleanBody(cells[header.body]);

    // 둘 다 비어 있으면 표 아래의 빈 줄입니다. 조용히 넘어갑니다.
    if (!rawNumber && !body) continue;

    const seat = parseStudentNumber(rawNumber);

    entries.push({
      index: entries.length,
      source: `${row + 1}행`,
      rawNumber,
      body,
      grade: seat?.grade ?? null,
      classNo: seat?.classNo ?? null,
      studentNo: seat?.studentNo ?? null,
    });
  }

  // 파일 안에서 학번이 뒤죽박죽이라 학년·반·번호 순으로 정리합니다.
  // 학번을 읽지 못한 줄은 눈에 띄도록 맨 뒤로 보냅니다.
  entries.sort(
    (a, b) =>
      Number(a.grade == null) - Number(b.grade == null) ||
      (a.grade ?? 0) - (b.grade ?? 0) ||
      (a.classNo ?? 0) - (b.classNo ?? 0) ||
      (a.studentNo ?? 0) - (b.studentNo ?? 0) ||
      a.index - b.index
  );

  return { header, entries };
}

/**
 * 읽어 들인 줄을 명렬표 학생과 맞춰 봅니다.
 *
 * @param {Array<object>} entries parsePortfolioSheet 의 결과
 * @param {number} schoolYear 어느 학년도 명렬표에서 찾을지
 * @param {(seat: object) => object|null} findStudent
 * @returns {Array<{ status: "ready"|"noStudent"|"error", student: object|null, ... }>}
 */
export function buildPortfolioPlan(entries, schoolYear, findStudent) {
  return entries.map((entry) => {
    if (!Number.isInteger(schoolYear)) {
      return {
        ...entry,
        status: "error",
        student: null,
        message: "학년도를 숫자로 입력해주세요.",
      };
    }

    if (entry.grade == null) {
      return {
        ...entry,
        status: "error",
        student: null,
        message: entry.rawNumber
          ? `학번 ‘${entry.rawNumber}’ 을 5자리(학년1+반2+번호2)로 읽지 못했습니다.`
          : "현재학번이 비어 있습니다.",
      };
    }

    if (!entry.body) {
      return { ...entry, status: "error", student: null, message: "글내용이 비어 있습니다." };
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

    return { ...entry, status: "ready", student, message: "" };
  });
}
