/**
 * 업무 로직 계층 — 화면과 데이터 계층 사이에서 목록을 다듬고 규칙을 지킵니다.
 *
 * 선생님 화면(대시보드·학생 관리·상담일지·통계)은 store.js 를 직접 부르지 않고
 * 모두 이 파일을 거칩니다. 정렬 순서와 학년도 규칙이 화면마다 달라지지 않도록
 * 여기 한 곳에만 적어 둡니다.
 */
import { students, sessions, newId, teacherAchievements, teacherPortfolios } from "./store.js";
import { trashAchievement, trashPortfolio, trashSession, trashStudents } from "./trash.js";
import { JOURNAL_TOPICS, topicsToCategory } from "./counseling-docs.js";

/* =========================================================
   학년도 · 학기

   3월부터 다음 해 2월까지가 한 학년도입니다.
   1·2월은 지난 학년도의 2학기에 속합니다.
   ========================================================= */
/** 그 날짜가 속한 학년도. */
export function schoolYearOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getMonth() + 1 >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

/** 상담 기록이 그 학년도에 속하는지. */
export const inSchoolYear = (session, year) => schoolYearOf(session.sessionDate) === year;

/**
 * 오늘이 속한 학년도·학기와 그 기간.
 * 내보내기 창의 기본값으로 씁니다.
 *
 * @returns {{ year: number, term: 1|2, from: string, to: string }}
 */
export function currentTerm(today = new Date()) {
  const month = today.getMonth() + 1;
  const year = schoolYearOf(today);

  return month >= 3 && month <= 8
    ? { year, term: 1, from: `${year}-03-01`, to: `${year}-08-31` }
    : { year, term: 2, from: `${year}-09-01`, to: `${year + 1}-02-28` };
}

/* =========================================================
   정렬
   ========================================================= */
const byDate = (a, b) => new Date(a.sessionDate) - new Date(b.sessionDate);
const byCreated = (a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));

/** 오래된 상담부터. */
const oldestFirst = (a, b) => byDate(a, b) || byCreated(a, b);

/** 최근 상담부터. */
const newestFirst = (a, b) => oldestFirst(b, a);

/* =========================================================
   StudentService
   ========================================================= */
/**
 * 학생 한 명이 곧 한 자리입니다.
 * 반 문서 안에 들어 있어 학년도·학년·반·번호가 학생 행에 함께 붙어 옵니다.
 */
function formatAffiliation(student) {
  return student.grade == null
    ? "소속 없음"
    : `${student.schoolYear}학년도 ${student.grade}학년 ${student.classNo}반 ${student.studentNo}번`;
}

function toListItem(student) {
  const affiliation = formatAffiliation(student);

  return {
    id: student.id,
    name: student.name,
    affiliation,
    schoolYear: student.schoolYear ?? null,
    grade: student.grade ?? null,
    classNo: student.classNo ?? null,
    studentNo: student.studentNo ?? null,
    sessionCount: sessions.forStudent(student.id).length,
    isActive: student.isActive,
    memo: student.memo,
    display: `${affiliation} · ${student.name}`,
  };
}

/** 자리(학년도·학년·반·번호)만 뽑아냅니다. */
const seatOf = ({ schoolYear, grade, classNo, studentNo }) => ({
  schoolYear,
  grade,
  classNo,
  studentNo,
});

/** 명부에 보이는 차례: 최신 학년도 내림차순 → 학년/반/번호 오름차순 → 이름 순. */
export const bySeat = (a, b) =>
  (b.schoolYear ?? 0) - (a.schoolYear ?? 0) ||
  (a.grade ?? 0) - (b.grade ?? 0) ||
  (a.classNo ?? 0) - (b.classNo ?? 0) ||
  (a.studentNo ?? 0) - (b.studentNo ?? 0) ||
  String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko");

