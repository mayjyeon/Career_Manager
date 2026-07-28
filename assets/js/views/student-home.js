/** 학생 첫 화면 — 내 정보, 새 공지, 낼 과제를 한눈에 봅니다. */
import { assignments, notices, portfolios, profiles, submissions, withdraw } from "../board.js";
import { signOutUser } from "../auth.js";
import { matchesTargets } from "../roles.js";
import { renderPostMeta } from "./post-parts.js";
import { confirmDialog, emptyState, esc, relativeDate, toast } from "../ui.js";
import { openProfileForm } from "./profile-form.js";

/** 졸업 등으로 더 이상 쓰지 않을 때 내 자료를 모두 지웁니다. */
async function confirmWithdraw() {
  const counts = {
    submissions: submissions.all().length,
    portfolios: portfolios.mine().length,
  };

  const ok = await confirmDialog({
    title: "회원 탈퇴",
    message:
      "내 정보와 올린 자료를 모두 지우고 로그아웃합니다.\n" +
      `제출물 ${counts.submissions}건, 포트폴리오 ${counts.portfolios}건이 사라집니다.\n\n` +
      "휴지통을 거치지 않고 바로 지워지며 되돌릴 수 없습니다.\n" +
      "구글 계정 자체는 그대로 남고, 다시 로그인하면 새로 시작합니다.",
    confirmLabel: "탈퇴하기",
  });
  if (!ok) return;

  try {
    await withdraw();
    toast("탈퇴 처리했습니다. 그동안 수고 많으셨습니다.");
    await signOutUser();
  } catch (error) {
    toast(error?.message ?? "탈퇴하지 못했습니다.", "error");
  }
}

export const meta = { id: "home", icon: "🏠", title: "홈" };

/** 마감이 지나지 않았거나 아직 안 낸 과제를 앞에 둡니다. */
function sortAssignments(items) {
  const today = new Date().toISOString().slice(0, 10);

  return items.slice().sort((a, b) => {
    const aOver = a.dueDate && a.dueDate < today;
    const bOver = b.dueDate && b.dueDate < today;
    if (aOver !== bOver) return aOver ? 1 : -1;
    return (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99");
  });
}

export function render(container, { navigate }) {
  const profile = profiles.mine();
  const rerender = () => render(container, { navigate });

  const myNotices = notices.all().filter((n) => matchesTargets(n.targets, profile));
  const myAssignments = sortAssignments(
    assignments.all().filter((a) => matchesTargets(a.targets, profile))
  );

  const todo = myAssignments.filter((a) => !submissions.mine(a.id));
  const seat = profile
    ? `${profile.grade}학년 ${profile.classNo}반 ${profile.studentNo}번`
    : "정보 없음";

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">${esc(profile?.name ?? "학생")}님, 안녕하세요</h1>
        <p class="page-subtitle">${esc(seat)}</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--secondary" data-profile>내 정보 수정</button>
      </div>
    </div>

    <section class="stat-grid">
      <button class="stat stat--button" type="button" data-go="assignments">
        <span class="stat__label">내야 할 과제</span>
        <strong class="stat__value">${todo.length}</strong>
        <span class="stat__sub">전체 ${myAssignments.length}건</span>
      </button>
      <button class="stat stat--button" type="button" data-go="notices">
        <span class="stat__label">공지사항</span>
        <strong class="stat__value">${myNotices.length}</strong>
        <span class="stat__sub">${
          myNotices[0] ? `최근 ${esc(relativeDate(myNotices[0].createdAt))}` : "아직 없음"
        }</span>
      </button>
      <button class="stat stat--button" type="button" data-go="portfolio">
        <span class="stat__label">내 포트폴리오</span>
        <strong class="stat__value">${portfolios.mine().length}</strong>
        <span class="stat__sub">자유롭게 모아두세요</span>
      </button>
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="section-title">내야 할 과제</h2>
        <button class="btn btn--ghost btn--sm" data-go="assignments">전체 보기</button>
      </div>
      ${
        todo.length
          ? `<ul class="simple-list">
               ${todo
                 .slice(0, 5)
                 .map(
                   (a) => `
                     <li>
                       <button type="button" class="simple-list__item" data-go="assignments">
                         <span>${esc(a.title)}</span>
                         <span class="caption">${a.dueDate ? `${esc(a.dueDate)} 마감` : "마감일 없음"}</span>
                       </button>
                     </li>`
                 )
                 .join("")}
             </ul>`
          : emptyState({
              icon: "✅",
              title: "낼 과제가 없습니다",
              desc: "새 과제가 나오면 여기에 표시됩니다.",
            })
      }
    </section>

    <section class="card" style="margin-top:16px">
      <div class="card__head">
        <h2 class="section-title">새 공지</h2>
        <button class="btn btn--ghost btn--sm" data-go="notices">전체 보기</button>
      </div>
      ${
        myNotices.length
          ? `<ul class="simple-list">
               ${myNotices
                 .slice(0, 5)
                 .map(
                   (n) => `
                     <li>
                       <button type="button" class="simple-list__item" data-go="notices">
                         <span>${esc(n.title)}</span>
                         ${renderPostMeta(n)}
                       </button>
                     </li>`
                 )
                 .join("")}
             </ul>`
          : emptyState({ icon: "📢", title: "공지가 없습니다", desc: "" })
      }
    </section>

    <section class="card card--quiet" style="margin-top:16px">
      <div class="card__head">
        <h2 class="section-title">회원 탈퇴</h2>
      </div>
      <p class="caption" style="line-height:1.7">
        졸업 등으로 더 이상 쓰지 않는다면 내 정보와 올린 자료를 모두 지울 수 있습니다.
        구글 계정 자체는 그대로 남습니다.
      </p>
      <div style="margin-top:12px">
        <button class="btn btn--danger btn--sm" data-withdraw>회원 탈퇴</button>
      </div>
    </section>`;

  container.querySelectorAll("[data-go]").forEach((button) =>
    button.addEventListener("click", () => navigate(button.dataset.go))
  );

  container.querySelector("[data-profile]")?.addEventListener("click", () =>
    openProfileForm(profile, () => {
      toast("내 정보를 수정했습니다.", "success");
      rerender();
    })
  );

  container.querySelector("[data-withdraw]")?.addEventListener("click", () => confirmWithdraw());
}
