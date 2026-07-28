/** 공지사항 — 선생님이 올리고 학생이 봅니다. */
import { notices, profiles, session } from "../board.js";
import { parseLinks } from "../links.js";
import { TEACHER, describeTargets, formatTargets, matchesTargets, parseTargets } from "../roles.js";
import { linkField, renderBody, renderLinks, renderPostMeta } from "./post-parts.js";
import {
  clearFormError,
  confirmDialog,
  emptyState,
  esc,
  openModal,
  showFormError,
  toast,
} from "../ui.js";

export const meta = { id: "notices", icon: "📢", title: "공지사항" };

/* =========================================================
   글쓰기 · 고치기
   ========================================================= */
function noticeFormBody(notice) {
  return `
    <div class="field">
      <label class="field__label" for="n-title">제목</label>
      <input class="input" id="n-title" name="title" value="${esc(notice?.title ?? "")}"
             placeholder="예: 2학기 진로체험 신청 안내" />
    </div>
    <div class="field">
      <label class="field__label" for="n-body">내용</label>
      <textarea class="textarea" id="n-body" name="body" rows="8"
                placeholder="공지 내용을 적어주세요. 주소를 적으면 링크로 바뀝니다.">${esc(notice?.body ?? "")}</textarea>
    </div>
    <div class="field">
      <label class="field__label" for="n-targets">공개 대상</label>
      <input class="input" id="n-targets" name="targets"
             value="${esc(formatTargets(notice?.targets))}"
             placeholder="비워두면 전체 공개 · 예: 1-3, 2-1, 3" />
      <p class="caption">학년만 적으면 그 학년 전체입니다. ‘1-3’ 은 1학년 3반입니다.</p>
    </div>
    ${linkField(notice?.links ?? [])}`;
}

function openNoticeForm(notice, onSaved) {
  openModal({
    title: notice ? "공지 수정" : "공지 작성",
    subtitle: notice ? "" : "학생 화면에도 그대로 보입니다.",
    body: noticeFormBody(notice),
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const get = (name) => form.elements[name].value.trim();

      const title = get("title");
      if (!title) {
        showFormError(form, "제목을 입력해주세요.");
        return false;
      }

      const targets = parseTargets(get("targets"));
      if (!targets.ok) {
        showFormError(form, targets.error);
        return false;
      }

      const links = parseLinks(get("links"));
      if (!links.ok) {
        showFormError(form, links.error);
        return false;
      }

      const fields = { title, body: get("body"), targets: targets.targets, links: links.links };

      try {
        if (notice) await notices.update(notice.id, fields);
        else await notices.add({ ...fields, authorUid: session.uid() });

        toast(notice ? "공지를 수정했습니다." : "공지를 올렸습니다.", "success");
        onSaved();
      } catch (error) {
        showFormError(form, error?.message ?? "저장하지 못했습니다.");
        return false;
      }

      return true;
    },
  });
}

/* =========================================================
   목록
   ========================================================= */
function noticeCard(notice, canEdit) {
  return `
    <article class="post">
      <div class="post__head">
        <h2 class="post__title">${esc(notice.title)}</h2>
        <div class="post__meta">
          ${renderPostMeta(notice)}
          <span class="badge badge--muted">${esc(describeTargets(notice.targets))}</span>
        </div>
      </div>
      ${renderBody(notice.body)}
      ${renderLinks(notice.links)}
      ${
        canEdit
          ? `<div class="post__actions">
               <button class="btn btn--secondary btn--sm" data-edit="${notice.id}">수정</button>
               <button class="btn btn--danger btn--sm" data-remove="${notice.id}">삭제</button>
             </div>`
          : ""
      }
    </article>`;
}

export function render(container) {
  const teacherView = session.role() === TEACHER;
  const profile = profiles.mine();
  const rerender = () => render(container);

  // 학생에게는 자기 학년·반이 대상인 공지만 보여줍니다.
  const items = teacherView
    ? notices.all()
    : notices.all().filter((notice) => matchesTargets(notice.targets, profile));

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">공지사항</h1>
        <p class="page-subtitle">
          ${teacherView ? "진로 수업 공지와 자료를 올립니다." : "선생님이 올린 공지와 자료입니다."}
        </p>
      </div>
      ${
        teacherView
          ? `<div class="page-head__actions">
               <button class="btn btn--primary" data-add>+ 공지 작성</button>
             </div>`
          : ""
      }
    </div>

    ${
      items.length
        ? `<div class="post-list">${items.map((n) => noticeCard(n, teacherView)).join("")}</div>`
        : `<section class="card">
             ${emptyState({
               icon: "📢",
               title: "공지가 없습니다",
               desc: teacherView
                 ? "‘공지 작성’으로 첫 공지를 올려보세요."
                 : "새 공지가 올라오면 여기에 표시됩니다.",
               action: teacherView
                 ? `<button class="btn btn--primary" data-add>+ 공지 작성</button>`
                 : "",
             })}
           </section>`
    }`;

  container.querySelectorAll("[data-add]").forEach((button) =>
    button.addEventListener("click", () => openNoticeForm(null, rerender))
  );

  container.querySelectorAll("[data-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      const notice = notices.find(button.dataset.edit);
      if (notice) openNoticeForm(notice, rerender);
    })
  );

  container.querySelectorAll("[data-remove]").forEach((button) =>
    button.addEventListener("click", async () => {
      const notice = notices.find(button.dataset.remove);
      if (!notice) return;

      const ok = await confirmDialog({
        title: "공지 삭제",
        message: `‘${notice.title}’ 공지를 삭제할까요?`,
        confirmLabel: "삭제",
      });
      if (!ok) return;

      try {
        await notices.remove(notice.id);
        toast("공지를 삭제했습니다.");
        rerender();
      } catch {
        // 오류 메시지는 board.js 가 토스트로 알립니다.
      }
    })
  );
}