export const studentService = {
  /**
   * 학생 목록을 조건에 맞게 조회합니다.
   *
   * 비활성화한 학생은 기본으로 빠집니다. 다만 그 학생의 상담 기록은 남아 있으므로,
   * 기록을 보거나 정리해야 하는 화면(상담일지)은 includeInactive 로 함께 부릅니다.
   *
   * @param {{ name?: string, grade?: number|null, classNo?: number|null,
   *           includeInactive?: boolean }} [filter]
   */
  getStudents({ name = "", grade = null, classNo = null, includeInactive = false } = {}) {
    const keyword = name.trim().toLowerCase();

    return students
      .all()
      .filter(
        (s) =>
          (s.isActive || includeInactive) &&
          (!keyword || s.name.toLowerCase().includes(keyword)) &&
          (grade == null || s.grade === grade) &&
          (classNo == null || s.classNo === classNo)
      )
      .map(toListItem)
      .sort(bySeat);
  },

  /** 통계 화면처럼 자리 정보가 필요한 곳에서 쓰는 원본 목록. */
  getAll() {
    return students.all();
  },

  /** 같은 학년도/학년/반/번호 자리에 이미 있는 학생을 찾습니다. */
  findSeat(seat) {
    const student = students.findSeat(seat);
    return student ? { id: student.id, name: student.name } : null;
  },

  /** 그 자리의 학생을 목록 항목 모양으로 찾습니다(포트폴리오 일괄 등록에 씁니다). */
  findSeatItem(seat) {
    const student = students.findSeat(seat);
    return student ? toListItem(student) : null;
  },

  /** 명부에 있는 학년도. 최근 것부터입니다. */
  getSchoolYears() {
    const years = new Set(
      students
        .all()
        .map((s) => s.schoolYear)
        .filter((year) => year != null)
    );
    return [...years].sort((a, b) => b - a);
  },

  /**
   * 학생이 스스로 적은 정보가 명렬표의 누구인지 맞춰 봅니다.
   * 학년도는 학생이 적지 않으므로 학년·반·번호만 봅니다.
   *
   * @returns {{ status: "matched"|"nameMismatch"|"notFound", student: object|null }}
   */
  matchProfile({ grade, classNo, studentNo, name }) {
    const seats = students
      .all()
      .filter((s) => s.grade === grade && s.classNo === classNo && s.studentNo === studentNo)
      // 여러 학년도에 같은 자리가 있으면 최근 것을 봅니다.
      .sort((a, b) => (b.schoolYear ?? 0) - (a.schoolYear ?? 0));

    const matched = seats.find((student) => student.name === name);
    if (matched) return { status: "matched", student: matched };

    return seats.length
      ? { status: "nameMismatch", student: seats[0] }
      : { status: "notFound", student: null };
  },

  /** 수정 폼에 채워 넣을 데이터. */
  getEditData(id) {
    const student = students.find(id);
    if (!student) return null;

    return {
      id: student.id,
      name: student.name,
      memo: student.memo,
      schoolYear: student.schoolYear ?? new Date().getFullYear(),
      grade: student.grade ?? 0,
      classNo: student.classNo ?? 0,
      studentNo: student.studentNo ?? 0,
    };
  },

  /**
   * 학생 한 명을 등록합니다.
   * @param {{ schoolYear, grade, classNo, studentNo, name, memo?, gender? }} input
   * @returns {{ ok: boolean, error: string|null }}
   */
  add(input) {
    const seat = seatOf(input);

    if (students.findSeat(seat)) {
      return { ok: false, error: "이미 같은 학년도/학년/반/번호의 학생이 있습니다." };
    }

    students.create(
      seat,
      students.fields({
        name: input.name,
        gender: input.gender ?? null,
        memo: input.memo ?? null,
      })
    );

    return { ok: true, error: null };
  },

  /**
   * 학생 정보를 고칩니다. 자리가 바뀌면 다른 반 문서로 옮깁니다.
   * @param {string} id
   * @param {{ schoolYear, grade, classNo, studentNo, name, memo? }} input
   */
  update(id, input) {
    if (!students.find(id)) return { ok: false, error: "학생을 찾을 수 없습니다." };

    const seat = seatOf(input);
    const seated = students.findSeat(seat);

    if (seated && seated.id !== id) {
      return { ok: false, error: "이미 같은 학년도/학년/반/번호의 학생이 있습니다." };
    }

    students.move(id, seat, { name: input.name, memo: input.memo ?? null });

    return { ok: true, error: null };
  },

  /**
   * 명렬표에서 읽은 학생들을 한 번에 등록합니다.
   *
   * @param {Array<{ action: "add"|"overwrite"|"skip", schoolYear, grade, classNo,
   *                 studentNo, name, gender, memo, existingId }>} rows
   * @returns {Promise<{ added: number, updated: number, skipped: number }>}
   */
  async importRoster(rows) {
    const changes = [];
    let added = 0;
    let updated = 0;

    for (const row of rows) {
      if (row.action === "add") {
        changes.push({
          id: newId(),
          seat: seatOf(row),
          fields: students.fields({ name: row.name, gender: row.gender, memo: row.memo }),
        });
        added += 1;
      } else if (row.action === "overwrite" && row.existingId) {
        changes.push({
          id: row.existingId,
          fields: { name: row.name, gender: row.gender, updatedAt: new Date().toISOString() },
        });
        updated += 1;
      }
    }

    // 같은 반 학생은 문서 하나로 묶여 나가므로 900명이라도 쓰기는 반 개수만큼입니다.
    if (changes.length) await students.save(changes);

    return { added, updated, skipped: rows.length - added - updated };
  },

  /** 학생을 비활성화합니다. 목록에서 빠지지만 자료는 그대로 남습니다. */
  deactivate(id) {
    if (!students.find(id)) return;
    students.update(id, { isActive: false });
  },

  /**
   * 학생을 지웁니다(자퇴·졸업 등).
   * 상담 기록과 선생님이 등록한 포트폴리오도 함께 휴지통으로 들어가고,
   * 30일 뒤 완전히 사라집니다.
   *
   * @param {string[]} ids
   */
  removeStudents(ids) {
    return trashStudents(ids);
  },

  getActiveCount() {
    return students.all().filter((s) => s.isActive).length;
  },
};

