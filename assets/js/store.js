/**
 * Firestore 기반 데이터 계층.
 * 원본 C# 프로젝트의 EF Core + SQLite(AppDbContext)를 대체합니다.
 *
 *   users/{uid}/classes/{학년도-학년-반}   { schoolYear, grade, classNo, students: [...], updatedAt }
 *   users/{uid}/sessions/{id}             { studentId, sessionDate, sessionNo, category, topics,
 *                                           topicOther, meetingType, period, subject,
 *                                           durationMinutes, content, intervention, … }
 *
 * 상담 기록의 필드 이름은 진로상담일지 서식의 칸을 따릅니다.
 *   content      내담자가 진술한 문제와 상황
 *   intervention 상담자 소견 및 개입
 *   topics       상담 주제 (진로·진학·선택교과·학업·기타 중 여러 개)
 *   meetingType  상담 시간대 ("class" 수업 중 · "lunch" 점심시간 · "after" 하교 후)
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
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { describeFirestoreError, firebaseContext } from "./firebase.js";

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
  errorHandler?.(describeFirestoreError(error, fallback), error);
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
          else invalidateSessions();
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
  invalidateSessions();
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
const classKeyOf = ({ schoolYear, grade, classNo }) => `${schoolYear}-${grade}-${classNo}`;

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
let liveSessions = null;

function invalidate() {
  flat = null;
  index = null;
}

function invalidateSessions() {
  liveSessions = null;
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

/** 목록을 일괄 쓰기 한도에 맞게 잘라 줍니다. */
function* chunks(list, size = LIMIT) {
  for (let i = 0; i < list.length; i += size) yield list.slice(i, i + size);
}

/**
 * 일괄 쓰기를 나누어 보냅니다.
 * @param {Array} list 처리할 항목
 * @param {(batch: object, item: any) => void} add 항목 하나를 batch 에 얹는 방법
 */
async function commitInChunks(list, add) {
  for (const chunk of chunks(list)) {
    const batch = writeBatch(firebaseContext().db);
    for (const item of chunk) add(batch, item);
    await batch.commit();
  }
}

/** Firestore 쓰기를 보내고 실패하면 사용자에게 알립니다. */
function send(promise) {
  promise.catch((error) => notifyError(error, "저장하지 못했습니다."));
}

/** 바뀐 반 문서만 통째로 다시 씁니다. 빈 반은 문서를 지웁니다. */
async function commitClasses(keys) {
  const list = [...keys].filter(Boolean);
  if (list.length === 0) return;

  const emptied = [];

  await commitInChunks(list, (batch, key) => {
    const ref = doc(collectionRef("classes"), key);
    const cls = findClass(key);

    if (!cls || cls.students.length === 0) {
      batch.delete(ref);
      emptied.push(key);
      return;
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
  });

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
async function saveStudents(changes) {
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
/**
 * 진로상담일지 서식으로 바꾸기 전에 저장된 기록을 새 모양으로 맞춰 읽습니다.
 * 저장된 문서는 건드리지 않고, 읽을 때만 채워 넣습니다.
 *
 *   후속 조치 + 다음 계획 → 상담자 소견 및 개입(intervention)
 *   상담 분류(category)   → 상담 주제(topics)
 */
function normalizeSession(row) {
  if (row.intervention !== undefined && row.topics !== undefined) return row;

  return {
    ...row,
    intervention:
      row.intervention ??
      [row.followUpAction, row.nextPlan].map((part) => part?.trim()).filter(Boolean).join("\n"),
    topics: row.topics ?? (row.category ? [row.category] : []),
  };
}

function applyLocalSession(row) {
  const rows = cache.sessions;
  const at = rows.findIndex((r) => r.id === row.id);
  if (at >= 0) rows[at] = { ...rows[at], ...row };
  else rows.push(row);
  invalidateSessions();
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
  if (operations.length === 0) return;

  // 화면에 곧바로 보이도록 로컬 캐시를 먼저 갱신합니다.
  for (const operation of operations) {
    applyLocalSession({ id: operation.id, ...operation.fields });
  }
  notifyChange();

  await commitInChunks(operations, (batch, operation) => {
    const ref = doc(collectionRef("sessions"), operation.id);
    if (operation.mode === "update") batch.update(ref, operation.fields);
    else batch.set(ref, operation.fields);
  });
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

  const list = asList(ids);

  for (const id of list) {
    const at = cache.sessions.findIndex((row) => row.id === id);
    if (at >= 0) cache.sessions.splice(at, 1);
  }

  invalidateSessions();
  notifyChange();

  await commitInChunks(list, (batch, id) =>
    batch.delete(doc(collectionRef("sessions"), id))
  );
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
    if (!liveSessions) {
      liveSessions = cache.sessions.filter((row) => !row.deletedAt).map(normalizeSession);
    }
    return liveSessions;
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
  /** 상담 기록의 빈 칸은 undefined 가 아니라 null 로 채웁니다(Firestore 는 undefined 를 받지 않습니다). */
  add(record) {
    const now = new Date().toISOString();

    return insertSession({
      topics: [],
      topicOther: null,
      meetingType: null,
      period: null,
      subject: null,
      durationMinutes: null,
      intervention: null,
      ...clean(record),
      createdAt: now,
      updatedAt: now,
    });
  },
};

/* =========================================================
   이전 형식으로 남은 문서 정리

   예전에는 학생 한 명이 문서 하나(students)였고 소속이 또 다른 문서(schoolYears)였습니다.
   지금은 한 반이 문서 하나(classes)입니다. 새 구조로 옮긴 뒤에도 옛 문서는
   데이터베이스에 그대로 남아 있는데, 앱이 더는 구독하지 않으므로
   읽기 비용은 들지 않지만 콘솔에서 보면 헷갈립니다.

   정리가 끝나면 firestore.rules 에서 옛 컬렉션 허용을 빼도 됩니다.
   ========================================================= */
/** 지금은 쓰지 않는 옛 컬렉션. */
const OLD_COLLECTIONS = ["students", "schoolYears"];

const oldRef = (uid, name) => collection(firebaseContext().db, "users", uid, name);

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
    const snapshot = await getDocs(query(oldRef(uid, name), limit(1)));
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
 * @returns {Promise<number>} 지운 문서 수
 */
export async function purgeLegacyData(uid) {
  const refs = [];

  for (const name of OLD_COLLECTIONS) {
    const snapshot = await getDocs(oldRef(uid, name));
    for (const document of snapshot.docs) refs.push(document.ref);
  }

  await commitInChunks(refs, (batch, ref) => batch.delete(ref));

  return refs.length;
}
