/**
 * Firestore 기반 데이터 계층.
 * 원본 C# 프로젝트의 EF Core + SQLite(AppDbContext)를 대체합니다.
 *
 *   users/{uid}/classes/{학년도-학년-반}   { schoolYear, grade, classNo, students: [...], updatedAt }
 *   users/{uid}/sessions/{id}             { studentId, sessionDate, sessionNo, category,
 *                                           durationMinutes, content, followUpAction, nextPlan, … }
 *
 * 학생은 한 명당 문서 하나가 아니라 **한 반이 문서 하나**입니다.
 *
 * Firestore 는 리스너로 배달된 문서 1개당 읽기 1건을 매기는데, 그게 방금 내가 쓴
 * 문서라도 예외가 없습니다. 900명을 한 명씩 문서로 두면 명렬표 한 번 올릴 때
 * 쓰기 1,800건 + 되돌아온 읽기 1,800건이 나옵니다. 반 단위로 묶으면 30문서로 끝납니다.
 * 학생 한 명이 약 120바이트라 30명이 모여도 4KB 남짓, 문서 한도 1MiB 의 0.4% 입니다.
 *
 * 상담 기록은 학기당 수십 건이라 묶지 않고 문서 하나씩 둡니다.
 * 낱개로 고치고 지우기가 훨씬 간단합니다.
 *
 * 화면 코드가 데이터를 동기적으로 읽을 수 있도록 onSnapshot 으로 받은 내용을
 * 메모리에 그대로 들고 있습니다. 쓰기는 로컬 캐시에 먼저 반영한 뒤 Firestore 로 보내고,
 * 서버에서 확정된 값이 오면 스냅샷이 캐시 전체를 덮어씁니다.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseContext } from "./firebase.js";

const COLLECTIONS = ["classes", "sessions"];

const emptyCache = () => ({ classes: [], sessions: [] });

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
 * @returns {Promise<void>} 두 컬렉션의 첫 데이터가 모두 도착하면 완료됩니다.
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
          if (name === "classes") invalidate();
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
  invalidate();
  currentUid = null;
  changeHandler = null;
  errorHandler = null;
}

/** 저장하기 전에 문서 번호를 미리 받아 둡니다. 통신하지 않습니다. */
export function newId() {
  return doc(collectionRef("classes")).id;
}

/* =========================================================
   반 문서 ↔ 학생 행

   화면은 학생을 평평한 목록으로 다룹니다. 반 문서 안에 들어 있다는 사실은
   이 파일 밖으로 나가지 않습니다.
   ========================================================= */
/** 반 문서를 가리키는 이름. 문서 번호를 그대로 씁니다. */
export const classKeyOf = ({ schoolYear, grade, classNo }) => `${schoolYear}-${grade}-${classNo}`;

/** 학생 행에는 없고 반 문서에만 있는 값. */
const SEAT_KEYS = ["schoolYear", "grade", "classNo", "classKey"];

function stripSeat(row) {
  const copy = { ...row };
  for (const key of SEAT_KEYS) delete copy[key];
  return copy;
}

/** Firestore 는 undefined 를 받지 않습니다. */
function clean(row) {
  const copy = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}

let flat = null;
let index = null;

function invalidate() {
  flat = null;
  index = null;
}

/** 모든 반 문서를 펼쳐 학생 한 명이 한 줄인 목록으로 만듭니다. */
function allRows() {
  if (flat) return flat;

  flat = [];
  for (const cls of cache.classes) {
    for (const student of cls.students ?? []) {
      flat.push({
        ...student,
        schoolYear: cls.schoolYear,
        grade: cls.grade,
        classNo: cls.classNo,
        classKey: cls.id,
      });
    }
  }
  return flat;
}

function rowsById() {
  if (!index) index = new Map(allRows().map((row) => [row.id, row]));
  return index;
}

function findClass(key) {
  return cache.classes.find((cls) => cls.id === key) ?? null;
}

function ensureClass({ schoolYear, grade, classNo }) {
  const key = classKeyOf({ schoolYear, grade, classNo });
  let cls = findClass(key);

  if (!cls) {
    cls = { id: key, schoolYear, grade, classNo, students: [] };
    cache.classes.push(cls);
  }

  return cls;
}

/**
 * 학생 행을 반 문서에서 뺍니다.
 * @returns {string|null} 내용이 바뀐 반 문서 이름
 */
function removeRow(id) {
  for (const cls of cache.classes) {
    const at = (cls.students ?? []).findIndex((student) => student.id === id);
    if (at >= 0) {
      cls.students.splice(at, 1);
      return cls.id;
    }
  }
  return null;
}

/** 학생 행을 반 문서에 넣습니다. 이미 있으면 그 자리를 덮어씁니다. */
function putRow(seat, row) {
  const cls = ensureClass(seat);
  const at = cls.students.findIndex((student) => student.id === row.id);

  if (at >= 0) cls.students[at] = row;
  else cls.students.push(row);

  return cls.id;
}