/* =========================================================
   CounselingService
   ========================================================= */
/**
 * 화면에서 받은 상담 내용을 저장할 모양으로 바꿉니다.
 *
 * category 는 진로상담총괄표와 통계 화면이 쓰는 3종 분류로,
 * 고른 상담 주제에서 자동으로 정합니다.
 */
function toSessionFields({
  topics,
  topicOther,
  meetingType,
  period,
  subject,
  durationMinutes,
  content,
  intervention,
}) {
  const chosen = (topics ?? []).filter((topic) => JOURNAL_TOPICS.includes(topic));
  const inClass = meetingType === "class";

  return {
    category: topicsToCategory(chosen),
    topics: chosen,
    topicOther: topicOther || null,
    meetingType: meetingType ?? null,
    // 교시와 교과명은 수업 중 상담에만 있습니다.
    period: inClass ? (period ?? null) : null,
    subject: inClass ? (subject || null) : null,
    durationMinutes: durationMinutes ?? null,
    content,
    intervention: intervention || null,
  };
}

/** 서식과 내보내기에 함께 실을 학생 정보(학생 행에서 필요한 칸만 추립니다). */
export const studentInfo = (student) =>
  student
    ? {
        name: student.name,
        grade: student.grade ?? null,
        classNo: student.classNo ?? null,
        studentNo: student.studentNo ?? null,
      }
    : null;

