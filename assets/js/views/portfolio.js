/**
 * 포트폴리오 — 학생이 자유롭게 모아 두고, 선생님은 학생별로 열람합니다.
 */
import { portfolios, profiles, session } from "../board.js";
import { attachDraft } from "../drafts.js";
import { parseLinks } from "../links.js";
import { TEACHER } from "../roles.js";
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

export const meta = { id: "portfolio", icon: "🎒", title: "포트폴리오" };

// 선생님 화면에서 펼쳐 둔 학생을 기억합니다.
const expanded = new Set();

/* =========================================================
   쓰기 (학생)
   ========================================================= */
function openEntryForm(entry, onSaved) {
  let draft = null;

  const form = openModal({
    title: entry ? "포트폴리오 수정" : "포트폴리오 추가",
    subtitle: entry ? "" : "활동 기록, 수상, 독서, 진로 탐색 등 무엇이든 남겨보세요.",
    body: `
      <div class="field">
        <label class="field__label" for="f-title">제목</label>
        <input class="input" id="f-title" name="title" value="${esc(entry?.title ?? "")}"
               placeholder="예: 의료 계열 진로 탐색 보고서" />
      </div>
      <div class="field">
        <label class="field__label" for="f-body">내용</label>
        <textarea class="textarea" id="f-body" name="body" rows="8"
                  placeholder="무엇을 했고 무엇을 느꼈는지 적어보세요.">${esc(entry?.body ?? "")}</textarea>
      </div>
      ${linkField(entry?.links ?? [], { label: "자료 링크" })}`,
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: "저장", variant: "primary", value: "submit" },
    ],
    onAction: async (action, formEl) => {
      if (action !== "submit") return;

      clearFormError(formEl);
      const get = (name) => formEl.elements[name].value.trim();

      const title = get("title");
      if (!title) {
        showFormError(formEl, "제목을 입력해주세요.");
        return false;
      }

      const links = parseLinks(get("links"));
      if (!links.ok) {
        showFormError(formEl, links.error);
        return false;
      }

      const profile = profiles.mine();
      const fields = {
        title,
        body: get("body"),
        links: links.links,
        profile: profile
          ? {
              name: profile.name,
              grade: profile.grade,
              classNo: profile.classNo,
              studentNo: profile.studentNo,
            }
          : null,
      };

      try {
        if (entry) await portfolios.update(entry.id, fields);
        else await portfolios.add(fields);

        draft?.done();
        toast(entry ? "포트폴리오를 수정했습니다." : "포트폴리오를 추가했습니다.", "success");
        onSaved();
      } catch (error) {
        showFormError(formEl, error?.message ?? "저장하지 못했습니다.");
        return false;
      }

      return true;
    },
  });

  // 쓰다 만 내용이 사라지지 않도록 입력할 때마다 이 브라우저에 보관합니다.
  draft = attachDraft(form, `portfolio:${entry?.id ?? "new"}`, ["title", "body", "links"]);
}

/* =========================================================
   보여주기
   ========================================================= */
function entryCard(entry, canEdit) {
  return `
    <article class="post">
      <div class="post__head">
        <h2 class="post__title">${esc(entry.title)}</h2>
        <div class="post__meta">${renderPostMeta(entry)}</div>
      </div>
      ${renderBody(entry.body)}
      ${renderLinks(entry.links)}
      ${
        canEdit
          ? `<div class="post__actions">
               <button class="btn btn--secondary btn--sm" data-edit="${entry.id}">수정</button>
               <button class="btn btn--danger btn--sm" data-remove="${entry.id}">삭제</button>
             </div>`
          : ""
      }
    </article>`;
}

