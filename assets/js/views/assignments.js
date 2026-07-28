/** 과제 — 선생님이 내고 학생이 제출합니다. */
import { assignments, profiles, session, submissions } from "../board.js";
import { attachDraft } from "../drafts.js";
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

export const meta = { id: "assignments", icon: "📝", title: "과제", needs: ["submissions"] };

// 펼쳐 둔 과제를 화면을 다시 그려도 기억합니다.
const expanded = new Set();

/* =========================================================
   마감일
   ========================================================= */
function dueBadge(dueDate) {
  if (!dueDate) return "";

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due - start) / 86400000);

  if (Number.isNaN(days)) return "";
  if (days < 0) return `<span class="badge badge--muted">마감 지남</span>`;
  if (days === 0) return `<span class="badge badge--danger">오늘 마감</span>`;
  if (days <= 3) return `<span class="badge badge--warning">D-${days}</span>`;
  return `<span class="badge badge--muted">${esc(dueDate)} 마감</span>`;
}

/* =========================================================
   과제 내기 (선생님)
   ========================================================= */
function assignmentFormBody(assignment) {
  return `
    <div class="field">
      <label class="field__label" for="a-title">제목</label>
      <input class="input" id="a-title" name="title" value="${esc(assignment?.title ?? "")}"
             placeholder="예: 나의 진로 로드맵 작성하기" />
    </div>
    <div class="field">
      <label class="field__label" for="a-body">안내</label>
      <textarea class="textarea" id="a-body" name="body" rows="6"
                placeholder="무엇을 어떻게 제출하면 되는지 적어주세요.">${esc(assignment?.body ?? "")}</textarea>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="field__label" for="a-due">마감일</label>
        <input class="input" id="a-due" name="dueDate" type="date"
               value="${esc(assignment?.dueDate ?? "")}" />
      </div>
      <div class="field">
        <label class="field__label" for="a-targets">공개 대상</label>
        <input class="input" id="a-targets" name="targets"
               value="${esc(formatTargets(assignment?.targets))}"
               placeholder="비워두면 전체 · 예: 1-3, 2" />
      </div>
    </div>
    ${linkField(assignment?.links ?? [], { label: "참고 자료 링크" })}`;
}

function openAssignmentForm(assignment, onSaved) {
  let draft = null;

  const created = openModal({
    title: assignment ? "과제 수정" : "과제 내기",
    body: assignmentFormBody(assignment),
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

      const fields = {
        title,
        body: get("body"),
        dueDate: get("dueDate") || null,
        targets: targets.targets,
        links: links.links,
      };

      try {
        if (assignment) await assignments.update(assignment.id, fields);
        else await assignments.add({ ...fields, authorUid: session.uid() });

        draft?.done();
        toast(assignment ? "과제를 수정했습니다." : "과제를 냈습니다.", "success");
        onSaved();
      } catch (error) {
        showFormError(form, error?.message ?? "저장하지 못했습니다.");
        return false;
      }

      return true;
    },
  });

  // 쓰다 만 내용이 사라지지 않도록 입력할 때마다 이 브라우저에 보관합니다.
  draft = attachDraft(created, `assignment:${assignment?.id ?? "new"}`, [
    "title",
    "body",
    "dueDate",
    "targets",
    "links",
  ]);
}

/* =========================================================
   제출하기 (학생)
   ========================================================= */
