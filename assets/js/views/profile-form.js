/**
 * 학생 정보 입력.
 *
 * 학생이 스스로 학년·반·번호와 이름을 적으면 그 값으로 공지·과제를 받아 봅니다.
 * 선생님 화면의 ‘학생 연결’ 목록에서 명렬표와 맞는지 확인할 수 있습니다.
 */
import { profiles, session } from "../board.js";
import { clearFormError, esc, openModal, showFormError } from "../ui.js";

/** 폼 내용. 첫 등록 화면과 수정 모달이 같은 칸을 씁니다. */
export function profileFields(profile, user) {
  const value = (v) => (v == null ? "" : esc(v));

  return `
    <div class="form-grid form-grid--3">
      <div class="field">
        <label class="field__label" for="pf-grade">학년</label>
        <input class="input" id="pf-grade" name="grade" inputmode="numeric"
               value="${value(profile?.grade)}" placeholder="1" />
      </div>
      <div class="field">
        <label class="field__label" for="pf-class">반</label>
        <input class="input" id="pf-class" name="classNo" inputmode="numeric"
               value="${value(profile?.classNo)}" placeholder="3" />
      </div>
      <div class="field">
        <label class="field__label" for="pf-no">번호</label>
        <input class="input" id="pf-no" name="studentNo" inputmode="numeric"
               value="${value(profile?.studentNo)}" placeholder="5" />
      </div>
    </div>
    <div class="field">
      <label class="field__label" for="pf-name">이름</label>
      <input class="input" id="pf-name" name="name"
             value="${value(profile?.name ?? user?.displayName ?? "")}" placeholder="홍길동" />
    </div>`;
}

/**
 * 폼 값을 검사해 저장할 값으로 바꿉니다.
 * @returns {{ ok: true, values: object } | { ok: false, error: string }}
 */
export function readProfileForm(form) {
  const get = (name) => form.elements[name].value.trim();

  const name = get("name");
  if (!name) return { ok: false, error: "이름을 입력해주세요." };

  const numbers = {};
  for (const [field, label, max] of [
    ["grade", "학년", 6],
    ["classNo", "반", 30],
    ["studentNo", "번호", 60],
  ]) {
    const parsed = Number.parseInt(get(field), 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > max) {
      return { ok: false, error: `${label}을(를) 1~${max} 사이 숫자로 입력해주세요.` };
    }
    numbers[field] = parsed;
  }

  return { ok: true, values: { name, ...numbers } };
}

/** 내 정보 수정 모달. */
export function openProfileForm(profile, onSaved) {
  openModal({
    title: "내 정보",
    subtitle: "학년·반이 바뀌면 여기서 고쳐주세요.",
    body: profileFields(profile),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const parsed = readProfileForm(form);
      if (!parsed.ok) {
        showFormError(form, parsed.error);
        return false;
      }

      try {
        await profiles.save(session.uid(), { ...parsed.values, email: profile?.email ?? null });
        onSaved?.();
      } catch (error) {
        showFormError(form, error?.message ?? "저장하지 못했습니다.");
        return false;
      }

      return true;
    },
  });
}