export const counselingService = {
  /** 학생 한 명의 상담 기록을 최신순으로 조회합니다. */
  getForStudent(studentId) {
    return sessions
      .forStudent(studentId)
      .slice()
      .sort((a, b) => byDate(b, a) || (b.sessionNo ?? 0) - (a.sessionNo ?? 0));
  },

  /** 저장된 상담 기록 전부. 주인이 사라진 것도 들어 있습니다. */
  getAll() {
    return sessions.all();
  },

  /**
   * 학생이 남아 있는 상담 기록만. 통계는 이것으로 셉니다.
   *
   * 학생을 완전히 지웠는데 기록이 남으면 건수·시간·상담 학생 수가 부풀려집니다.
   */
  getLinked() {
    return sessions.all().filter((session) => students.find(session.studentId));
  },

  /**
   * 주인(학생)이 없는 상담 기록.
   *
   * 옛 형식으로 옮기던 중이거나 학생만 따로 지웠을 때 남습니다.
   * 상담일지 화면에서 골라 지울 수 있게 여기서 모아 줍니다.
   */
  getOrphans() {
    return sessions
      .all()
      .filter((session) => !students.find(session.studentId))
      .sort(newestFirst);
  },

  /** 최근 상담 기록 count 건을 학생 정보와 함께 조회합니다. */
  getRecent(count) {
    return sessions
      .all()
      .slice()
      .sort(newestFirst)
      .slice(0, count)
      .map((session) => ({ ...session, student: students.find(session.studentId) }));
  },

  /**
   * 상담 기록을 남깁니다. 필드는 진로상담일지 서식의 칸과 같습니다.
   *
   * @param {string} studentId
   * @param {object} record { date, topics, topicOther, meetingType, period, subject,
   *                          durationMinutes, content, intervention }
   * @returns {number} 회기 번호
   */
  add(studentId, record) {
    const nextNo = sessions.forStudent(studentId).length + 1;

    sessions.add({
      studentId,
      sessionDate: record.date,
      sessionNo: nextNo,
      ...toSessionFields(record),
    });

    return nextNo;
  },

  /**
   * 기간 안의 상담 기록을 학생 정보와 함께 날짜순으로 돌려줍니다.
   * 진로상담일지·총괄표 내보내기에 씁니다.
   *
   * @param {string} from yyyy-MM-dd (포함)
   * @param {string} to   yyyy-MM-dd (포함)
   */
  getInRange(from, to) {
    const start = new Date(`${from}T00:00:00`).getTime();
    const end = new Date(`${to}T23:59:59.999`).getTime();

    return sessions
      .all()
      .filter((session) => {
        const time = new Date(session.sessionDate).getTime();
        return !Number.isNaN(time) && time >= start && time <= end;
      })
      .sort(oldestFirst)
      .map((session) => ({
        ...session,
        student: studentInfo(students.find(session.studentId)),
      }));
  },

  /** 상담 기록을 고칩니다. */
  update(id, record) {
    if (!sessions.find(id)) return { ok: false, error: "상담 기록을 찾을 수 없습니다." };

    sessions.update(id, {
      sessionDate: record.date,
      ...toSessionFields(record),
      // 옛 형식으로 저장된 칸은 새 칸으로 옮겼으니 비웁니다.
      followUpAction: null,
      nextPlan: null,
    });

    return { ok: true, error: null };
  },

  /** 상담 기록을 휴지통으로 보냅니다. 여러 건을 한 번에 보낼 수 있습니다. */
  remove(ids) {
    return trashSession(ids);
  },

  getTotalCount() {
    return sessions.all().length;
  },
};

/* =========================================================
   PortfolioService — 선생님이 등록한 포트폴리오

   학생이 스스로 올린 포트폴리오는 board.js 가 맡습니다.
   여기 있는 것은 선생님만 보는 자료로, 명렬표의 학생에 붙습니다.
   ========================================================= */
/** 5자리 학번(학년 1 + 반 2 + 번호 2)을 자리로 풀어 줍니다. 예: 10203 → 1학년 2반 3번 */
export function parseStudentNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 5) return null;

  const grade = Number.parseInt(digits.slice(0, 1), 10);
  const classNo = Number.parseInt(digits.slice(1, 3), 10);
  const studentNo = Number.parseInt(digits.slice(3), 10);

  if (!grade || !classNo || !studentNo) return null;
  return { grade, classNo, studentNo };
}

/** 자리를 5자리 학번으로 되돌립니다. */
export const formatStudentNumber = ({ grade, classNo, studentNo }) =>
  grade == null || classNo == null || studentNo == null
    ? ""
    : `${grade}${String(classNo).padStart(2, "0")}${String(studentNo).padStart(2, "0")}`;

