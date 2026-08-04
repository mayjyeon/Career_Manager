/**
 * 휴지통.
 *
 * 지운 자료는 곧바로 없애지 않고 deletedAt 을 적어 감춰 둡니다.
 * 여기서 되살리거나 완전히 지울 수 있고, 30일이 지난 것은 자동으로 정리합니다.
 *
 * 서버가 따로 없는 정적 사이트라 '30일 뒤 자동 삭제'는
 * 선생님이 앱을 열 때 지난 것을 찾아 지우는 방식으로 동작합니다.
 */
import {
  commitSessions,
  ensureSynced,
  purge as purgeOwn,
  restore as restoreOwn,
  sessions as sessionStore,
  softDelete as softDeleteOwn,
  students as studentStore,
  teacherAchievements,
  teacherPortfolios,
  trash as ownTrash,
} from "./store.js";
import { assignments, notices, portfolios, submissions } from "./board.js";
import { TEACHER } from "./roles.js";

/** 휴지통에 남겨 두는 기간(일). */
export const TRASH_DAYS = 30;

/**
 * 학생을 지울 때 함께 옮겨야 하는, 그 화면을 열 때만 붙는 컬렉션.
 * 미리 불러오지 않으면 학생만 지워지고 자료가 주인 없이 남습니다.
 */
const OWN_STUDENT_DATA = ["portfolios", "achievements"];

const DAY = 86400000;

/** 언제 자동으로 지워지는지. */
export function daysLeft(deletedAt) {
  const gone = new Date(deletedAt).getTime() + TRASH_DAYS * DAY;
  return Math.max(0, Math.ceil((gone - Date.now()) / DAY));
}

const isExpired = (deletedAt) =>
  Date.now() - new Date(deletedAt).getTime() > TRASH_DAYS * DAY;

/* =========================================================
   목록 모으기
   ========================================================= */
const boardKinds = [
  { key: "notices", label: "공지", store: notices },
  { key: "assignments", label: "과제", store: assignments },
  { key: "submissions", label: "제출물", store: submissions },
  { key: "portfolios", label: "포트폴리오", store: portfolios },
];

function studentLabel(student) {
  const name = student.name ?? "이름 없음";
  return student.grade == null
    ? name
    : `${student.grade}학년 ${student.classNo}반 ${student.studentNo}번 · ${name}`;
}

/**
 * 휴지통에 있는 항목을 한 목록으로 모읍니다.
 *
 * 학생을 지울 때 함께 들어간 상담 기록은 따로 보여주지 않습니다
 * (deletedWith 가 붙어 있습니다). 학생을 되살리면 같이 돌아옵니다.
 *
 * @param {string} role
 * @returns {Array<{ kind, label, title, detail, deletedAt, source, collection, id }>}
 */
