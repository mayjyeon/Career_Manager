/**
 * Google Cloud Monitoring 에서 Firestore 사용량을 읽어 옵니다.
 *
 * 브라우저에서 바로 부르려면 두 가지가 필요합니다.
 *
 *   1. monitoring.read 권한이 담긴 접근 토큰
 *      로그인할 때 받는 토큰에는 이 권한이 없어서, 사용량 화면에서
 *      따로 한 번 더 동의를 받습니다(학생 계정은 이 과정을 거치지 않습니다).
 *   2. 로그인한 계정이 그 Google Cloud 프로젝트의 모니터링 뷰어일 것
 *      보통 프로젝트를 만든 사람은 이미 권한이 있습니다.
 *
 * 받은 토큰은 한 시간쯤 뒤에 만료되고 자동으로 갱신되지 않아,
 * 만료되면 다시 동의를 받습니다. 토큰은 이 탭에만 잠시 보관합니다.
 */
import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { firebaseContext } from "./firebase.js";

const SCOPE = "https://www.googleapis.com/auth/monitoring.read";
const TOKEN_KEY = "career-manager.monitoring-token";

export class MonitoringError extends Error {}

/** 볼 수 있는 지표. */
export const METRICS = [
  { key: "read", label: "문서 읽기", type: "firestore.googleapis.com/document/read_count" },
  { key: "write", label: "문서 쓰기", type: "firestore.googleapis.com/document/write_count" },
  { key: "delete", label: "문서 삭제", type: "firestore.googleapis.com/document/delete_count" },
];

/* =========================================================
   접근 토큰
   ========================================================= */
function readStoredToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? "null");
    // 만료 1분 전부터는 없는 것으로 봅니다.
    if (saved && saved.expiresAt - 60000 > Date.now()) return saved.token;
  } catch {
    /* 저장된 값이 깨졌으면 무시합니다. */
  }
  return null;
}

function storeToken(token) {
  try {
    // 구글이 주는 토큰은 보통 한 시간짜리입니다.
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: Date.now() + 3600000 }));
  } catch {
    /* 저장할 수 없으면 이번 조회에만 씁니다. */
  }
}

export const hasToken = () => Boolean(readStoredToken());

export function forgetToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 무시 */
  }
}

/**
 * 사용량을 읽을 권한을 요청합니다. 구글 로그인 창이 한 번 뜹니다.
 * @returns {Promise<string>} 접근 토큰
 */
export async function requestAccess() {
  const { auth } = firebaseContext();
  const user = auth.currentUser;
  if (!user) throw new MonitoringError("로그인 상태를 확인할 수 없습니다.");

  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);

  let result;
  try {
    result = await reauthenticateWithPopup(user, provider);
  } catch (error) {
    if (error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request") {
      throw new MonitoringError("권한 요청 창이 닫혔습니다.");
    }
    throw new MonitoringError(error?.message ?? "권한을 받지 못했습니다.");
  }

  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new MonitoringError("접근 토큰을 받지 못했습니다.");

  storeToken(token);
  return token;
}

/* =========================================================
   지표 읽기
   ========================================================= */
function describeHttpError(status, body) {
  const message = body?.error?.message ?? "";

  if (status === 401) return "권한이 만료되었습니다. 다시 연결해주세요.";
  if (status === 403) {
    return (
      "이 계정은 프로젝트의 사용량을 볼 권한이 없습니다. " +
      "Google Cloud 콘솔에서 '모니터링 뷰어' 역할을 받았는지, " +
      "Cloud Monitoring API 가 사용 설정되어 있는지 확인해주세요." +
      (message ? `\n(${message})` : "")
    );
  }
  if (status === 404) return "프로젝트를 찾지 못했습니다. Firebase 설정의 projectId 를 확인해주세요.";

  return message || `사용량을 읽지 못했습니다. (HTTP ${status})`;
}

/**
 * 지표 하나의 시계열을 가져옵니다.
 *
 * @param {string} projectId
 * @param {string} metricType
 * @param {{ days: number, alignmentSeconds: number }} range
 * @returns {Promise<Array<{ time: string, value: number }>>} 오래된 순
 */
async function fetchSeries(projectId, metricType, { days, alignmentSeconds }) {
  const token = readStoredToken();
  if (!token) throw new MonitoringError("먼저 사용량 조회 권한을 연결해주세요.");

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);

  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    "interval.startTime": start.toISOString(),
    "interval.endTime": end.toISOString(),
    "aggregation.alignmentPeriod": `${alignmentSeconds}s`,
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
    view: "FULL",
  });

  const response = await fetch(
    `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401) forgetToken();
    throw new MonitoringError(describeHttpError(response.status, body));
  }

  const data = await response.json();
  const points = data.timeSeries?.[0]?.points ?? [];

  // 응답은 최근 것부터 오므로 뒤집어 시간순으로 만듭니다.
  return points
    .map((point) => ({
      time: point.interval?.startTime ?? point.interval?.endTime,
      value: Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0),
    }))
    .reverse();
}

/**
 * 읽기·쓰기·삭제 사용량을 한 번에 가져옵니다.
 *
 * @param {{ days?: number }} options
 * @returns {Promise<{ labels: string[], series: Array<{ name, values }> }>}
 */
export async function fetchUsage({ days = 7 } = {}) {
  const projectId = firebaseContext().app.options.projectId;
  if (!projectId) throw new MonitoringError("Firebase 설정에 projectId 가 없습니다.");

  const alignmentSeconds = days <= 1 ? 3600 : 86400;
  const results = [];

  for (const metric of METRICS) {
    results.push({ metric, points: await fetchSeries(projectId, metric.type, { days, alignmentSeconds }) });
  }

  // 모든 지표가 같은 시각을 쓰도록 가장 긴 것을 기준으로 맞춥니다.
  const base = results.reduce((best, r) => (r.points.length > best.points.length ? r : best), results[0]);

  const labels = base.points.map((point) => {
    const date = new Date(point.time);
    return alignmentSeconds === 3600
      ? `${date.getHours()}시`
      : `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const series = results.map(({ metric, points }) => ({
    name: metric.label,
    values: labels.map((_, index) => points[index]?.value ?? 0),
  }));

  return { labels, series };
}
