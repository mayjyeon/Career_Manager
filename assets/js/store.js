/**
 * Firestore 기반 데이터 계층.
 * 원본 C# 프로젝트의 EF Core + SQLite(AppDbContext)를 대체합니다.
 *
 *   users/{uid}/classes/{학년도-학년-반}   { schoolYear, grade, classNo, students: [...], updatedAt }
 *   users/{uid}/sessions/{id}             { studentId, sessionDate, sessionNo, category, topics,
 *                                           topicOther, meetingType, period, subject,
 *                                           durationMinutes, content, intervention, … }
 *   users/{uid}/portfolios/{학년도-학년-반} { schoolYear, grade, classNo, entries: [...], updatedAt }
 *
 * 포트폴리오는 두 갈래입니다. 학생이 스스로 올린 것은 board.js 가 맡는 공용 컬렉션에 있고,
 * 선생님이 엑셀로 올리거나 직접 적어 넣은 것은 여기(users/{uid}/portfolios)에 있어
 * 선생님만 볼 수 있습니다.
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

/** 로그인하자마자 붙이는 컬렉션. 어느 화면에서든 필요합니다. */
const CORE_COLLECTIONS = ["classes", "sessions"];

/**
 * 그 화면을 열 때 붙이는 컬렉션.
 * 포트폴리오는 포트폴리오 탭에서만 쓰므로 미리 읽어 오지 않습니다.
 */
const LAZY_COLLECTIONS = ["portfolios"];

const emptyCache = () => ({ classes: [], sessions: [], portfolios: [] });

let cache = emptyCache();
let currentUid = null;
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

/** 이름 → { unsubscribe, ready, done } */
const active = new Map();

/** 메모리에 만들어 둔 색인을 버립니다(새 스냅샷이 도착했을 때). */
function invalidateCache(name) {
  if (name === "sessions") invalidateSessions();
  else grouped[name]?.invalidate();
}

/** 컬렉션 하나를 구독합니다. 이미 붙어 있으면 통신하지 않습니다. */
function subscribe(name) {
  if (active.has(name)) return active.get(name).ready;

  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const entry = { unsubscribe: null, ready, done: false };
  active.set(name, entry);

  entry.unsubscribe = onSnapshot(
    collectionRef(name),
    (snapshot) => {
      cache[name] = snapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      }));
      invalidateCache(name);

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
      notifyError(error, "데이터를 불러오는 중 문제가 발생했습니다.");
    }
  );

  return ready;
}

/**
 * 로그인한 사용자의 데이터를 실시간으로 구독합니다.
 * @param {string} uid
 * @param {{ onChange?: () => void, onError?: (message: string, error: unknown) => void }} handlers
 * @returns {Promise<void>} 기본 컬렉션의 첫 데이터가 모두 도착하면 완료됩니다.
 */
export function startSync(uid, { onChange, onError } = {}) {
  stopSync();

  currentUid = uid;
  changeHandler = onChange ?? null;
  errorHandler = onError ?? null;

  return Promise.all(CORE_COLLECTIONS.map(subscribe)).then(() => undefined);
}

/** 이 컬렉션의 첫 배달이 끝났는지. */
export function isSynced(names) {
  return names.every((name) => active.get(name)?.done === true);
}

/**
 * 화면이 필요로 하는 컬렉션을 그때 붙입니다.
 * @param {string[]} names
 * @returns {Promise<void>}
 */
export function ensureSynced(names) {
  if (!currentUid || names.length === 0) return Promise.resolve();
  return Promise.all(names.map(subscribe)).then(() => undefined);
}

/** 구독을 해제하고 메모리에 있는 데이터를 비웁니다(로그아웃 시). */
export function stopSync() {
  active.forEach((entry) => entry.unsubscribe?.());
  active.clear();
  cache = emptyCache();
  for (const name of [...CORE_COLLECTIONS, ...LAZY_COLLECTIONS]) invalidateCache(name);
  currentUid = null;
  changeHandler = null;
  errorHandler = null;
}

/** 저장하기 전에 문서 번호를 미리 받아 둡니다. 통신하지 않습니다. */
export function newId() {
  return doc(collectionRef("classes")).id;
}

/* =========================================================
   반 문서 ↔ 행

   화면은 학생과 포트폴리오를 평평한 목록으로 다룹니다.
   반 문서 안에 들어 있다는 사실은 이 파일 밖으로 나가지 않습니다.
   ========================================================= */
/** 반 문서를 가리키는 이름. 문서 번호를 그대로 씁니다. */
const classKeyOf = ({ schoolYear, grade, classNo }) => `${schoolYear}-${grade}-${classNo}`;

/** 행에는 없고 반 문서에만 있는 값. */
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

let liveSessions = null;