function openSubmissionForm(assignment, mine, onSaved) {
  let draft = null;

  const created = openModal({
    title: mine ? "제출물 수정" : "과제 제출",
    subtitle: assignment.title,
    body: `
      <div class="field">
        <label class="field__label" for="s-text">내용</label>
        <textarea class="textarea" id="s-text" name="text" rows="8"
                  placeholder="과제 내용을 적거나, 아래에 파일 링크를 붙여주세요.">${esc(mine?.text ?? "")}</textarea>
      </div>
      ${linkField(mine?.links ?? [], { label: "제출 파일 링크" })}`,
    actions: [
      { label: "취소", variant: "secondary", value: "cancel" },
      { label: mine ? "수정" : "제출", variant: "primary", value: "submit" },
    ],
    onAction: async (action, form) => {
      if (action !== "submit") return;

      clearFormError(form);
      const text = form.elements.text.value.trim();

      const links = parseLinks(form.elements.links.value.trim());
      if (!links.ok) {
        showFormError(form, links.error);
        return false;
      }

      if (!text && links.links.length === 0) {
        showFormError(form, "내용을 적거나 링크를 하나 이상 붙여주세요.");
        return false;
      }

      const profile = profiles.mine();
      const fields = {
        assignmentId: assignment.id,
        text,
        links: links.links,
        // 선생님 화면에서 누가 냈는지 바로 알 수 있도록 이름을 함께 남깁니다.
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
        if (mine) await submissions.update(mine.id, fields);
        else await submissions.add(fields);

        draft?.done();
        toast(mine ? "제출물을 수정했습니다." : "과제를 제출했습니다.", "success");
        onSaved();
      } catch (error) {
        showFormError(form, error?.message ?? "제출하지 못했습니다.");
        return false;
      }

      return true;
    },
  });

  draft = attachDraft(created, `submission:${assignment.id}`, ["text", "links"]);
}

/* =========================================================
   보여주기
   ========================================================= */
function submissionRow(submission) {
  const who = submission.profile
    ? `${submission.profile.grade}학년 ${submission.profile.classNo}반 ${submission.profile.studentNo}번 ${submission.profile.name}`
    : "이름 미등록";

  return `
    <article class="submission">
      <div class="submission__head">
        <strong>${esc(who)}</strong>
        ${renderPostMeta(submission)}
      </div>
      ${renderBody(submission.text)}
      ${renderLinks(submission.links)}
    </article>`;
}

function teacherCard(assignment) {
  const rows = submissions.forAssignment(assignment.id);
  const open = expanded.has(assignment.id);

  return `
    <article class="post">
      <div class="post__head">
        <h2 class="post__title">${esc(assignment.title)}</h2>
        <div class="post__meta">
          ${renderPostMeta(assignment)}
          ${dueBadge(assignment.dueDate)}
          <span class="badge badge--muted">${esc(describeTargets(assignment.targets))}</span>
          <span class="badge ${rows.length ? "badge--success" : "badge--muted"}">제출 ${rows.length}명</span>
        </div>
      </div>
      ${renderBody(assignment.body)}
      ${renderLinks(assignment.links)}
      <div class="post__actions">
        <button class="btn btn--secondary btn--sm" data-toggle="${assignment.id}">
          ${open ? "제출물 접기" : `제출물 보기 (${rows.length})`}
        </button>
        <button class="btn btn--secondary btn--sm" data-edit="${assignment.id}">수정</button>
        <button class="btn btn--danger btn--sm" data-remove="${assignment.id}">삭제</button>
      </div>
      ${
        open
          ? `<div class="submission-list">
               ${
                 rows.length
                   ? rows.map(submissionRow).join("")
                   : `<p class="caption">아직 제출한 학생이 없습니다.</p>`
               }
             </div>`
          : ""
      }
    </article>`;
}

function studentCard(assignment) {
  const mine = submissions.mine(assignment.id);

  return `
    <article class="post">
      <div class="post__head">
        <h2 class="post__title">${esc(assignment.title)}</h2>
        <div class="post__meta">
          ${renderPostMeta(assignment)}
          ${dueBadge(assignment.dueDate)}
          <span class="badge ${mine ? "badge--success" : "badge--warning"}">
            ${mine ? "제출함" : "미제출"}
          </span>
        </div>
      </div>
      ${renderBody(assignment.body)}
      ${renderLinks(assignment.links)}
      ${
        mine
          ? `<div class="submission submission--mine">
               <div class="submission__head">
                 <strong>내 제출물</strong>
                 ${renderPostMeta(mine)}
               </div>
               ${renderBody(mine.text)}
               ${renderLinks(mine.links)}
             </div>`
          : ""
      }
      <div class="post__actions">
        <button class="btn ${mine ? "btn--secondary" : "btn--primary"} btn--sm"
                data-submit="${assignment.id}">
          ${mine ? "제출물 수정" : "과제 제출"}
        </button>
        ${
          mine
            ? `<button class="btn btn--danger btn--sm" data-cancel="${mine.id}">제출 취소</button>`
            : ""
        }
      </div>
    </article>`;
}

