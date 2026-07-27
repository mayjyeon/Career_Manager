/**
 * Firestore 기반 데이터 계층.
 * 원본 C# 프로젝트의 EF Core + SQLite(AppDbContext)를 대체합니다.
 *
 * 데이터는 로그인한 사용자별로 분리해 저장합니다.
 *   users/{uid}/students/{id}      { name, memo, isActive, createdAt, updatedAt }
 *   users/{uid}/schoolYears/{id}   { studentId, schoolYear, grade, classNo, studentNo, status }
 *   users/{uid}/sessions/{id}      { studentId, sessionDate, sessionNo, category,
 *                                    content, followUpAction, nextPlan, createdAt, updatedAt }
 *
 * 화면 코드가 데이터를 동기적으로 읽을 수 있도록 onSnapshot 으로 받은 내용을
 * 메모리에 그대로 들고 있습니다. 쓰기는 로컬 캐시에 먼저 반영한 뒤 Firestore 로 보내고,
 * 서버에서 확정된 값이 오면 스냅샷이 캐시 전체를 덮어씁니다.
 */
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseContext } from "./firebase.js";

const COLLECTIONS = ["students", "schoolYears", "sessions"];

const emptyCache = () => ({ students: [], schoolYears: [], sessions: [] });

let cache = emptyCache();
let currentUid = null;
let unsubscribes = [];
let changeHandler = null;
let errorHandler = null;

/* =========================================================
   동기화
   ========================================================= */
function collectionRef(name) {
  if (!currentUid) {
    throw new Error("로그인한 뒤에만 데이터에 접근할 수 있습니다.");
  }
  return collection(firebaseContext().db, "users", currentUid, name);
}

function notifyChange() {
  changeHandler?.();
}

function notifyError(error, fallback) {
  const message =
    error?.code === "permission-denied"
      ? "데이터 접근 권한이 없습니다. Firestore 보안 규칙을 확인해주세요."
      : error?.code === "unavailable"
        ? "네트워크에 연결할 수 없어 저장하지 못했습니다."
        : fallback;

  errorHandler?.(message, error);
}

/**
 * 로그인한 사용자의 데이터를 실시간으로 구독합니다.
 * @param {string} uid
 * @param {{ onChange?: () => void, onError?: (message: string, error: unknown) => void }} handlers
 * @returns {Promise<void>} 세 컬렉션의 첫 데이터가 모두 도착하면 완료됩니다.
 */
export function startSync(uid, { onChange, onError } = {}) {
  stopSync();

  currentUid = uid;
  changeHandler = onChange ?? null;
  errorHandler = onError ?? null;

  return new Promise((resolve, reject) => {
    const pending = new Set(COLLECTIONS);
    let settled = false;

    const markReady = (name) => {
      if (settled) return;
      pending.delete(name);
      if (pending.size === 0) {
        settled = true;
        resolve();
      }
    };

    for (const name of COLLECTIONS) {
      const unsubscribe = onSnapshot(
        collectionRef(name),
        (snapshot) => {
          cache[name] = snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data(),
          }));
          markReady(name);
          notifyChange();
        },
        (error) => {
          if (!settled) {
            settled = true;
            reject(error);
            return;
          }
          notifyError(error, "데이터를 불러오는 중 문제가 발생했습니다.");
        }
      );

      unsubscribes.push(unsubscribe);
    }
  });
}

/** 구독을 해제하고 메모리에 있는 데이터를 비웁니다(로그아웃 시). */
export function stopSync() {
  unsubscribes.forEach((unsubscribe) => unsubscribe());
  unsubscribes = [];
  cache = emptyCache();
  currentUid = null;
  changeHandler = null;
  errorHandler = null;
}

/* =========================================================
   쓰기 (로컬 우선 반영 → Firestore 전송)
   ========================================================= */
function applyLocal(name, row) {
  const rows = cache[name];
  const index = rows.findIndex((r) => r.id === row.id);
  if (index >= 0) rows[index] = { ...rows[index], ...row };
  else rows.push(row);
}

/** Firestore 쓰기를 보내고 실패하면 사용자에게 알립니다. */
function send(promise) {
  promise.catch((error) => notifyError(error, "저장하지 못했습니다."));
}

function insert(name, fields) {
  const ref = doc(collectionRef(name));
  const row = { id: ref.id, ...fields };
  applyLocal(name, row);
  notifyChange();
  send(setDoc(ref, fields));
  return row;
}

function patch(name, id, fields) {
  applyLocal(name, { id, ...fields });
  notifyChange();
  send(updateDoc(doc(collectionRef(name), id), fields));
}

/* =========================================================
   컬렉션
   ========================================================= */
export const students = {
  all() {
    return cache.students;
  },
  find(id) {
    return cache.students.find((s) => s.id === id) || null;
  },
  add({ name, memo = null }) {
    const now = new Date().toISOString();
    return insert("students", {
      name,
      memo,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
  update(id, fields) {
    patch("students", id, { ...fields, updatedAt: new Date().toISOString() });
  },
};

export const schoolYears = {
  all() {
    return cache.schoolYears;
  },
  forStudent(studentId) {
    return cache.schoolYears.filter((y) => y.studentId === studentId);
  },
  add({ studentId, schoolYear, grade, classNo, studentNo, status = "재학" }) {
    return insert("schoolYears", {
      studentId,
      schoolYear,
      grade,
      classNo,
      studentNo,
      status,
    });
  },
  update(id, fields) {
    patch("schoolYears", id, fields);
  },
};

export const sessions = {
  all() {
    return cache.sessions;
  },
  forStudent(studentId) {
    return cache.sessions.filter((x) => x.studentId === studentId);
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
    return insert("sessions", {
      studentId,
      sessionDate,
      sessionNo,
      category,
      content,
      followUpAction,
      nextPlan,
      createdAt: now,
      updatedAt: now,
    });
  },
};