function invalidateSessions() {
  liveSessions = null;
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

/**
 * ‘한 반이 문서 하나’ 인 컬렉션을 다룹니다.
 *
 * 학생 명부(classes)와 선생님이 등록한 포트폴리오(portfolios)는 문서 안의
 * 목록 이름과 정렬만 다르고 나머지가 같아 여기서 한 벌만 만들어 씁니다.
 *
 * @param {string} name    컬렉션 이름
 * @param {string} listKey 문서 안에서 목록이 들어 있는 칸 이름
 * @param {(a: object, b: object) => number} sort 문서에 담기 전 목록을 정렬하는 방법
 */
function groupedCollection(name, listKey, sort) {
  let flat = null;
  let index = null;

  const invalidate = () => {
    flat = null;
    index = null;
  };

  const docs = () => cache[name];
  const findDoc = (key) => docs().find((group) => group.id === key) ?? null;

  /** 모든 반 문서를 펼쳐 한 줄이 한 항목인 목록으로 만듭니다. */
  function rows() {
    if (flat) return flat;

    flat = [];
    for (const group of docs()) {
      for (const row of group[listKey] ?? []) {
        flat.push({
          ...row,
          schoolYear: group.schoolYear,
          grade: group.grade,
          classNo: group.classNo,
          classKey: group.id,
        });
      }
    }
    return flat;
  }

  function byId() {
    if (!index) index = new Map(rows().map((row) => [row.id, row]));
    return index;
  }

  function ensureDoc({ schoolYear, grade, classNo }) {
    const key = classKeyOf({ schoolYear, grade, classNo });
    let group = findDoc(key);

    if (!group) {
      group = { id: key, schoolYear, grade, classNo, [listKey]: [] };
      docs().push(group);
    }
    if (!group[listKey]) group[listKey] = [];

    return group;
  }

  /**
   * 행을 반 문서에서 뺍니다.
   * @returns {string|null} 내용이 바뀐 반 문서 이름
   */
  function removeRow(id) {
    for (const group of docs()) {
      const at = (group[listKey] ?? []).findIndex((row) => row.id === id);
      if (at >= 0) {
        group[listKey].splice(at, 1);
        return group.id;
      }
    }
    return null;
  }

  /** 행을 반 문서에 넣습니다. 이미 있으면 그 자리를 덮어씁니다. */
  function putRow(seat, row) {
    const group = ensureDoc(seat);
    const at = group[listKey].findIndex((item) => item.id === row.id);

    if (at >= 0) group[listKey][at] = row;
    else group[listKey].push(row);

    return group.id;
  }

  /** 바뀐 반 문서만 통째로 다시 씁니다. 빈 반은 문서를 지웁니다. */
  async function commit(keys) {
    const list = [...keys].filter(Boolean);
    if (list.length === 0) return;

    const emptied = [];

    await commitInChunks(list, (batch, key) => {
      const ref = doc(collectionRef(name), key);
      const group = findDoc(key);

      if (!group || group[listKey].length === 0) {
        batch.delete(ref);
        emptied.push(key);
        return;
      }

      // 정렬해 두면 사람이 콘솔에서 열어 봐도 읽을 만합니다.
      group[listKey].sort(sort);

      batch.set(ref, {
        schoolYear: group.schoolYear,
        grade: group.grade,
        classNo: group.classNo,
        [listKey]: group[listKey],
        updatedAt: new Date().toISOString(),
      });
    });

    if (emptied.length) {
      cache[name] = docs().filter((group) => !emptied.includes(group.id));
      invalidate();
    }
  }

  /**
   * 항목을 추가·수정·이동·삭제합니다.
   *
   * 같은 반 항목을 여러 개 바꿔도 그 반 문서는 한 번만 씁니다.
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
  async function save(changes) {
    const dirty = new Set();

    // 색인은 한 번만 만들고 바뀐 만큼 따라 고칩니다.
    // 900건을 한 번에 넣을 때 반복마다 다시 만들면 너무 느립니다.
    const known = new Map(byId());

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
    await commit(dirty);
  }

  return { rows, byId, findDoc, save, invalidate };
}

const byStudentNo = (a, b) => (a.studentNo ?? 0) - (b.studentNo ?? 0);

/** 반 단위로 묶인 컬렉션. 휴지통 함수들이 이름으로 찾아 씁니다. */
const grouped = {
  classes: groupedCollection("classes", "students", byStudentNo),
  portfolios: groupedCollection(
    "portfolios",
    "entries",
    (a, b) => byStudentNo(a, b) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
  ),
};

/** 휴지통 함수들이 쓰는 이름 → 컬렉션. 학생은 반 문서(classes) 안에 있습니다. */
const GROUPED_BY_TRASH_NAME = {
  students: grouped.classes,
  portfolios: grouped.portfolios,
};

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
  const collection = GROUPED_BY_TRASH_NAME[name];

  if (collection) {
    return collection.save(asList(ids).map((id) => ({ id, fields: { deletedAt } })));
  }

  return commitSessions(
    asList(ids).map((id) => ({ id, mode: "update", fields: { deletedAt } }))
  );
}

/** 휴지통에서 되살립니다. */
export function restore(name, ids) {
  const collection = GROUPED_BY_TRASH_NAME[name];

  if (collection) {
    return collection.save(asList(ids).map((id) => ({ id, fields: { deletedAt: null } })));
  }

  return commitSessions(
    asList(ids).map((id) => ({ id, mode: "update", fields: { deletedAt: null } }))
  );
}

/** 완전히 지웁니다. 되돌릴 수 없습니다. */
export async function purge(name, ids) {
  const collection = GROUPED_BY_TRASH_NAME[name];

  if (collection) {
    await collection.save(asList(ids).map((id) => ({ id, drop: true })));
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
  students: () => grouped.classes.rows().filter((row) => row.deletedAt),
  sessions: () => cache.sessions.filter((row) => row.deletedAt),
  portfolios: () => grouped.portfolios.rows().filter((row) => row.deletedAt),
};

/* =========================================================
   컬렉션
   ========================================================= */
export const students = {
  /** 휴지통에 없는 학생. 좌석(학년도·학년·반·번호)이 함께 붙어 있습니다. */
  all() {
    return grouped.classes.rows().filter((row) => !row.deletedAt);
  },
  find(id) {
    const row = grouped.classes.byId().get(id) ?? null;
    return row && !row.deletedAt ? row : null;
  },
  /** 같은 학년도/학년/반/번호 자리에 이미 있는 학생. */
  findSeat({ schoolYear, grade, classNo, studentNo }) {
    const cls = grouped.classes.findDoc(classKeyOf({ schoolYear, grade, classNo }));
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
    return grouped.classes.save(changes);
  },

  /* 아래 셋은 화면에서 곧바로 부르는 길이라
     기다리지 않아도 실패가 묻히지 않도록 여기서 알림까지 처리합니다. */
  create(seat, fields) {
    const id = newId();
    send(grouped.classes.save([{ id, seat, fields }]));
    return id;
  },
  update(id, fields) {
    send(
      grouped.classes.save([{ id, fields: { ...fields, updatedAt: new Date().toISOString() } }])
    );
  },
  /** 다른 반으로 옮깁니다(반이 바뀌면 문서 두 개를 씁니다). */
  move(id, seat, fields = {}) {
    send(
      grouped.classes.save([
        { id, seat, fields: { ...fields, updatedAt: new Date().toISOString() } },
      ])
    );
  },
};

/**
 * 선생님이 등록한 포트폴리오.
 *
 * 학생이 스스로 올린 포트폴리오(board.js)와 달리 선생님 계정 안에만 있어
 * 학생에게는 보이지 않습니다. 학생 명부와 같은 반 문서 구조라
 * 한 반 30명 분량을 문서 하나로 씁니다.
 */
export const teacherPortfolios = {
  /** 휴지통에 없는 항목. 자리(학년도·학년·반·번호)가 함께 붙어 있습니다. */
  all() {
    return grouped.portfolios.rows().filter((row) => !row.deletedAt);
  },
  find(id) {
    const row = grouped.portfolios.byId().get(id) ?? null;
    return row && !row.deletedAt ? row : null;
  },
  forStudent(studentId) {
    return teacherPortfolios.all().filter((row) => row.studentId === studentId);
  },
  /** 휴지통에 있는 것까지 포함한 그 학생의 항목 번호(학생을 완전히 지울 때 씁니다). */
  allIdsForStudent(studentId) {
    return grouped.portfolios
      .rows()
      .filter((row) => row.studentId === studentId)
      .map((row) => row.id);
  },
  /** 새 항목에 들어갈 값. */
  fields({ studentId, studentName, title, body, source = null }) {
    const now = new Date().toISOString();
    return {
      studentId,
      studentName,
      title,
      body,
      // 어디서 온 자료인지(예: "엑셀 업로드") 나중에 알아볼 수 있게 남깁니다.
      source,
      createdAt: now,
      updatedAt: now,
    };
  },
  /**
   * 여러 건을 한 번에 저장합니다. 같은 반은 문서 한 번으로 묶입니다.
   * 실패하면 예외를 던지므로 부르는 쪽에서 기다렸다가 알려주세요(엑셀 업로드).
   */
  save(changes) {
    return grouped.portfolios.save(changes);
  },
  update(id, fields) {
    send(
      grouped.portfolios.save([
        { id, fields: { ...fields, updatedAt: new Date().toISOString() } },
      ])
    );
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
  /**
   * 휴지통에 있는 것까지 포함한 그 학생의 상담 기록 번호.
   *
   * 학생을 완전히 지울 때 씁니다. 학생과 함께 지운 기록(deletedWith)뿐 아니라
   * 그 전에 따로 지워 둔 기록까지 챙겨야 주인 없는 기록이 남지 않습니다.
   */
  allIdsForStudent(studentId) {
    return cache.sessions.filter((row) => row.studentId === studentId).map((row) => row.id);
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