export function render(container) {
  const teacherView = session.role() === TEACHER;
  const profile = profiles.mine();
  const rerender = () => render(container);

  const items = teacherView
    ? assignments.all()
    : assignments.all().filter((a) => matchesTargets(a.targets, profile));

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">과제</h1>
        <p class="page-subtitle">
          ${
            teacherView
              ? `과제 ${items.length}건 · 제출물을 학생별로 확인할 수 있습니다.`
              : "제출할 과제와 내가 낸 내용입니다."
          }
        </p>
      </div>
      ${
        teacherView
          ? `<div class="page-head__actions">
               <button class="btn btn--primary" data-add>+ 과제 내기</button>
             </div>`
          : ""
      }
    </div>

    ${
      items.length
        ? `<div class="post-list">
             ${items.map((a) => (teacherView ? teacherCard(a) : studentCard(a))).join("")}
           </div>`
        : `<section class="card">
             ${emptyState({
               icon: "📝",
               title: "과제가 없습니다",
               desc: teacherView
                 ? "‘과제 내기’로 첫 과제를 올려보세요."
                 : "새 과제가 올라오면 여기에 표시됩니다.",
               action: teacherView
                 ? `<button class="btn btn--primary" data-add>+ 과제 내기</button>`
                 : "",
             })}
           </section>`
    }`;

  /* --- 이벤트 --- */
  container.querySelectorAll("[data-add]").forEach((button) =>
    button.addEventListener("click", () => openAssignmentForm(null, rerender))
  );

  container.querySelectorAll("[data-toggle]").forEach((button) =>
    button.addEventListener("click", () => {
      const id = button.dataset.toggle;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      rerender();
    })
  );

  container.querySelectorAll("[data-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      const assignment = assignments.find(button.dataset.edit);
      if (assignment) openAssignmentForm(assignment, rerender);
    })
  );

  container.querySelectorAll("[data-remove]").forEach((button) =>
    button.addEventListener("click", async () => {
      const assignment = assignments.find(button.dataset.remove);
      if (!assignment) return;

      const count = submissions.forAssignment(assignment.id).length;
      const ok = await confirmDialog({
        title: "과제 삭제",
        message:
          `‘${assignment.title}’ 과제를 삭제할까요?` +
          (count ? `\n제출물 ${count}건은 남아 있으니 필요하면 먼저 확인해주세요.` : ""),
        confirmLabel: "삭제",
      });
      if (!ok) return;

      try {
        await assignments.remove(assignment.id);
        toast("과제를 삭제했습니다.");
        rerender();
      } catch {
        // 오류 메시지는 board.js 가 토스트로 알립니다.
      }
    })
  );

  container.querySelectorAll("[data-submit]").forEach((button) =>
    button.addEventListener("click", () => {
      const assignment = assignments.find(button.dataset.submit);
      if (assignment) openSubmissionForm(assignment, submissions.mine(assignment.id), rerender);
    })
  );

  container.querySelectorAll("[data-cancel]").forEach((button) =>
    button.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "제출 취소",
        message: "제출물을 지울까요? 마감 전이라면 다시 제출할 수 있습니다.",
        confirmLabel: "제출 취소",
      });
      if (!ok) return;

      try {
        await submissions.remove(button.dataset.cancel);
        toast("제출을 취소했습니다.");
        rerender();
      } catch {
        // 오류 메시지는 board.js 가 토스트로 알립니다.
      }
    })
  );
}
