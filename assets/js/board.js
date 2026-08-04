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
import { describeFirestoreError, firebaseContext } from "./firebase.js";
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
  errorHandler?.(describeFirestoreError(error, fallback), error);
}

/* =========================================================
   동기화

   Firestore 는 리스너로 배달된 문서 1개당 읽기 1건을 매깁니다.
   학생이 900명이면 profiles 만으로도 선생님이 로그인할 때마다 900건입니다.
   그래서 로그인에 꼭 필요한 것만 먼저 붙이고, 나머지는 그 화면을 열 때 붙입니다.
   ========================================================= */
/** 어떤 화면에서든 필요하고 양도 적어 로그인할 때 바로 붙이는 것. */
const CORE = ["notices", "assignments"];

/** 구독 하나를 만드는 방법. 역할에 따라 보는 범위가 다릅니다. */
function sourceOf(name, uid, role) {
  if (role === TEACHER) return { source: collectionRef(name) };

  // 학생은 공지·과제는 전부, 자기 정보와 제출물·포트폴리오는 자기 것만 봅니다.
  if (name === "profiles") {
    // 내 정보는 문서 하나라 목록으로 훑지 않고 그 문서만 봅니다.
    return { source: doc(collectionRef("profiles"), uid), single: true };
  }
  if (name === "submissions" || name === "portfolios") {
    return { source: query(collectionRef(name), where("studentUid", "==", uid)) };
  }
  return { source: collectionRef(name) };
}

/** 이름 → { unsubscribe, ready, done } */
const active = new Map();

function subscribe(name) {
  if (active.has(name)) return active.get(name).ready;

  const { source, single } = sourceOf(name, currentUid, currentRole);
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const entry = { unsubscribe: null, ready, done: false };
  active.set(name, entry);

  entry.unsubscribe = onSnapshot(
    source,
    (snapshot) => {
      cache[name] = single
        ? snapshot.exists()
          ? [{ id: snapshot.id, ...snapshot.data() }]
          : []
        : snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));

      if (!entry.done) {
        entry.done = true;
        settle.resolve();
      }
      notifyChange();
    },
    (error) => {
      if (!entry.done) {
        // 다음에 그 화면을 다시 열면 새로 시도할 수 있게 지워 둡니다.
        active.delete(name);
        settle.reject(error);
        return;
      }
      notifyError(error, "자료를 불러오는 중 문제가 발생했습니다.");
    }
  );

  unsubscribes.push(entry.unsubscribe);
  return ready;
}

/** 이 자료의 첫 배달이 끝났는지. */
export function isSubscribed(names) {
  return names.every((name) => active.get(name)?.done === true);
}

/**
 * 화면이 필요로 하는 자료를 그때 붙입니다.
 * 이미 붙어 있으면 통신하지 않습니다.
 *
 * @param {string[]} names
 * @returns {Promise<void>}
 */
export function ensureSubscribed(names) {
  if (!currentUid) return Promise.resolve();
  return Promise.all(names.map(subscribe)).then(() => undefined);
}

/**
 * 로그인 직후 꼭 필요한 자료만 구독합니다.
 * @returns {Promise<void>} 첫 데이터가 도착하면 완료됩니다.
 */
export function startBoardSync(uid, role, { onChange, onError } = {}) {
  stopBoardSync();

  currentUid = uid;
  currentRole = role;
  changeHandler = onChange ?? null;
  errorHandler = onError ?? null;

  // 학생은 자기 정보가 있어야 첫 화면을 열지 말지 정할 수 있습니다(문서 하나).
  const names = role === TEACHER ? CORE : ["profiles", ...CORE];
  return ensureSubscribed(names);
}

export function stopBoardSync() {
  unsubscribes.forEach((unsubscribe) => unsubscribe());
  unsubscribes = [];
  active.clear();
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

/**
 * 컬렉션 하나를 다루는 기본 도구.
 * 네 컬렉션이 모두 같은 방식으로 읽고 쓰므로 여기서 한 벌만 만듭니다.
 *
 * @param {string} name
 * @param {{ owned?: boolean }} [options] owned 면 글에 올린 사람(studentUid)을 남깁니다.
 */
function collectionApi(name, { owned = false } = {}) {
  return {
    /** 휴지통에 없는 글을 최신순으로. */
    all: () => live(name).sort(byNewest),
    /** 휴지통에 있는 것까지 찾습니다(되살리기·완전 삭제에 씁니다). */
    find: (id) => cache[name].find((row) => row.id === id) ?? null,
    add: (fields) => create(name, owned ? { ...fields, studentUid: currentUid } : fields),
    update: (id, fields) => patch(name, id, fields),
    remove: (id) => softDelete(name, id),
    restore: (id) => restore(name, id),
    purge: (id) => purge(name, id),
    trash: () => deleted(name).sort(byNewest),
  };
}

export const notices = collectionApi("notices");

export const assignments = collectionApi("assignments");

export const submissions = {
  ...collectionApi("submissions", { owned: true }),

  forAssignment(assignmentId) {
    return live("submissions")
      .filter((s) => s.assignmentId === assignmentId)
      .sort(byNewest);
  },
  /** 학생 본인이 낸 제출물 전체. */
  mineAll() {
    return live("submissions").filter((s) => s.studentUid === currentUid);
  },
  /** 학생 본인이 특정 과제에 낸 제출물. */
  mine(assignmentId) {
    return (
      live("submissions").find(
        (s) => s.assignmentId === assignmentId && s.studentUid === currentUid
      ) ?? null
    );
  },
};

export const portfolios = {
  ...collectionApi("portfolios", { owned: true }),

  forStudent(uid) {
    return live("portfolios")
      .filter((p) => p.studentUid === uid)
      .sort(byNewest);
  },
  mine() {
    return portfolios.forStudent(currentUid);
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
