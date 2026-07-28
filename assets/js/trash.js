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
  commitAll,
  purge as purgeOwn,
  restore as restoreOwn,
  softDelete as softDeleteOwn,
  students as studentStore,
  trash as ownTrash,
} from "./store.js";
import { assignments, notices, portfolios, submissions } from "./board.js";
import { TEACHER } from "./roles.js";

/** 휴지통에 남겨 두는 기간(일). */
export const TRASH_DAYS = 30;

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
  return student.name ?? "이름 없음";
}

/**
 * 휴지통에 있는 항목을 한 목록으로 모읍니다.
 *
 * 학생을 지울 때 함께 들어간 소속·상담 기록은 따로 보여주지 않습니다
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
        detail: "소속과 상담 기록도 함께 들어 있습니다.",
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
  }

  for (const { key, label, store } of boardKinds) {
    for (const row of store.trash()) {
      items.push({
        kind: label,
        title: row.title || (row.text ?? "").slice(0, 30) || "제목 없음",
        detail: row.profile ? `${row.profile.name}` : "",
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

/** 학생과 함께 지워진 소속·상담 기록의 문서 번호. */
function relatedIds(studentId) {
  return {
    schoolYears: ownTrash
      .schoolYears()
      .filter((row) => row.deletedWith === studentId)
      .map((row) => row.id),
    sessions: ownTrash
      .sessions()
      .filter((row) => row.deletedWith === studentId)
      .map((row) => row.id),
  };
}

export async function restoreItem(item) {
  if (item.source === "board") {
    await boardStore(item.collection)?.restore(item.id);
    return;
  }

  if (item.collection === "students") {
    const related = relatedIds(item.id);
    await restoreOwn("students", item.id);
    if (related.schoolYears.length) await restoreOwn("schoolYears", related.schoolYears);
    if (related.sessions.length) await restoreOwn("sessions", related.sessions);
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
    const related = relatedIds(item.id);
    if (related.sessions.length) await purgeOwn("sessions", related.sessions);
    if (related.schoolYears.length) await purgeOwn("schoolYears", related.schoolYears);
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
 * 학생을 휴지통으로 보냅니다. 소속과 상담 기록도 함께 들어갑니다.
 *
 * 함께 지운 것에는 deletedWith 를 붙여, 휴지통 목록에 따로 나오지 않고
 * 학생을 되살릴 때 같이 돌아오게 합니다.
 *
 * @param {string[]} studentIds
 * @param {(studentId: string) => { schoolYears: string[], sessions: string[] }} findRelated
 */
export function trashStudents(studentIds, findRelated) {
  const deletedAt = new Date().toISOString();
  const operations = [];

  for (const studentId of studentIds) {
    const related = findRelated(studentId);

    for (const name of ["schoolYears", "sessions"]) {
      for (const id of related[name]) {
        operations.push({
          collection: name,
          id,
          mode: "update",
          fields: { deletedAt, deletedWith: studentId },
        });
      }
    }

    operations.push({
      collection: "students",
      id: studentId,
      mode: "update",
      fields: { deletedAt },
    });
  }

  return commitAll(operations);
}

/** 상담 기록 하나를 휴지통으로 보냅니다. */
export function trashSession(sessionId) {
  return softDeleteOwn("sessions", sessionId);
}