export const portfolioService = {
  /**
   * 선생님이 등록한 포트폴리오를 학생별로 묶어 돌려줍니다.
   * 학번 순(학년도 최신 → 학년 → 반 → 번호)으로 정렬합니다.
   *
   * @param {{ name?: string, grade?: number|null, classNo?: number|null, keyword?: string }} [filter]
   * @returns {Array<{ student: object|null, seat: object, entries: Array<object> }>}
   */
  getGroups({ name = "", grade = null, classNo = null, keyword = "" } = {}) {
    const nameKeyword = name.trim().toLowerCase();
    const textKeyword = keyword.trim().toLowerCase();
    const groups = new Map();

    for (const entry of teacherPortfolios.all()) {
      const group = groups.get(entry.studentId) ?? {
        studentId: entry.studentId,
        student: students.find(entry.studentId),
        // 학생을 지웠어도 항목 안에 남은 자리 정보로 보여 줍니다.
        seat: {
          schoolYear: entry.schoolYear,
          grade: entry.grade,
          classNo: entry.classNo,
          studentNo: entry.studentNo,
        },
        name: entry.studentName ?? "",
        entries: [],
      };

      group.entries.push(entry);
      groups.set(entry.studentId, group);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        name: group.student?.name ?? group.name,
        entries: group.entries.filter(
          (entry) =>
            !textKeyword ||
            `${entry.title ?? ""} ${entry.body ?? ""}`.toLowerCase().includes(textKeyword)
        ),
      }))
      .filter(
        (group) =>
          group.entries.length > 0 &&
          (!nameKeyword || group.name.toLowerCase().includes(nameKeyword)) &&
          (grade == null || group.seat.grade === grade) &&
          (classNo == null || group.seat.classNo === classNo)
      )
      .sort((a, b) => bySeat({ ...a.seat, name: a.name }, { ...b.seat, name: b.name }));
  },

  find(id) {
    return teacherPortfolios.find(id);
  },

  getTotalCount() {
    return teacherPortfolios.all().length;
  },

  /**
   * 포트폴리오를 여러 건 등록합니다.
   * 같은 반은 문서 하나로 묶여 나가므로 한 학년 전체를 올려도 쓰기는 반 개수만큼입니다.
   *
   * @param {Array<{ student: object, title: string, body: string, source?: string }>} rows
   * @returns {Promise<number>} 등록한 건수
   */
  async addMany(rows) {
    const changes = rows.map(({ student, title, body, source }) => ({
      id: newId(),
      seat: seatOf(student),
      fields: teacherPortfolios.fields({
        studentId: student.id,
        studentName: student.name,
        title,
        body,
        source: source ?? null,
      }),
    }));

    if (changes.length) await teacherPortfolios.save(changes);
    return changes.length;
  },

  /** 포트폴리오 한 건의 제목과 내용을 고칩니다. */
  update(id, { title, body }) {
    if (!teacherPortfolios.find(id)) {
      return { ok: false, error: "포트폴리오를 찾을 수 없습니다." };
    }

    teacherPortfolios.update(id, { title, body });
    return { ok: true, error: null };
  },

  /** 포트폴리오를 휴지통으로 보냅니다. 여러 건을 한 번에 보낼 수 있습니다. */
  remove(ids) {
    return trashPortfolio(ids);
  },
};

/* =========================================================
   AchievementService — 세특 및 활동

   선생님이 엑셀로 올리거나 직접 적어 넣습니다. 학생에게는 보이지 않습니다.
   ========================================================= */
/**
 * 나이스 기준 바이트 수.
 *
 * 한글 한 글자 3바이트, 영문·숫자·기호·공백 1바이트입니다(UTF-8 과 같습니다).
 * 줄바꿈은 1바이트로 셉니다.
 */
const encoder = new TextEncoder();

export const byteLength = (text) => encoder.encode(String(text ?? "")).length;

/** 덧붙인 칸 목록을 { 칸이름: 값 } 으로 폅니다. */
const extrasMap = (extras) =>
  Object.fromEntries((extras ?? []).map((extra) => [extra.label, extra.value]));

