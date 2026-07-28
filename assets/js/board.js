/**
 * 선생님과 학생이 함께 쓰는 데이터 계층.
 *
 * 상담 기록(users/{uid}/…)과 달리 이쪽은 두 사람이 같이 보는 자료라
 * 최상위 컬렉션에 두고 firestore.rules 로 누가 무엇을 할 수 있는지 나눕니다.
 *
 *   profiles/{uid}     학생이 스스로 적은 학년·반·번호·이름 (선생님은 전부 열람)
 *   notices/{id}       공지사항        (선생님만 작성)
 *   assignments/{id}   과제            (선생님만 작성)
 *   submissions/{id}   과제 제출물     (학생 본인과 선생님만 열람)
 *   portfolios/{id}    포트폴리오      (학생 본인과 선생님만 열람)
 *
 * 학생은 자기 것만 구독하고, 선생님은 전부 구독합니다.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseContext } from "./firebase.js";
import { TEACHER } from "./roles.js";

const emptyCache = () => ({
  profiles: [],
  notices: [],
  assignments: [],
  submissions: [],
  portfolios: [],
});

let cache = emptyCache();
let currentUid = null;
let currentRole = null;
let unsubscribes = [];
let changeHandler = null;
let errorHandler = null;

const collectionRef = (name) => collection(firebaseContext().db, name);

function notifyChange() {
  changeHandler?.();
}

function notifyError(error, fallback) {
  const message =
    error?.code === "permission-denied"
      ? "자료에 접근할 권한이 없습니다. Firestore 보안 규칙을 다시 배포해주세요."
      : error?.code === "unavailable"
        ? "네트워크에 연결할 수 없어 저장하지 못했습니다."
        : fallback;

  errorHandler?.(message, error);
}

/* =========================================================
   동기화
   ========================================================= */
/** 역할에 따라 구독할 목록을 정합니다. */
function subscriptions(uid, role) {
  if (role === TEACHER) {
    return [
      { name: "profiles", source: collectionRef("profiles") },
      { name: "notices", source: collectionRef("notices") },
      { name: "assignments", source: collectionRef("assignments") },
      { name: "submissions", source: collectionRef("submissions") },
      { name: "portfolios", source: collectionRef("portfolios") },
    ];
  }

  // 학생은 공지·과제는 전부, 자기 정보와 제출물·포트폴리오는 자기 것만 봅니다.
  return [
    // 내 정보는 문서 하나라 목록으로 훑지 않고 그 문서만 봅니다.
    { name: "profiles", source: doc(collectionRef("profiles"), uid), single: true },
    { name: "notices", source: collectionRef("notices") },
    { name: "assignments", source: collectionRef("assignments") },
    {
      name: "submissions",
      source: query(collectionRef("submissions"), where("studentUid", "==", uid)),
    },
    {
      name: "portfolios",
      source: query(collectionRef("portfolios"), where("studentUid", "==", uid)),
    },
  ];
}

/**
 * 공용 자료를 실시간으로 구독합니다.
 * @returns {Promise<void>} 첫 데이터가 모두 도착하면 완료됩니다.
 */
export function startBoardSync(uid, role, { onChange, onError } = {}) {
  stopBoardSync();

  currentUid = uid;
  currentRole = role;
  changeHandler = onChange ?? null;
  errorHandler = onError ?? null;

  const targets = subscriptions(uid, role);

  return new Promise((resolve, reject) => {
    const pending = new Set(targets.map((target) => target.name));
    let settled = false;

    const markReady = (name) => {
      if (settled) return;
      pending.delete(name);
      if (pending.size === 0) {
        settled = true;
        resolve();
      }
    };

    for (const { name, source, single } of targets) {
      const unsubscribe = onSnapshot(
        source,
        (snapshot) => {
          const rows = single
            ? snapshot.exists()
              ? [{ id: snapshot.id, ...snapshot.data() }]
              : []
            : snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));

          cache[name] = rows;
          markReady(name);
          notifyChange();
        },
        (error) => {
          if (!settled) {
            settled = true;
            reject(error);
            return;
          }
          notifyError(error, "자료를 불러오는 중 문제가 발생했습니다.");
        }
      );

      unsubscribes.push(unsubscribe);
    }
  });
}

export function stopBoardSync() {
  unsubscribes.forEach((unsubscribe) => unsubscribe());
  unsubscribes = [];
  cache = emptyCache();
  currentUid = null;
  currentRole = null;
  changeHandler = null;
  errorHandler = null;
}

/* =========================================================
   쓰기
   ========================================================= */
const now = () => new Date().toISOString();

function guard(promise, fallback) {
  return promise.catch((error) => {
    notifyError(error, fallback);
    throw error;
  });
}

/** 새 글을 만듭니다. */
function create(name, fields) {
  const ref = doc(collectionRef(name));
  return guard(
    setDoc(ref, { ...fields, createdAt: now(), updatedAt: now() }).then(() => ref.id),
    "저장하지 못했습니다."
  );
}

function patch(name, id, fields) {
  return guard(
    updateDoc(doc(collectionRef(name), id), { ...fields, updatedAt: now() }),
    "수정하지 못했습니다."
  );
}

/**
 * 지운 글은 바로 없애지 않고 deletedAt 을 적어 감춥니다.
 * 목록에서는 빠지지만 휴지통에서 되살릴 수 있습니다.
 */
function softDelete(name, id) {
  return guard(
    updateDoc(doc(collectionRef(name), id), { deletedAt: now() }),
    "삭제하지 못했습니다."
  );
}

