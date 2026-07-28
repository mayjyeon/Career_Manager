/**
 * 업무 로직 계층.
 * 원본의 CareerCounseling.Wpf/Services/StudentService.cs,
 * CounselingService.cs 를 그대로 옮긴 것입니다.
 */
import { students, schoolYears, sessions, commitAll, newId } from "./store.js";
import { trashSession, trashStudents } from "./trash.js";

/** 가장 최근 학년도의 소속 정보를 돌려줍니다. */
function latestSchoolYear(studentId) {
  const rows = schoolYears.forStudent(studentId);
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (b.schoolYear > a.schoolYear ? b : a));
}

function formatAffiliation(sy) {
  return sy
    ? `${sy.schoolYear}학년도 ${sy.grade}학년 ${sy.classNo}반 ${sy.studentNo}번`
    : "소속 없음";
}

function toListItem(student) {
  const sy = latestSchoolYear(student.id);
  const affiliation = formatAffiliation(sy);

  return {
    id: student.id,
    name: student.name,
    affiliation,
    schoolYear: sy?.schoolYear ?? null,
    grade: sy?.grade ?? null,
    classNo: sy?.classNo ?? null,
    studentNo: sy?.studentNo ?? null,
    sessionCount: sessions.forStudent(student.id).length,
    isActive: student.isActive,
    memo: student.memo,
    display: affiliation ? `${affiliation} · ${student.name}` : student.name,
  };
}

/* =========================================================
   StudentService
   ========================================================= */
export const studentService = {
  /** 활성 학생 목록을 조건에 맞게 조회합니다. */
  getStudents(nameKeyword, grade, classNo) {
    let result = students.all().filter((s) => s.isActive);

    if (nameKeyword && nameKeyword.trim()) {
      const keyword = nameKeyword.trim().toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(keyword));
    }

    if (grade != null) {
      result = result.filter((s) =>
        schoolYears.forStudent(s.id).some((y) => y.grade === grade)
      );
    }

    if (classNo != null) {
      result = result.filter((s) =>
        schoolYears.forStudent(s.id).some((y) => y.classNo === classNo)
      );
    }

    const items = result.map(toListItem);

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

  /** 같은 학년도/학년/반/번호 자리에 이미 있는 학생을 찾습니다. */
  findSeat(key) {
    const seat = schoolYears.findSeat(key);
    if (!seat) return null;

    const student = students.find(seat.studentId);
    return student ? { id: student.id, name: student.name } : null;
  },

  /**
   * 학생이 스스로 적은 정보가 명렬표의 누구인지 맞춰 봅니다.
   * 학년도는 학생이 적지 않으므로 학년·반·번호만 봅니다.
   *
   * @returns {{ status: "matched"|"nameMismatch"|"notFound", student: object|null }}
   */
  matchProfile({ grade, classNo, studentNo, name }) {
    const seats = schoolYears
      .all()
      .filter((y) => y.grade === grade && y.classNo === classNo && y.studentNo === studentNo)
      // 여러 학년도에 같은 자리가 있으면 최근 것을 봅니다.
      .sort((a, b) => (b.schoolYear ?? 0) - (a.schoolYear ?? 0));

    for (const seat of seats) {
      const student = students.find(seat.studentId);
      if (student && student.name === name) return { status: "matched", student };
    }

    const student = seats.length ? students.find(seats[0].studentId) : null;
    return student ? { status: "nameMismatch", student } : { status: "notFound", student: null };
  },

  /** 수정 폼에 채워 넣을 데이터. */
  getEditData(id) {
    const student = students.find(id);
    if (!student) return null;

    const sy = latestSchoolYear(id);

    return {
      id: student.id,
      name: student.name,
      memo: student.memo,
      schoolYear: sy?.schoolYear ?? new Date().getFullYear(),
      grade: sy?.grade ?? 0,
      classNo: sy?.classNo ?? 0,
      studentNo: sy?.studentNo ?? 0,
    };
  },

  add(schoolYear, grade, classNo, studentNo, name, memo, gender = null) {
    const exists = schoolYears
      .all()
      .some(
        (x) =>
          x.schoolYear === schoolYear &&
          x.grade === grade &&
          x.classNo === classNo &&
          x.studentNo === studentNo
      );

    if (exists) {
      return { ok: false, error: "이미 같은 학년도/학년/반/번호의 학생이 있습니다." };
    }

    const student = students.add({ name, gender, memo });
    schoolYears.add({
      studentId: student.id,
      schoolYear,
      grade,
      classNo,
      studentNo,
    });

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
    const operations = [];
    let added = 0;
    let updated = 0;

    for (const row of rows) {
      if (row.action === "add") {
        // 소속에서 학생을 가리켜야 해서 문서 번호를 미리 받아 둡니다.
        const studentId = newId("students");

        operations.push({
          collection: "students",
          id: studentId,
          fields: students.fields({ name: row.name, gender: row.gender, memo: row.memo }),
        });

        operations.push({
          collection: "schoolYears",
          id: newId("schoolYears"),
          fields: {
            studentId,
            schoolYear: row.schoolYear,
            grade: row.grade,
            classNo: row.classNo,
            studentNo: row.studentNo,
            status: "재학",
          },
        });

        added += 1;
      } else if (row.action === "overwrite" && row.existingId) {
        operations.push({
          collection: "students",
          id: row.existingId,
          mode: "update",
          fields: {
            name: row.name,
            gender: row.gender,
            updatedAt: new Date().toISOString(),
          },
        });
        updated += 1;
      }
    }

    if (operations.length) await commitAll(operations);

    return { added, updated, skipped: rows.length - added - updated };
  },

  update(id, schoolYear, grade, classNo, studentNo, name, memo) {
    const student = students.find(id);
    if (!student) return { ok: false, error: "학생을 찾을 수 없습니다." };

    const duplicate = schoolYears
      .all()
      .some(
        (x) =>
          x.studentId !== id &&
          x.schoolYear === schoolYear &&
          x.grade === grade &&
          x.classNo === classNo &&
          x.studentNo === studentNo
      );

    if (duplicate) {
      return { ok: false, error: "이미 같은 학년도/학년/반/번호의 학생이 있습니다." };
    }

    students.update(id, { name, memo });

    const sy = latestSchoolYear(id);
    if (!sy) {
      schoolYears.add({ studentId: id, schoolYear, grade, classNo, studentNo });
    } else {
      schoolYears.update(sy.id, { schoolYear, grade, classNo, studentNo });
    }

    return { ok: true, error: null };
  },

  /** 학생을 비활성화합니다. 목록에서 빠지지만 자료는 그대로 남습니다. */
  deactivate(id) {
    const student = students.find(id);
    if (!student) return;

    students.update(id, { isActive: false });
  },

  /**
   * 학생을 지웁니다(자퇴·졸업 등).
   * 소속과 상담 기록도 함께 휴지통으로 들어가고, 30일 뒤 완전히 사라집니다.
   *
   * @param {string[]} ids
   */
  removeStudents(ids) {
    return trashStudents(ids, (studentId) => ({
      schoolYears: schoolYears.forStudent(studentId).map((row) => row.id),
      sessions: sessions.forStudent(studentId).map((row) => row.id),
    }));
  },

  getActiveCount() {
    return students.all().filter((s) => s.isActive).length;
  },
};