/* =========================================================
   쓰기 (로컬 우선 반영 → Firestore 전송)
   ========================================================= */
/** 일괄 쓰기는 한 번에 500개까지라 나누어 보냅니다. */
const LIMIT = 450;

/** Firestore 쓰기를 보내고 실패하면 사용자에게 알립니다. */
function send(promise) {
  promise.catch((error) => notifyError(error, "저장하지 못했습니다."));
}

/** 바뀐 반 문서만 통째로 다시 씁니다. 빈 반은 문서를 지웁니다. */
async function commitClasses(keys) {
  const list = [...keys].filter(Boolean);
  if (list.length === 0) return;

  const emptied = [];

  for (let i = 0; i < list.length; i += LIMIT) {
    const batch = writeBatch(firebaseContext().db);

    for (const key of list.slice(i, i + LIMIT)) {
      const ref = doc(collectionRef("classes"), key);
      const cls = findClass(key);

      if (!cls || cls.students.length === 0) {
        batch.delete(ref);
        emptied.push(key);
        continue;
      }

      // 번호 순으로 정렬해 두면 사람이 콘솔에서 열어 봐도 읽을 만합니다.
      cls.students.sort((a, b) => (a.studentNo ?? 0) - (b.studentNo ?? 0));

      batch.set(ref, {
        schoolYear: cls.schoolYear,
        grade: cls.grade,
        classNo: cls.classNo,
        students: cls.students,
        updatedAt: new Date().toISOString(),
      });
    }

    await batch.commit();
  }

  if (emptied.length) {
    cache.classes = cache.classes.filter((cls) => !emptied.includes(cls.id));
    invalidate();
  }
}

/**
 * 학생을 추가·수정·이동·삭제합니다.
 *
 * 같은 반 학생을 여러 명 바꿔도 그 반 문서는 한 번만 씁니다.
 * 명렬표 900명을 올려도 쓰기는 반 개수(30건)로 끝납니다.
 *
 * @param {Array<{
 *   id: string,
 *   seat?: { schoolYear: number, grade: number, classNo: number, studentNo?: number },
 *   fields?: object,
 *   drop?: boolean,
 * }>} changes
 * @returns {Promise<void>}
 */
export async function saveStudents(changes) {
  const dirty = new Set();

  // 색인은 한 번만 만들고 바뀐 만큼 따라 고칩니다.
  // 명렬표 900명을 한 번에 넣을 때 반복마다 다시 만들면 너무 느립니다.
  const known = new Map(rowsById());

  for (const { id, seat, fields = {}, drop } of changes) {
    const current = known.get(id) ?? null;

    if (drop) {
      dirty.add(removeRow(id));
      known.delete(id);
      continue;
    }

    // 자리를 새로 정하지 않으면 지금 있는 반에 그대로 둡니다.
    const place = seat ?? current;
    if (!place) continue;

    const key = classKeyOf(place);

    // 반이 바뀌면 옛 반 문서에서 먼저 뺍니다(그 문서도 다시 써야 합니다).
    if (current && current.classKey !== key) dirty.add(removeRow(id));

    const { studentNo } = seat ?? {};
    const row = clean({
      ...(current ? stripSeat(current) : {}),
      ...(studentNo === undefined ? {} : { studentNo }),
      ...fields,
      id,
    });

    putRow(place, row);

    // place 는 좌석만 쓰고 나머지 값은 방금 만든 row 를 따릅니다.
    const { schoolYear, grade, classNo } = place;
    known.set(id, { ...row, schoolYear, grade, classNo, classKey: key });
    dirty.add(key);
  }

  invalidate();
  notifyChange();
  await commitClasses(dirty);
}

/* -------- 상담 기록(문서 하나씩) -------- */
function applyLocalSession(row) {
  const rows = cache.sessions;
  const at = rows.findIndex((r) => r.id === row.id);
  if (at >= 0) rows[at] = { ...rows[at], ...row };
  else rows.push(row);
}

function insertSession(fields) {
  const ref = doc(collectionRef("sessions"));
  const row = { id: ref.id, ...fields };
  applyLocalSession(row);
  notifyChange();
  send(setDoc(ref, fields));
  return row;
}

function patchSession(id, fields) {
  applyLocalSession({ id, ...fields });
  notifyChange();
  send(updateDoc(doc(collectionRef("sessions"), id), fields));
}

/**
 * 상담 기록 여러 건을 한 번에 저장합니다.
 * @param {Array<{ id: string, fields: object, mode?: "set"|"update" }>} operations
 */
export async function commitSessions(operations) {
  for (let i = 0; i < operations.length; i += LIMIT) {
    const chunk = operations.slice(i, i + LIMIT);
    const batch = writeBatch(firebaseContext().db);

    for (const operation of chunk) {
      const ref = doc(collectionRef("sessions"), operation.id);

      // 화면에 곧바로 보이도록 로컬 캐시를 먼저 갱신합니다.
      applyLocalSession({ id: operation.id, ...operation.fields });

      if (operation.mode === "update") batch.update(ref, operation.fields);
      else batch.set(ref, operation.fields);
    }

    notifyChange();
    await batch.commit();
  }
}

