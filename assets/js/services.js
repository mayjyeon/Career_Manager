/**
 * 업무 로직 계층.
 * 원본의 CareerCounseling.Wpf/Services/StudentService.cs,
 * CounselingService.cs 를 그대로 옮긴 것입니다.
 */
import { students, schoolYears, sessions, commit } from "./store.js";

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

  add(schoolYear, grade, classNo, studentNo, name, memo) {
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

    const student = students.add({ name, memo });
    schoolYears.add({
      studentId: student.id,
      schoolYear,
      grade,
      classNo,
      studentNo,
    });
    commit();

    return { ok: true, error: null };
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

    student.name = name;
    student.memo = memo;
    student.updatedAt = new Date().toISOString();

    const sy = latestSchoolYear(id);
    if (!sy) {
      schoolYears.add({ studentId: id, schoolYear, grade, classNo, studentNo });
    } else {
      sy.schoolYear = schoolYear;
      sy.grade = grade;
      sy.classNo = classNo;
      sy.studentNo = studentNo;
    }

    commit();
    return { ok: true, error: null };
  },

  /** 학생을 비활성화합니다. 상담 기록은 남습니다. */
  deactivate(id) {
    const student = students.find(id);
    if (!student) return;

    student.isActive = false;
    student.updatedAt = new Date().toISOString();
    commit();
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
        (a, b) => new Date(b.sessionDate) - new Date(a.sessionDate) || b.id - a.id
      )
      .slice(0, count)
      .map((session) => ({
        ...session,
        student: students.find(session.studentId),
      }));
  },

  add(studentId, date, category, content, followUp, nextPlan) {
    const nextNo = sessions.forStudent(studentId).length + 1;

    sessions.add({
      studentId,
      sessionDate: date,
      sessionNo: nextNo,
      category: category && category.trim() ? category.trim() : "진로상담",
      content,
      followUpAction: followUp,
      nextPlan,
    });

    commit();
    return nextNo;
  },

  getTotalCount() {
    return sessions.all().length;
  },
};
