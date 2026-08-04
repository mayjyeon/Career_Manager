/**
 * 업무 로직 계층 — 화면과 데이터 계층 사이에서 목록을 다듬고 규칙을 지킵니다.
 *
 * 선생님 화면(대시보드·학생 관리·상담일지·통계)은 store.js 를 직접 부르지 않고
 * 모두 이 파일을 거칩니다. 정렬 순서와 학년도 규칙이 화면마다 달라지지 않도록
 * 여기 한 곳에만 적어 둡니다.
 */
import { students, sessions, newId } from "./store.js";
import { trashSession, trashStudents } from "./trash.js";
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

export const studentService = {
  /**
   * 활성 학생 목록을 조건에 맞게 조회합니다.
   * @param {{ name?: string, grade?: number|null, classNo?: number|null }} [filter]
   */
  getStudents({ name = "", grade = null, classNo = null } = {}) {
    const keyword = name.trim().toLowerCase();

    const items = students
      .all()
      .filter(
        (s) =>
          s.isActive &&
          (!keyword || s.name.toLowerCase().includes(keyword)) &&
          (grade == null || s.grade === grade) &&
          (classNo == null || s.classNo === classNo)
      )
      .map(toListItem);

    // 최신 학년도 내림차순 → 학년/반/번호 오름차순 → 이름 순
    return items.sort(
      (a, b) =>
        (b.schoolYear ?? 0) - (a.schoolYear ?? 0) ||
        (a.grade ?? 0) - (b.grade ?? 0) ||
        (a.classNo ?? 0) - (b.classNo ?? 0) ||
        (a.studentNo ?? 0) - (b.studentNo ?? 0) ||
        a.name.localeCompare(b.name, "ko")
    );
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
   * 소속과 상담 기록도 함께 휴지통으로 들어가고, 30일 뒤 완전히 사라집니다.
   *
   * @param {string[]} ids
   */
  removeStudents(ids) {
    // 소속은 학생 행 안에 있으므로 함께 옮길 것은 상담 기록뿐입니다.
    return trashStudents(ids, (studentId) =>
      sessions.forStudent(studentId).map((row) => row.id)
    );
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

  /** 통계 화면이 쓰는 전체 목록. */
  getAll() {
    return sessions.all();
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

  /** 상담 기록을 휴지통으로 보냅니다. */
  remove(id) {
    return trashSession(id);
  },

  getTotalCount() {
    return sessions.all().length;
  },
};