export function listTrash(role) {
  const items = [];

  if (role === TEACHER) {
    for (const student of ownTrash.students()) {
      items.push({
        kind: "학생",
        title: studentLabel(student),
        detail: "상담 기록도 함께 들어 있습니다.",
        deletedAt: student.deletedAt,
        source: "own",
        collection: "students",
        id: student.id,
      });
    }

    for (const session of ownTrash.sessions()) {
      if (session.deletedWith) continue; // 학생과 함께 지워진 기록

      const student = studentStore.find(session.studentId);
      items.push({
        kind: "상담 기록",
        title: `${session.sessionNo ?? "?"}회기 · ${(session.content ?? "").slice(0, 30)}`,
        detail: student ? student.name : "삭제된 학생",
        deletedAt: session.deletedAt,
        source: "own",
        collection: "sessions",
        id: session.id,
      });
    }

    // 선생님이 등록한 포트폴리오. 학생이 올린 것은 아래 boardKinds 에서 모읍니다.
    for (const entry of ownTrash.portfolios()) {
      if (entry.deletedWith) continue; // 학생과 함께 지워진 자료

      items.push({
        kind: "포트폴리오",
        title: entry.title || (entry.body ?? "").slice(0, 30) || "제목 없음",
        detail: `선생님 등록 · ${entry.studentName ?? "이름 없음"}`,
        deletedAt: entry.deletedAt,
        source: "own",
        collection: "portfolios",
        id: entry.id,
      });
    }

    for (const entry of ownTrash.achievements()) {
      if (entry.deletedWith) continue;

      items.push({
        kind: "세특",
        title: (entry.content ?? "").slice(0, 30) || "내용 없음",
        detail: entry.studentName ?? "이름 없음",
        deletedAt: entry.deletedAt,
        source: "own",
        collection: "achievements",
        id: entry.id,
      });
    }
  }

  for (const { key, label, store } of boardKinds) {
    for (const row of store.trash()) {
      items.push({
        kind: label,
        title: row.title || (row.text ?? "").slice(0, 30) || "제목 없음",
        detail: row.profile?.name ?? "",
        deletedAt: row.deletedAt,
        source: "board",
        collection: key,
        id: row.id,
      });
    }
  }

  return items.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

/* =========================================================
   되살리기 · 완전 삭제
   ========================================================= */
const boardStore = (name) => boardKinds.find((k) => k.key === name)?.store ?? null;

/** 학생과 함께 지워진 자료의 문서 번호. 되살릴 때는 이만큼만 함께 돌아옵니다. */
function deletedWith(rows, studentId) {
  return rows.filter((row) => row.deletedWith === studentId).map((row) => row.id);
}

export async function restoreItem(item) {
  if (item.source === "board") {
    await boardStore(item.collection)?.restore(item.id);
    return;
  }

  if (item.collection === "students") {
    const sessions = deletedWith(ownTrash.sessions(), item.id);
    const portfolios = deletedWith(ownTrash.portfolios(), item.id);
    const achievements = deletedWith(ownTrash.achievements(), item.id);

    await restoreOwn("students", item.id);
    if (sessions.length) await restoreOwn("sessions", sessions);
    if (portfolios.length) await restoreOwn("portfolios", portfolios);
    if (achievements.length) await restoreOwn("achievements", achievements);
    return;
  }

  await restoreOwn(item.collection, item.id);
}

export async function purgeItem(item) {
  if (item.source === "board") {
    await boardStore(item.collection)?.purge(item.id);
    return;
  }

  if (item.collection === "students") {
    await ensureSynced(OWN_STUDENT_DATA);

    // 학생과 함께 지운 것뿐 아니라 그 전에 따로 지워 둔 것까지 모두 없앱니다.
    // 하나라도 남으면 주인 없는 기록이 되어 통계에서 걷어내야 합니다.
    const sessions = sessionStore.allIdsForStudent(item.id);
    const portfolios = teacherPortfolios.allIdsForStudent(item.id);
    const achievements = teacherAchievements.allIdsForStudent(item.id);

    if (sessions.length) await purgeOwn("sessions", sessions);
    if (portfolios.length) await purgeOwn("portfolios", portfolios);
    if (achievements.length) await purgeOwn("achievements", achievements);
    await purgeOwn("students", item.id);
    return;
  }

  await purgeOwn(item.collection, item.id);
}

/** 휴지통을 통째로 비웁니다. */
export async function emptyTrash(role) {
  for (const item of listTrash(role)) await purgeItem(item);
}

/**
 * 30일이 지난 항목을 조용히 지웁니다.
 * 앱을 열 때 한 번 부르며, 실패해도 화면에는 영향을 주지 않습니다.
 *
 * @returns {Promise<number>} 지운 개수
 */
export async function purgeExpired(role) {
  const expired = listTrash(role).filter((item) => isExpired(item.deletedAt));

  for (const item of expired) {
    try {
      await purgeItem(item);
    } catch {
      // 권한이 없거나 연결이 끊겼으면 다음에 다시 시도합니다.
    }
  }

  return expired.length;
}

/* =========================================================
   지우기
   ========================================================= */
/**
 * 학생을 휴지통으로 보냅니다. 상담 기록과 선생님이 등록한 포트폴리오도 함께 들어갑니다.
 *
 * 함께 지운 자료에는 deletedWith 를 붙여, 휴지통 목록에 따로 나오지 않고
 * 학생을 되살릴 때 같이 돌아오게 합니다.
 *
 * 학년도·학년·반·번호는 학생 행 안에 들어 있어 따로 지울 것이 없습니다.
 *
 * @param {string[]} studentIds
 */
export async function trashStudents(studentIds) {
  // 포트폴리오와 세특은 각자의 탭을 열 때 붙이므로, 학생 관리 화면에서 지울 때는
  // 먼저 불러와야 남는 자료 없이 함께 옮길 수 있습니다.
  await ensureSynced(OWN_STUDENT_DATA);

  const deletedAt = new Date().toISOString();
  const sessionOps = [];
  const portfolioOps = [];
  const achievementOps = [];

  for (const studentId of studentIds) {
    for (const row of sessionStore.forStudent(studentId)) {
      sessionOps.push({
        id: row.id,
        mode: "update",
        fields: { deletedAt, deletedWith: studentId },
      });
    }

    for (const row of teacherPortfolios.forStudent(studentId)) {
      portfolioOps.push({ id: row.id, fields: { deletedAt, deletedWith: studentId } });
    }

    for (const row of teacherAchievements.forStudent(studentId)) {
      achievementOps.push({ id: row.id, fields: { deletedAt, deletedWith: studentId } });
    }
  }

  if (sessionOps.length) await commitSessions(sessionOps);
  if (portfolioOps.length) await teacherPortfolios.save(portfolioOps);
  if (achievementOps.length) await teacherAchievements.save(achievementOps);

  // 같은 반 학생을 여러 명 지워도 그 반 문서는 한 번만 씁니다.
  await softDeleteOwn("students", studentIds);
}

/** 상담 기록을 휴지통으로 보냅니다. 여러 건을 한 번에 보낼 수 있습니다. */
export function trashSession(sessionIds) {
  return softDeleteOwn("sessions", sessionIds);
}

/** 선생님이 등록한 포트폴리오를 휴지통으로 보냅니다. */
export function trashPortfolio(entryIds) {
  return softDeleteOwn("portfolios", entryIds);
}

/** 세특을 휴지통으로 보냅니다. */
export function trashAchievement(entryIds) {
  return softDeleteOwn("achievements", entryIds);
}