/* =========================================================
   휴지통
   ========================================================= */
/**
 * 지운 자료는 바로 없애지 않고 deletedAt 을 적어 감춥니다.
 * 목록에서는 빠지지만 휴지통에서 되살릴 수 있습니다.
 */
const asList = (ids) => (Array.isArray(ids) ? ids : [ids]);

/** 휴지통으로 보냅니다. */
export function softDelete(name, ids) {
  const deletedAt = new Date().toISOString();

  if (name === "students") {
    return saveStudents(asList(ids).map((id) => ({ id, fields: { deletedAt } })));
  }

  return commitSessions(
    asList(ids).map((id) => ({ id, mode: "update", fields: { deletedAt } }))
  );
}

/** 휴지통에서 되살립니다. */
export function restore(name, ids) {
  if (name === "students") {
    return saveStudents(asList(ids).map((id) => ({ id, fields: { deletedAt: null } })));
  }

  return commitSessions(
    asList(ids).map((id) => ({ id, mode: "update", fields: { deletedAt: null } }))
  );
}

/** 완전히 지웁니다. 되돌릴 수 없습니다. */
export async function purge(name, ids) {
  if (name === "students") {
    await saveStudents(asList(ids).map((id) => ({ id, drop: true })));
    return;
  }

  for (const id of asList(ids)) {
    const at = cache.sessions.findIndex((row) => row.id === id);
    if (at >= 0) cache.sessions.splice(at, 1);
    await deleteDoc(doc(collectionRef("sessions"), id));
  }

  notifyChange();
}

/** 휴지통에 있는 자료. */
export const trash = {
  students: () => allRows().filter((row) => row.deletedAt),
  sessions: () => cache.sessions.filter((row) => row.deletedAt),
};

/* =========================================================
   컬렉션
   ========================================================= */
export const students = {
  /** 휴지통에 없는 학생. 좌석(학년도·학년·반·번호)이 함께 붙어 있습니다. */
  all() {
    return allRows().filter((row) => !row.deletedAt);
  },
  find(id) {
    const row = rowsById().get(id) ?? null;
    return row && !row.deletedAt ? row : null;
  },
  /** 같은 학년도/학년/반/번호 자리에 이미 있는 학생. */
  findSeat({ schoolYear, grade, classNo, studentNo }) {
    const cls = findClass(classKeyOf({ schoolYear, grade, classNo }));
    if (!cls) return null;

    const row = (cls.students ?? []).find(
      (student) => student.studentNo === studentNo && !student.deletedAt
    );

    return row ? { ...row, schoolYear, grade, classNo, classKey: cls.id } : null;
  },
  /** 새 학생 행에 들어갈 값. 명렬표 일괄 등록에서도 같은 값을 씁니다. */
  fields({ name, gender = null, memo = null }) {
    const now = new Date().toISOString();
    return {
      name,
      gender,
      memo,
      status: "재학",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  },
  /**
   * 여러 명을 한 번에 저장합니다. 같은 반은 문서 한 번으로 묶입니다.
   * 실패하면 예외를 던지므로 부르는 쪽에서 기다렸다가 알려주세요(명렬표 업로드).
   */
  save(changes) {
    return saveStudents(changes);
  },

  /* 아래 셋은 화면에서 곧바로 부르는 길이라
     기다리지 않아도 실패가 묻히지 않도록 여기서 알림까지 처리합니다. */
  create(seat, fields) {
    const id = newId();
    send(saveStudents([{ id, seat, fields }]));
    return id;
  },
  update(id, fields) {
    send(saveStudents([{ id, fields: { ...fields, updatedAt: new Date().toISOString() } }]));
  },
  /** 다른 반으로 옮깁니다(반이 바뀌면 문서 두 개를 씁니다). */
  move(id, seat, fields = {}) {
    send(saveStudents([{ id, seat, fields: { ...fields, updatedAt: new Date().toISOString() } }]));
  },
};

export const sessions = {
  all() {
    return cache.sessions.filter((row) => !row.deletedAt);
  },
  find(id) {
    return sessions.all().find((x) => x.id === id) || null;
  },
  forStudent(studentId) {
    return sessions.all().filter((x) => x.studentId === studentId);
  },
  update(id, fields) {
    patchSession(id, { ...fields, updatedAt: new Date().toISOString() });
  },
  add({
    studentId,
    sessionDate,
    sessionNo,
    category,
    durationMinutes = null,
    content,
    followUpAction = null,
    nextPlan = null,
  }) {
    const now = new Date().toISOString();
    return insertSession({
      studentId,
      sessionDate,
      sessionNo,
      category,
      durationMinutes,
      content,
      followUpAction,
      nextPlan,
      createdAt: now,
      updatedAt: now,
    });
  },
};
