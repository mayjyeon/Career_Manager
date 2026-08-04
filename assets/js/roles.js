/**
 * 역할 구분.
 *
 * 아래 이메일로 로그인하면 선생님, 그 밖의 계정은 모두 학생으로 봅니다.
 * 같은 값이 firestore.rules 와 storage.rules 에도 들어 있으니
 * 바꿀 때는 세 곳을 함께 고쳐야 합니다.
 */
export const TEACHER_EMAIL = "mayjyeon52@gmail.com";

export const TEACHER = "teacher";
export const STUDENT = "student";

/** 로그인한 사용자의 역할을 돌려줍니다. */
export function roleOf(user) {
  const email = (user?.email ?? "").trim().toLowerCase();
  return email === TEACHER_EMAIL ? TEACHER : STUDENT;
}

/* =========================================================
   공개 대상
   ========================================================= */
/**
 * 공지·과제의 공개 대상입니다.
 * 빈 배열이면 전체 공개, 그 밖에는 [{ grade, classNo }] 목록입니다.
 * classNo 가 없으면 그 학년 전체를 뜻합니다.
 */
export function describeTargets(targets) {
  if (!targets || targets.length === 0) return "전체";

  return targets
    .map((t) => (t.classNo == null ? `${t.grade}학년 전체` : `${t.grade}학년 ${t.classNo}반`))
    .join(", ");
}

/** 학생 정보가 공개 대상에 드는지 봅니다. */
export function matchesTargets(targets, profile) {
  if (!targets || targets.length === 0) return true;
  if (!profile) return false;

  return targets.some(
    (t) => t.grade === profile.grade && (t.classNo == null || t.classNo === profile.classNo)
  );
}

/**
 * "1-3, 2-1, 3" 처럼 적은 대상을 목록으로 바꿉니다.
 * 비워 두면 전체 공개입니다.
 */
export function parseTargets(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: true, targets: [] };

  const targets = [];

  for (const chunk of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const match = /^(\d)(?:\s*-\s*(\d{1,2}))?$/.exec(chunk);
    if (!match) {
      return { ok: false, error: `‘${chunk}’ 를 알아볼 수 없습니다. 1-3 또는 2 처럼 적어주세요.` };
    }

    targets.push({
      grade: Number.parseInt(match[1], 10),
      classNo: match[2] ? Number.parseInt(match[2], 10) : null,
    });
  }

  return { ok: true, targets };
}

/** 목록을 다시 "1-3, 2" 형태의 글자로 바꿉니다(수정 폼에 채울 때). */
export function formatTargets(targets) {
  if (!targets || targets.length === 0) return "";
  return targets.map((t) => (t.classNo == null ? `${t.grade}` : `${t.grade}-${t.classNo}`)).join(", ");
}
