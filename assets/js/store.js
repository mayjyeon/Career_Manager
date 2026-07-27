/**
 * 로컬 저장소 기반 데이터 계층.
 * 원본 C# 프로젝트의 EF Core + SQLite(AppDbContext)를 대체합니다.
 *
 * 스키마는 CareerCounseling.Core.Entities 와 동일합니다.
 *   Student            { id, name, memo, isActive, createdAt, updatedAt }
 *   StudentSchoolYear  { id, studentId, schoolYear, grade, classNo, studentNo, status }
 *   CounselingSession  { id, studentId, sessionDate, sessionNo, category,
 *                        content, followUpAction, nextPlan, createdAt, updatedAt }
 */

const STORAGE_KEY = "career-manager.db.v1";

const emptyDb = () => ({
  students: [],
  schoolYears: [],
  sessions: [],
  seq: { student: 0, schoolYear: 0, session: 0 },
  seeded: false,
});

let db = null;

function isStorageAvailable() {
  try {
    const probe = "__cm_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const storageOk = isStorageAvailable();

function load() {
  if (db) return db;

  if (!storageOk) {
    // 시크릿 모드 등에서 localStorage 를 못 쓰면 메모리에만 유지합니다.
    db = emptyDb();
    return db;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    db = raw ? { ...emptyDb(), ...JSON.parse(raw) } : emptyDb();
  } catch {
    db = emptyDb();
  }
  return db;
}

function save() {
  if (!storageOk) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* 용량 초과 등은 조용히 무시 */
  }
}

function nextId(kind) {
  const data = load();
  data.seq[kind] = (data.seq[kind] || 0) + 1;
  return data.seq[kind];
}

/** 저장소 전체를 읽습니다(읽기 전용으로 사용). */
export function getDb() {
  return load();
}

/** 변경 사항을 저장합니다. */
export function commit() {
  save();
}

export const students = {
  all() {
    return load().students;
  },
  find(id) {
    return load().students.find((s) => s.id === id) || null;
  },
  add({ name, memo = null }) {
    const now = new Date().toISOString();
    const student = {
      id: nextId("student"),
      name,
      memo,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    load().students.push(student);
    return student;
  },
};

export const schoolYears = {
  all() {
    return load().schoolYears;
  },
  forStudent(studentId) {
    return load().schoolYears.filter((y) => y.studentId === studentId);
  },
  add({ studentId, schoolYear, grade, classNo, studentNo, status = "재학" }) {
    const row = {
      id: nextId("schoolYear"),
      studentId,
      schoolYear,
      grade,
      classNo,
      studentNo,
      status,
    };
    load().schoolYears.push(row);
    return row;
  },
};

export const sessions = {
  all() {
    return load().sessions;
  },
  forStudent(studentId) {
    return load().sessions.filter((x) => x.studentId === studentId);
  },
  add({
    studentId,
    sessionDate,
    sessionNo,
    category,
    content,
    followUpAction = null,
    nextPlan = null,
  }) {
    const now = new Date().toISOString();
    const session = {
      id: nextId("session"),
      studentId,
      sessionDate,
      sessionNo,
      category,
      content,
      followUpAction,
      nextPlan,
      createdAt: now,
      updatedAt: now,
    };
    load().sessions.push(session);
    return session;
  },
};

/**
 * 처음 실행할 때 둘러볼 수 있도록 예시 데이터를 넣습니다.
 * 사용자가 데이터를 하나라도 만들면 다시 실행되지 않습니다.
 */
export function seedIfEmpty() {
  const data = load();
  if (data.seeded || data.students.length > 0) return;

  data.seeded = true;

  const year = new Date().getFullYear();
  const samples = [
    {
      name: "김서연",
      grade: 2,
      classNo: 3,
      studentNo: 7,
      memo: "간호 계열 희망. 봉사 활동 꾸준히 참여 중.",
      logs: [
        {
          daysAgo: 3,
          category: "진로상담",
          content:
            "간호학과 진학을 목표로 하고 있어 필요한 교과 이수 현황을 함께 확인했습니다.\n생명과학Ⅱ 선택을 권유했고, 학생도 동의했습니다.",
          followUpAction: "2학기 과목 선택 신청서 확인",
          nextPlan: "대학별 전형 자료 준비해 다음 상담에서 비교",
        },
        {
          daysAgo: 24,
          category: "학업상담",
          content: "중간고사 이후 성적 흐름을 점검하고 학습 계획을 다시 세웠습니다.",
          followUpAction: null,
          nextPlan: "주간 학습 기록 확인",
        },
      ],
    },
    {
      name: "박도현",
      grade: 2,
      classNo: 3,
      studentNo: 12,
      memo: "컴퓨터공학 관심. 교내 코딩 동아리 부장.",
      logs: [
        {
          daysAgo: 6,
          category: "진로상담",
          content:
            "소프트웨어 관련 학과를 희망하여 관련 학과의 교육 과정 차이를 설명했습니다.\n동아리 프로젝트를 포트폴리오로 정리하기로 했습니다.",
          followUpAction: "동아리 산출물 정리 지도",
          nextPlan: "포트폴리오 초안 검토",
        },
      ],
    },
    {
      name: "이하늘",
      grade: 1,
      classNo: 5,
      studentNo: 2,
      memo: null,
      logs: [
        {
          daysAgo: 11,
          category: "고민상담",
          content: "교우 관계에 대한 고민을 나누었습니다. 학급 활동 참여를 함께 계획했습니다.",
          followUpAction: "담임 교사와 상황 공유",
          nextPlan: null,
        },
      ],
    },
    {
      name: "최민준",
      grade: 3,
      classNo: 1,
      studentNo: 18,
      memo: "체육 계열 진학 준비.",
      logs: [],
    },
  ];

  for (const sample of samples) {
    const student = students.add({ name: sample.name, memo: sample.memo });
    schoolYears.add({
      studentId: student.id,
      schoolYear: year,
      grade: sample.grade,
      classNo: sample.classNo,
      studentNo: sample.studentNo,
    });

    // 오래된 기록이 1회기가 되도록 과거순으로 넣습니다.
    const ordered = [...sample.logs].sort((a, b) => b.daysAgo - a.daysAgo);
    ordered.forEach((log, index) => {
      const date = new Date();
      date.setDate(date.getDate() - log.daysAgo);
      sessions.add({
        studentId: student.id,
        sessionDate: date.toISOString(),
        sessionNo: index + 1,
        category: log.category,
        content: log.content,
        followUpAction: log.followUpAction,
        nextPlan: log.nextPlan,
      });
    });
  }

  save();
}

/** 저장된 데이터를 모두 지웁니다. */
export function resetAll() {
  db = emptyDb();
  save();
}