/* =========================================================
   CounselingService
   ========================================================= */
export const counselingService = {
  /** 학생 한 명의 상담 기록을 최신순으로 조회합니다. */
  getForStudent(studentId) {
    return sessions
      .forStudent(studentId)
      .slice()
      .sort(
        (a, b) =>
          new Date(b.sessionDate) - new Date(a.sessionDate) ||
          (b.sessionNo ?? 0) - (a.sessionNo ?? 0)
      );
  },

  /** 최근 상담 기록 count 건을 학생 정보와 함께 조회합니다. */
  getRecent(count) {
    return sessions
      .all()
      .slice()
      .sort(
        (a, b) =>
          new Date(b.sessionDate) - new Date(a.sessionDate) ||
          String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      )
      .slice(0, count)
      .map((session) => ({
        ...session,
        student: students.find(session.studentId),
      }));
  },

  add(studentId, date, category, content, followUp, nextPlan, durationMinutes = null) {
    const nextNo = sessions.forStudent(studentId).length + 1;

    sessions.add({
      studentId,
      sessionDate: date,
      sessionNo: nextNo,
      category: category && category.trim() ? category.trim() : "진로",
      durationMinutes,
      content,
      followUpAction: followUp,
      nextPlan,
    });

    return nextNo;
  },

  /**
   * 기간 안의 상담 기록을 학생 정보와 함께 날짜순으로 돌려줍니다.
   * 진로상담총괄표 내보내기에 씁니다.
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
      .sort(
        (a, b) =>
          new Date(a.sessionDate) - new Date(b.sessionDate) ||
          String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
      )
      .map((session) => {
        const student = students.find(session.studentId);
        const sy = student ? latestSchoolYear(student.id) : null;

        return {
          ...session,
          student: student
            ? {
                name: student.name,
                grade: sy?.grade ?? null,
                classNo: sy?.classNo ?? null,
                studentNo: sy?.studentNo ?? null,
              }
            : null,
        };
      });
  },

  /** 상담 기록을 고칩니다. */
  update(id, { date, category, content, followUp, nextPlan, durationMinutes }) {
    const session = sessions.find(id);
    if (!session) return { ok: false, error: "상담 기록을 찾을 수 없습니다." };

    sessions.update(id, {
      sessionDate: date,
      category: category && category.trim() ? category.trim() : "진로",
      durationMinutes,
      content,
      followUpAction: followUp,
      nextPlan,
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