function restore(name, id) {
  return guard(
    updateDoc(doc(collectionRef(name), id), { deletedAt: null }),
    "되살리지 못했습니다."
  );
}

/** 완전히 지웁니다. 되돌릴 수 없습니다. */
function purge(name, id) {
  return guard(deleteDoc(doc(collectionRef(name), id)), "완전히 지우지 못했습니다.");
}

const live = (name) => cache[name].filter((row) => !row.deletedAt);
const deleted = (name) => cache[name].filter((row) => row.deletedAt);

const byNewest = (a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));

/* =========================================================
   컬렉션
   ========================================================= */
export const profiles = {
  /** 로그인한 학생 본인의 정보. */
  mine() {
    return cache.profiles.find((p) => p.uid === currentUid) ?? null;
  },
  all() {
    return cache.profiles.slice();
  },
  find(uid) {
    return cache.profiles.find((p) => p.uid === uid) ?? null;
  },
  /** 학생이 스스로 등록·수정합니다. 문서 번호는 계정 번호와 같습니다. */
  save(uid, { name, grade, classNo, studentNo, email }) {
    return guard(
      setDoc(
        doc(collectionRef("profiles"), uid),
        { uid, name, grade, classNo, studentNo, email, updatedAt: now() },
        { merge: true }
      ),
      "학생 정보를 저장하지 못했습니다."
    );
  },
};

export const notices = {
  all() {
    return live("notices").sort(byNewest);
  },
  find(id) {
    return cache.notices.find((n) => n.id === id) ?? null;
  },
  add(fields) {
    return create("notices", fields);
  },
  update(id, fields) {
    return patch("notices", id, fields);
  },
  remove(id) {
    return softDelete("notices", id);
  },
  restore(id) {
    return restore("notices", id);
  },
  purge(id) {
    return purge("notices", id);
  },
  trash() {
    return deleted("notices").sort(byNewest);
  },
};

export const assignments = {
  all() {
    return live("assignments").sort(byNewest);
  },
  find(id) {
    return cache.assignments.find((a) => a.id === id) ?? null;
  },
  add(fields) {
    return create("assignments", fields);
  },
  update(id, fields) {
    return patch("assignments", id, fields);
  },
  remove(id) {
    return softDelete("assignments", id);
  },
  restore(id) {
    return restore("assignments", id);
  },
  purge(id) {
    return purge("assignments", id);
  },
  trash() {
    return deleted("assignments").sort(byNewest);
  },
};

export const submissions = {
  all() {
    return live("submissions").sort(byNewest);
  },
  forAssignment(assignmentId) {
    return live("submissions").filter((s) => s.assignmentId === assignmentId).sort(byNewest);
  },
  /** 학생 본인이 특정 과제에 낸 제출물. */
  mine(assignmentId) {
    return (
      live("submissions").find(
        (s) => s.assignmentId === assignmentId && s.studentUid === currentUid
      ) ?? null
    );
  },
  add(fields) {
    return create("submissions", { ...fields, studentUid: currentUid });
  },
  update(id, fields) {
    return patch("submissions", id, fields);
  },
  remove(id) {
    return softDelete("submissions", id);
  },
  restore(id) {
    return restore("submissions", id);
  },
  purge(id) {
    return purge("submissions", id);
  },
  trash() {
    return deleted("submissions").sort(byNewest);
  },
};

export const portfolios = {
  all() {
    return live("portfolios").sort(byNewest);
  },
  forStudent(uid) {
    return live("portfolios").filter((p) => p.studentUid === uid).sort(byNewest);
  },
  mine() {
    return live("portfolios").filter((p) => p.studentUid === currentUid).sort(byNewest);
  },
  find(id) {
    return cache.portfolios.find((p) => p.id === id) ?? null;
  },
  add(fields) {
    return create("portfolios", { ...fields, studentUid: currentUid });
  },
  update(id, fields) {
    return patch("portfolios", id, fields);
  },
  remove(id) {
    return softDelete("portfolios", id);
  },
  restore(id) {
    return restore("portfolios", id);
  },
  purge(id) {
    return purge("portfolios", id);
  },
  trash() {
    return deleted("portfolios").sort(byNewest);
  },
};

/** 현재 로그인한 사람의 계정 번호와 역할. */
export const session = {
  uid: () => currentUid,
  role: () => currentRole,
};

/**
 * 학생 탈퇴 — 내가 올린 것과 내 정보를 완전히 지웁니다.
 *
 * 졸업하거나 더 이상 쓰지 않을 때 씁니다.
 * 휴지통을 거치지 않고 바로 없애며, 구글 계정 자체는 건드리지 않습니다.
 *
 * @returns {Promise<{ submissions: number, portfolios: number }>}
 */
export async function withdraw() {
  if (!currentUid) throw new Error("로그인 상태를 확인할 수 없습니다.");

  // 휴지통에 있던 것까지 모두 지웁니다.
  const mySubmissions = cache.submissions.filter((row) => row.studentUid === currentUid);
  const myPortfolios = cache.portfolios.filter((row) => row.studentUid === currentUid);

  for (const row of mySubmissions) await purge("submissions", row.id);
  for (const row of myPortfolios) await purge("portfolios", row.id);

  await guard(
    deleteDoc(doc(collectionRef("profiles"), currentUid)),
    "학생 정보를 지우지 못했습니다."
  );

  return { submissions: mySubmissions.length, portfolios: myPortfolios.length };
}