export const achievementService = {
  /**
   * 세특 목록을 조건에 맞게 조회합니다. 학번 순으로 정렬합니다.
   *
   * @param {{ name?: string, grade?: number|null, classNo?: number|null, keyword?: string }} [filter]
   */
  getEntries({ name = "", grade = null, classNo = null, keyword = "" } = {}) {
    const nameKeyword = name.trim().toLowerCase();
    const textKeyword = keyword.trim().toLowerCase();

    return teacherAchievements
      .all()
      .map((entry) => {
        const student = students.find(entry.studentId);
        return {
          ...entry,
          student,
          name: student?.name ?? entry.studentName ?? "",
          bytes: byteLength(entry.content),
        };
      })
      .filter(
        (entry) =>
          (!nameKeyword || entry.name.toLowerCase().includes(nameKeyword)) &&
          (grade == null || entry.grade === grade) &&
          (classNo == null || entry.classNo === classNo) &&
          (!textKeyword ||
            `${entry.content ?? ""} ${(entry.extras ?? [])
              .map((extra) => extra.value)
              .join(" ")}`
              .toLowerCase()
              .includes(textKeyword))
      )
      .sort(bySeat);
  },

  find(id) {
    return teacherAchievements.find(id);
  },

  getTotalCount() {
    return teacherAchievements.all().length;
  },

  /** 지금까지 쓰인 ‘덧붙인 칸’ 이름을 처음 나온 차례대로 모읍니다. */
  getExtraColumns() {
    const seen = [];

    for (const entry of teacherAchievements.all()) {
      for (const extra of entry.extras ?? []) {
        if (extra.label && !seen.includes(extra.label)) seen.push(extra.label);
      }
    }
    return seen;
  },

  /**
   * 세특을 여러 건 등록합니다.
   *
   * @param {Array<{ student: object, content: string,
   *                 extras?: Array<{label: string, value: string}>, source?: string }>} rows
   * @returns {Promise<number>} 등록한 건수
   */
  async addMany(rows) {
    const changes = rows.map(({ student, content, extras, source }) => ({
      id: newId(),
      seat: seatOf(student),
      fields: teacherAchievements.fields({
        studentId: student.id,
        studentName: student.name,
        content,
        extras: extras ?? [],
        source: source ?? null,
      }),
    }));

    if (changes.length) await teacherAchievements.save(changes);
    return changes.length;
  },

  /** 세특 한 건의 내용과 덧붙인 칸을 고칩니다. */
  update(id, { content, extras }) {
    if (!teacherAchievements.find(id)) {
      return { ok: false, error: "세특을 찾을 수 없습니다." };
    }

    teacherAchievements.update(id, { content, extras: extras ?? [] });
    return { ok: true, error: null };
  },

  /** 세특을 휴지통으로 보냅니다. 여러 건을 한 번에 보낼 수 있습니다. */
  remove(ids) {
    return trashAchievement(ids);
  },

  /**
   * 내보낼 표를 만듭니다.
   *
   * 기본 칸(학번·이름·세특 내용·바이트 수) 뒤에 선생님이 덧붙였던 칸을
   * 처음 나온 차례대로 붙입니다. 바이트 수는 저장된 값이 아니라
   * 지금 내용에서 다시 셉니다.
   *
   * @param {Array<object>} entries getEntries 의 결과
   * @returns {{ columns: Array<object>, rows: Array<Array<string|number>> }}
   */
  toSheet(entries) {
    // 내보낼 줄에 실제로 쓰인 칸만 넣습니다.
    const extraLabels = [];
    for (const entry of entries) {
      for (const extra of entry.extras ?? []) {
        if (extra.label && !extraLabels.includes(extra.label)) extraLabels.push(extra.label);
      }
    }

    const columns = [
      { label: "학번", width: 10 },
      { label: "이름", width: 10 },
      { label: "세특 내용", width: 80 },
      { label: "바이트 수", width: 10, numeric: true },
      ...extraLabels.map((label) => ({ label, width: 14 })),
    ];

    const rows = entries.map((entry) => {
      const extras = extrasMap(entry.extras);

      return [
        formatStudentNumber(entry),
        entry.name,
        entry.content ?? "",
        byteLength(entry.content),
        ...extraLabels.map((label) => extras[label] ?? ""),
      ];
    });

    return { columns, rows };
  },
};
