/**
 * 이전 형식으로 남아 있는 자료 정리.
 *
 * 예전에는 학생 한 명이 문서 하나(students)였고 소속이 또 다른 문서(schoolYears)였습니다.
 * 지금은 한 반이 문서 하나(classes)입니다. 새 구조로 옮긴 뒤에도 옛 문서는
 * 데이터베이스에 그대로 남아 있는데, 앱이 더는 구독하지 않으므로
 * 읽기 비용은 들지 않지만 콘솔에서 보면 헷갈립니다.
 *
 * 이 파일은 옛 문서가 남아 있는지 확인하고 한 번에 지우는 일만 합니다.
 * 정리가 끝나면 firestore.rules 에서 옛 컬렉션 허용을 빼도 됩니다.
 */
import {
  collection,
  getDocs,
  limit,
  query,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseContext } from "./firebase.js";

/** 지금은 쓰지 않는 옛 컬렉션. */
const OLD_COLLECTIONS = ["students", "schoolYears"];

const refOf = (uid, name) => collection(firebaseContext().db, "users", uid, name);

/**
 * 옛 문서가 남아 있는지 확인합니다.
 *
 * 개수를 세면 문서 수만큼 읽기가 발생하므로 컬렉션마다 한 건만 꺼내 봅니다.
 * 읽기는 최대 2건입니다.
 *
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function hasLegacyData(uid) {
  for (const name of OLD_COLLECTIONS) {
    const snapshot = await getDocs(query(refOf(uid, name), limit(1)));
    if (!snapshot.empty) return true;
  }
  return false;
}

/**
 * 옛 문서를 모두 지웁니다.
 *
 * 지우려면 어떤 문서가 있는지 먼저 읽어야 해서 문서 수만큼 읽기가 한 번 발생하고,
 * 삭제도 쓰기로 계산됩니다. 900명이면 읽기 약 1,800건 + 쓰기 약 1,800건이며
 * 한 번만 치르면 됩니다(하루 무료 한도는 읽기 5만 · 쓰기 2만).
 *
 * @param {string} uid
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<number>} 지운 문서 수
 */
export async function purgeLegacyData(uid, onProgress) {
  const LIMIT = 450;
  const refs = [];

  for (const name of OLD_COLLECTIONS) {
    const snapshot = await getDocs(refOf(uid, name));
    for (const document of snapshot.docs) refs.push(document.ref);
  }

  for (let i = 0; i < refs.length; i += LIMIT) {
    const batch = writeBatch(firebaseContext().db);
    for (const ref of refs.slice(i, i + LIMIT)) batch.delete(ref);
    await batch.commit();
    onProgress?.(Math.min(i + LIMIT, refs.length), refs.length);
  }

  return refs.length;
}
