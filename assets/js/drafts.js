/**
 * 임시 저장.
 *
 * 글을 쓰다가 창을 닫거나 실수로 새로고침해도 내용이 남도록
 * 입력 중인 값을 이 브라우저에 잠시 보관합니다.
 * 저장을 마치면 지웁니다.
 *
 * 서버로 보내지 않고 이 컴퓨터에만 두므로, 다른 기기에서는 보이지 않습니다.
 */
const PREFIX = "career-manager.draft.";

/** 너무 오래된 임시 저장은 되살리지 않습니다. */
const MAX_AGE_DAYS = 14;

const keyOf = (name) => `${PREFIX}${name}`;

/** 저장해 둔 값을 꺼냅니다. 없거나 오래됐으면 null. */
export function loadDraft(name) {
  try {
    const saved = JSON.parse(localStorage.getItem(keyOf(name)) ?? "null");
    if (!saved?.savedAt) return null;

    const age = Date.now() - new Date(saved.savedAt).getTime();
    if (age > MAX_AGE_DAYS * 86400000) {
      clearDraft(name);
      return null;
    }

    return saved;
  } catch {
    return null;
  }
}

export function clearDraft(name) {
  try {
    localStorage.removeItem(keyOf(name));
  } catch {
    /* 무시 */
  }
}

function saveDraft(name, values) {
  try {
    localStorage.setItem(keyOf(name), JSON.stringify({ values, savedAt: new Date().toISOString() }));
  } catch {
    /* 저장 공간이 없으면 임시 저장만 포기합니다. */
  }
}

/** 폼에서 값을 읽습니다. */
function readValues(form, fields) {
  const values = {};
  for (const field of fields) {
    const element = form.elements[field];
    if (element) values[field] = element.value;
  }
  return values;
}

/** 입력한 게 하나라도 있는지. */
const hasContent = (values) => Object.values(values ?? {}).some((v) => (v ?? "").trim());

/**
 * 폼에 임시 저장을 붙입니다.
 *
 * 입력할 때마다 값을 보관하고, 이전에 쓰다 만 내용이 있으면 알려 줍니다.
 * 저장에 성공하면 done() 을 불러 지워주세요.
 *
 * @param {HTMLFormElement} form
 * @param {string} name    글마다 다른 이름 (예: "portfolio:new")
 * @param {string[]} fields 보관할 입력 칸 이름
 * @returns {{ done: () => void }}
 */
export function attachDraft(form, name, fields) {
  const draft = loadDraft(name);
  const body = form.querySelector(".modal__body");

  // 쓰다 만 내용이 있으면 알려주고, 원할 때만 되살립니다.
  if (draft && hasContent(draft.values)) {
    const notice = document.createElement("div");
    notice.className = "draft-notice";
    notice.innerHTML = `
      <span>쓰다 만 내용이 있습니다.</span>
      <button type="button" class="btn btn--secondary btn--sm" data-draft-restore>불러오기</button>
      <button type="button" class="btn btn--ghost btn--sm" data-draft-discard>지우기</button>`;

    body?.prepend(notice);

    notice.querySelector("[data-draft-restore]").addEventListener("click", () => {
      for (const [field, value] of Object.entries(draft.values)) {
        const element = form.elements[field];
        if (element) element.value = value;
      }
      notice.remove();
    });

    notice.querySelector("[data-draft-discard]").addEventListener("click", () => {
      clearDraft(name);
      notice.remove();
    });
  }

  // 글자를 칠 때마다 저장하면 부담이 되므로 잠깐 쉬었다 저장합니다.
  let timer = null;
  const onInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const values = readValues(form, fields);
      if (hasContent(values)) saveDraft(name, values);
      else clearDraft(name);
    }, 500);
  };

  form.addEventListener("input", onInput);

  return {
    done() {
      clearTimeout(timer);
      form.removeEventListener("input", onInput);
      clearDraft(name);
    },
  };
}