/** 선생님 화면 — 학생별로 접었다 폈다 합니다. */
function renderForTeacher(container) {
  const groups = new Map();

  for (const entry of portfolios.all()) {
    const list = groups.get(entry.studentUid) ?? [];
    list.push(entry);
    groups.set(entry.studentUid, list);
  }

  const describe = (uid, entries) => {
    const profile = profiles.find(uid) ?? entries.find((e) => e.profile)?.profile;
    if (!profile) return "이름 미등록 학생";
    return `${profile.grade}학년 ${profile.classNo}반 ${profile.studentNo}번 ${profile.name}`;
  };

  const sections = [...groups.entries()]
    .sort((a, b) => describe(a[0], a[1]).localeCompare(describe(b[0], b[1]), "ko"))
    .map(([uid, entries]) => {
      const open = expanded.has(uid);
      return `
        <section class="card card--flush">
          <button class="student-toggle" type="button" data-student="${esc(uid)}">
            <span>${esc(describe(uid, entries))}</span>
            <span class="badge badge--muted">${entries.length}건</span>
            <span class="student-toggle__arrow" aria-hidden="true">${open ? "▲" : "▼"}</span>
          </button>
          ${
            open
              ? `<div class="post-list post-list--nested">
                   ${entries.map((entry) => entryCard(entry, false)).join("")}
                 </div>`
              : ""
          }
        </section>`;
    })
    .join("");

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">포트폴리오</h1>
        <p class="page-subtitle">학생 ${groups.size}명이 올린 자료입니다.</p>
      </div>
    </div>
    ${
      groups.size
        ? `<div class="stack">${sections}</div>`
        : `<section class="card">
             ${emptyState({
               icon: "🎒",
               title: "올라온 포트폴리오가 없습니다",
               desc: "학생이 자기 화면에서 올리면 여기에 학생별로 모입니다.",
             })}
           </section>`
    }`;

  container.querySelectorAll("[data-student]").forEach((button) =>
    button.addEventListener("click", () => {
      const uid = button.dataset.student;
      if (expanded.has(uid)) expanded.delete(uid);
      else expanded.add(uid);
      renderForTeacher(container);
    })
  );
}

/** 학생 화면 — 내 포트폴리오만 보고 고칩니다. */
function renderForStudent(container) {
  const entries = portfolios.mine();
  const rerender = () => renderForStudent(container);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">포트폴리오</h1>
        <p class="page-subtitle">진로 활동을 모아 두는 나만의 공간입니다. 선생님도 볼 수 있습니다.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--primary" data-add>+ 추가</button>
      </div>
    </div>
    ${
      entries.length
        ? `<div class="post-list">${entries.map((e) => entryCard(e, true)).join("")}</div>`
        : `<section class="card">
             ${emptyState({
               icon: "🎒",
               title: "아직 올린 자료가 없습니다",
               desc: "동아리·봉사·독서·진로 체험처럼 남기고 싶은 활동을 적어보세요.",
               action: `<button class="btn btn--primary" data-add>+ 추가</button>`,
             })}
           </section>`
    }`;

  container.querySelectorAll("[data-add]").forEach((button) =>
    button.addEventListener("click", () => openEntryForm(null, rerender))
  );

  container.querySelectorAll("[data-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      const entry = portfolios.find(button.dataset.edit);
      if (entry) openEntryForm(entry, rerender);
    })
  );

  container.querySelectorAll("[data-remove]").forEach((button) =>
    button.addEventListener("click", async () => {
      const entry = portfolios.find(button.dataset.remove);
      if (!entry) return;

      const ok = await confirmDialog({
        title: "포트폴리오 삭제",
        message: `‘${entry.title}’ 을 삭제할까요?`,
        confirmLabel: "삭제",
      });
      if (!ok) return;

      try {
        await portfolios.remove(entry.id);
        toast("삭제했습니다.");
        rerender();
      } catch {
        // 오류 메시지는 board.js 가 토스트로 알립니다.
      }
    })
  );
}

export function render(container) {
  if (session.role() === TEACHER) renderForTeacher(container);
  else renderForStudent(container);
}
