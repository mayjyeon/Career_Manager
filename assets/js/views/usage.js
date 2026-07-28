/**
 * 사용량 — Firestore 를 얼마나 읽고 썼는지 봅니다(선생님 전용).
 * Google Cloud Monitoring 에서 값을 가져옵니다.
 */
import { chartTable, lineChart } from "../chart.js";
import { MonitoringError, fetchUsage, forgetToken, hasToken, requestAccess } from "../monitoring.js";
import { emptyState, esc, toast } from "../ui.js";

export const meta = { id: "usage", icon: "📈", title: "사용량" };

const RANGES = [
  { days: 1, label: "최근 24시간" },
  { days: 7, label: "최근 7일" },
  { days: 30, label: "최근 30일" },
];

// 화면을 다시 그려도 고른 기간과 받아온 값을 기억합니다.
const state = { days: 7, data: null, error: null, loading: false };

function connectPrompt() {
  return `
    <section class="card">
      ${emptyState({
        icon: "📈",
        title: "사용량을 보려면 권한이 한 번 필요합니다",
        desc:
          "구글 계정에 ‘모니터링 읽기’ 권한을 허용하면 Firestore 사용량을 가져옵니다. " +
          "로그인할 때 받는 권한과는 별개라서 따로 여쭙습니다.",
        action: `<button class="btn btn--primary" data-connect>사용량 조회 권한 연결</button>`,
      })}
      <p class="caption" style="text-align:center;margin-top:-8px">
        Google Cloud 프로젝트의 ‘모니터링 뷰어’ 권한이 있는 계정만 볼 수 있습니다.
        허용해도 이 브라우저 탭에서만 쓰이고 한 시간쯤 뒤 만료됩니다.
      </p>
    </section>`;
}

export function render(container) {
  const rerender = () => render(container);

  const load = async () => {
    state.loading = true;
    state.error = null;
    rerender();

    try {
      state.data = await fetchUsage({ days: state.days });
    } catch (error) {
      state.data = null;
      state.error = error instanceof MonitoringError ? error.message : "사용량을 읽지 못했습니다.";
    } finally {
      state.loading = false;
      rerender();
    }
  };

  const connected = hasToken();

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">사용량</h1>
        <p class="page-subtitle">Firestore 문서를 얼마나 읽고 쓰는지 봅니다.</p>
      </div>
      ${
        connected
          ? `<div class="page-head__actions">
               <select class="select" id="usage-range">
                 ${RANGES.map(
                   (r) =>
                     `<option value="${r.days}" ${r.days === state.days ? "selected" : ""}>${r.label}</option>`
                 ).join("")}
               </select>
               <button class="btn btn--secondary" data-reload ${state.loading ? "disabled" : ""}>
                 ${state.loading ? "불러오는 중…" : "새로고침"}
               </button>
               <button class="btn btn--ghost" data-disconnect>권한 해제</button>
             </div>`
          : ""
      }
    </div>

    ${
      !connected
        ? connectPrompt()
        : state.error
          ? `<section class="card">
               ${emptyState({
                 icon: "⚠️",
                 title: "사용량을 읽지 못했습니다",
                 desc: state.error,
                 action: `<button class="btn btn--primary" data-reload>다시 시도</button>`,
               })}
             </section>`
          : !state.data
            ? `<section class="card">
                 ${emptyState({
                   icon: "📈",
                   title: state.loading ? "불러오는 중…" : "아직 불러오지 않았습니다",
                   desc: state.loading ? "" : "‘새로고침’ 을 눌러 값을 가져옵니다.",
                   action: state.loading
                     ? ""
                     : `<button class="btn btn--primary" data-reload>불러오기</button>`,
                 })}
               </section>`
            : `<section class="card">
                 <div class="card__head">
                   <h2 class="section-title">문서 읽기 · 쓰기 · 삭제</h2>
                   <span class="caption">${esc(
                     RANGES.find((r) => r.days === state.days)?.label ?? ""
                   )}</span>
                 </div>
                 ${lineChart({
                   series: state.data.series,
                   labels: state.data.labels,
                   unit: "회",
                   title: "Firestore 사용량 추이",
                 })}
                 ${chartTable({
                   columns: ["시각", ...state.data.series.map((s) => s.name)],
                   rows: state.data.labels.map((label, index) => [
                     label,
                     ...state.data.series.map((s) => `${s.values[index] ?? 0}회`),
                   ]),
                 })}
                 <p class="caption" style="margin-top:12px">
                   Cloud Monitoring 의 값이라 실제 사용량과 몇 분 차이가 날 수 있습니다.
                   무료 한도는 하루 읽기 5만 회, 쓰기·삭제 각 2만 회입니다.
                 </p>
               </section>`
    }`;

  container.querySelector("[data-connect]")?.addEventListener("click", async () => {
    try {
      await requestAccess();
      await load();
    } catch (error) {
      toast(error?.message ?? "권한을 받지 못했습니다.", "error");
    }
  });

  container.querySelectorAll("[data-reload]").forEach((button) =>
    button.addEventListener("click", () => load())
  );

  container.querySelector("[data-disconnect]")?.addEventListener("click", () => {
    forgetToken();
    state.data = null;
    state.error = null;
    toast("권한을 해제했습니다.");
    rerender();
  });

  container.querySelector("#usage-range")?.addEventListener("change", (event) => {
    state.days = Number.parseInt(event.target.value, 10);
    load();
  });

  // 권한이 있는데 아직 값이 없으면 한 번 자동으로 불러옵니다.
  if (connected && !state.data && !state.error && !state.loading) load();
}
