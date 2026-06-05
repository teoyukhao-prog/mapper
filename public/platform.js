const platform = {
  token: localStorage.getItem("routewise_platform_token") || "",
  overview: null
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("platformLoginForm").addEventListener("submit", login);
  $("refreshPlatformBtn").addEventListener("click", loadOverview);
  $("platformLogoutBtn").addEventListener("click", logout);
  if (platform.token) loadOverview();
});

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await api("/api/platform-login", { method: "POST", body: Object.fromEntries(form), auth: false });
  platform.token = result.token;
  localStorage.setItem("routewise_platform_token", platform.token);
  await loadOverview();
  toast("Platform admin logged in.");
}

async function loadOverview() {
  try {
    platform.overview = await api("/api/platform/overview");
    render();
  } catch (error) {
    logout();
    toast(error.message);
  }
}

function render() {
  $("platformLogin").classList.add("hidden");
  $("platformApp").classList.remove("hidden");
  const { totals, businesses, recentEvents, improvementSignals } = platform.overview;
  $("pBusinesses").textContent = totals.businesses;
  $("pOrders").textContent = totals.orders;
  $("pRoutes").textContent = totals.routes;
  $("pDelivered").textContent = totals.delivered;
  $("pRisk").textContent = totals.review + totals.failed;
  $("businessUsageCount").textContent = `${businesses.length} businesses`;
  $("businessUsageBody").innerHTML = businesses.length ? businesses.map((business) => `
    <tr>
      <td>${escapeHtml(business.name)}</td>
      <td>${business.orders}</td>
      <td>${business.delivered}</td>
      <td>${business.review + business.failed}</td>
      <td>${business.routes}</td>
      <td>${formatDateTime(business.lastActiveAt)}</td>
      <td>${business.usageScore}</td>
    </tr>
  `).join("") : `<tr><td colspan="7">No businesses yet.</td></tr>`;
  $("improvementSignals").innerHTML = improvementSignals.map((signal) => `<div class="card"><strong>${escapeHtml(signal)}</strong></div>`).join("");
  $("eventCount").textContent = `${recentEvents.length} events`;
  $("eventsBody").innerHTML = recentEvents.length ? recentEvents.map((event) => `
    <tr>
      <td>${formatDateTime(event.createdAt)}</td>
      <td>${escapeHtml(event.businessName)}</td>
      <td>${escapeHtml(event.eventType)}</td>
      <td>${escapeHtml(JSON.stringify(event.payload || {}))}</td>
    </tr>
  `).join("") : `<tr><td colspan="4">No events recorded yet.</td></tr>`;
}

function logout() {
  platform.token = "";
  platform.overview = null;
  localStorage.removeItem("routewise_platform_token");
  $("platformLogin").classList.remove("hidden");
  $("platformApp").classList.add("hidden");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.auth === false ? {} : { authorization: `Bearer ${platform.token}` }) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}
