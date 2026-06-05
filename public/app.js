const app = {
  token: localStorage.getItem("routewise_cloud_token") || "",
  workspace: null,
  activeRouteId: null,
  view: "dashboard"
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bind();
  if (app.token) loadWorkspace();
});

function bind() {
  $("loginTab").addEventListener("click", () => switchAuth("login"));
  $("registerTab").addEventListener("click", () => switchAuth("register"));
  $("loginForm").addEventListener("submit", login);
  $("registerForm").addEventListener("submit", registerBusiness);
  $("logoutBtn").addEventListener("click", logout);
  document.querySelectorAll(".nav button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $("sampleBtn").addEventListener("click", loadSample);
  $("csvFile").addEventListener("change", readCsvFile);
  $("clearCsvBtn").addEventListener("click", () => $("csvText").value = "");
  $("importBtn").addEventListener("click", importOrders);
  $("buildRouteBtn").addEventListener("click", buildRoute);
  $("sendDriverBtn").addEventListener("click", sendRouteToDriver);
  $("openDriverPageBtn").addEventListener("click", openDriverPage);
  $("copyDriverBtn").addEventListener("click", copyDriverRoute);
  $("historyFilter").addEventListener("change", renderHistory);
  $("historySearch").addEventListener("input", renderHistory);
  $("addVehicleBtn").addEventListener("click", addVehicle);
  $("saveSettingsBtn").addEventListener("click", saveSettings);
}

function switchAuth(mode) {
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  $("loginForm").classList.toggle("hidden", mode !== "login");
  $("registerForm").classList.toggle("hidden", mode !== "register");
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await api("/api/login", { method: "POST", body: Object.fromEntries(form), auth: false });
  setSession(result.token);
  app.workspace = await getWorkspace();
  renderApp();
  toast("Logged in.");
}

async function registerBusiness(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await api("/api/register-business", { method: "POST", body: Object.fromEntries(form), auth: false });
  setSession(result.token);
  app.workspace = await getWorkspace();
  renderApp();
  toast("Business workspace created.");
}

async function loadWorkspace() {
  try {
    app.workspace = await getWorkspace();
    renderApp();
  } catch {
    logout();
  }
}

function setSession(token) {
  app.token = token;
  localStorage.setItem("routewise_cloud_token", token);
}

function logout() {
  app.token = "";
  app.workspace = null;
  localStorage.removeItem("routewise_cloud_token");
  $("loginScreen").classList.remove("hidden");
  $("appShell").classList.add("hidden");
}

async function getWorkspace() {
  return api("/api/workspace");
}

function renderApp() {
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("businessName").textContent = app.workspace.business.name;
  showView(app.view);
  renderStats();
  renderDashboard();
  renderOrders();
  renderDispatch();
  renderHistory();
  renderVehicles();
  renderSettings();
}

function showView(view) {
  app.view = view;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === view));
  document.querySelectorAll(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = {
    dashboard: ["Dashboard", "Daily delivery control center"],
    orders: ["Orders", "Review, update, and track deliveries"],
    dispatch: ["Dispatch", "Send daily route to each driver smartphone"],
    history: ["History", "Completed deliveries, failed orders, and past activity"],
    drivers: ["Drivers", "Vehicles, capacities, and WhatsApp handoff"],
    settings: ["Settings", "Business routing defaults"]
  };
  $("pageTitle").textContent = titles[view][0];
  $("pageSubtitle").textContent = titles[view][1];
}

function renderStats() {
  const { orders, vehicles, routes } = app.workspace;
  const pending = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const review = pending.filter((order) => order.issues.length || order.status === "review");
  const delivered = orders.filter((order) => order.status === "delivered");
  const distance = routes.reduce((sum, route) => sum + (route.summary?.distance || 0), 0);
  $("statPending").textContent = pending.length;
  $("statReview").textContent = review.length;
  $("statDelivered").textContent = delivered.length;
  $("statVehicles").textContent = vehicles.length;
  $("statRoute").textContent = `${Math.round(distance)} km`;
}

function renderDashboard() {
  const issues = app.workspace.orders.flatMap((order) => order.issues.map((issue) => ({ order, issue })));
  $("issueCount").textContent = `${issues.length} checks`;
  $("importCount").textContent = `${app.workspace.orders.length} orders saved`;
  $("issueList").innerHTML = issues.length ? issues.slice(0, 12).map(({ order, issue }) => `
    <div class="issue"><strong>${escapeHtml(order.orderId)} · ${escapeHtml(order.customer)}</strong><br>${escapeHtml(issue)} · ${escapeHtml(order.cleanAddress)}</div>
  `).join("") : `<div class="card"><strong>No review issues</strong><p>Imported orders are ready for route planning.</p></div>`;
}

function renderOrders() {
  $("ordersCount").textContent = `${app.workspace.orders.length} orders`;
  $("ordersBody").innerHTML = app.workspace.orders.length ? app.workspace.orders.map((order) => `
    <tr>
      <td>${escapeHtml(order.orderId)}</td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${escapeHtml(order.phone || "-")}</td>
      <td>${escapeHtml(order.cleanAddress)}</td>
      <td>${escapeHtml(order.zone)}</td>
      <td>${escapeHtml(order.items)}</td>
      <td>${statusChip(order)}</td>
      <td>
        <div class="row-actions">
          <button class="text-btn" onclick="setOrderStatus('${order.id}', 'delivered')">Done</button>
          <button class="text-btn" onclick="setOrderStatus('${order.id}', 'failed')">Failed</button>
        </div>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="8">No orders imported yet.</td></tr>`;
}

function renderDispatch() {
  const routes = app.workspace.routes;
  if (!app.activeRouteId && routes.length) app.activeRouteId = routes[0].id;
  const route = activeRoute();
  $("routeSummary").textContent = routes.length ? `${routes.length} vehicle route${routes.length > 1 ? "s" : ""}` : "No route";
  $("stopCount").textContent = route ? `${route.stops.length} stops` : "0 stops";
  $("routeTabs").innerHTML = routes.length ? routes.map((item) => `
    <button class="${item.id === app.activeRouteId ? "active" : ""}" onclick="selectRoute('${item.id}')">${escapeHtml(item.vehicleName)}</button>
  `).join("") : "";
  renderMap(route);
  renderRouteList(route);
}

function renderHistory() {
  const filter = $("historyFilter").value;
  const query = $("historySearch").value.trim().toLowerCase();
  const rows = app.workspace.orders
    .filter((order) => {
      if (filter === "completed") return order.status === "delivered";
      if (filter === "failed") return order.status === "failed";
      return true;
    })
    .filter((order) => {
      if (!query) return true;
      return [order.orderId, order.customer, order.cleanAddress, order.items, order.zone, order.status].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  $("historyCount").textContent = `${rows.length} records`;
  $("historyBody").innerHTML = rows.length ? rows.map((order) => `
    <tr>
      <td>${escapeHtml(order.orderId)}</td>
      <td>${escapeHtml(order.customer)}<br>${escapeHtml(order.phone || "-")}</td>
      <td>${escapeHtml(order.cleanAddress)}</td>
      <td>${escapeHtml(order.items)}</td>
      <td>${escapeHtml(order.zone)}</td>
      <td>${statusChip(order)}</td>
      <td>${formatDateTime(order.updatedAt || order.createdAt)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7">No history records match this filter.</td></tr>`;
}

function renderMap(route) {
  const board = $("mapBoard");
  board.querySelectorAll(".pin").forEach((pin) => pin.remove());
  if (!route?.stops.length) return;
  const bounds = getBounds(route.stops);
  route.stops.forEach((stop, index) => {
    const pin = document.createElement("div");
    pin.className = `pin ${stop.status === "delivered" ? "delivered" : stop.status === "failed" ? "failed" : ""}`;
    pin.style.left = `${scale(stop.lng, bounds.minLng, bounds.maxLng, 8, 92)}%`;
    pin.style.top = `${scale(stop.lat, bounds.maxLat, bounds.minLat, 12, 88)}%`;
    pin.innerHTML = `<span>${index + 1}</span>`;
    board.appendChild(pin);
  });
}

function renderRouteList(route) {
  if (!route?.stops.length) {
    $("routeList").innerHTML = `<div class="card"><strong>No route built</strong><p>Import orders and build a route first.</p></div>`;
    return;
  }
  const driverUrl = `${location.origin}/driver.html?route=${route.shareToken}`;
  $("routeList").innerHTML = `
    <div class="card">
      <strong>${escapeHtml(route.vehicleName)} · ${escapeHtml(route.driverName || "Driver")}</strong>
      <p>${route.driverPhone ? `WhatsApp ${escapeHtml(route.driverPhone)}` : "No driver phone saved"}<br>${route.stops.length} stops · ${Math.round(route.summary.distance)} km · ${formatMinutes(route.summary.minutes)}<br>Driver page: ${driverUrl}</p>
    </div>
    ${route.stops.map((stop, index) => `
      <article class="stop">
        <div class="stop-num">${index + 1}</div>
        <div>
          <h4>${escapeHtml(stop.customer)} <span style="color:var(--muted);font-weight:600;">${escapeHtml(stop.orderId)}</span></h4>
          <p>${escapeHtml(stop.cleanAddress)}</p>
          <p>${escapeHtml(stop.items)}${stop.codAmount ? ` · COD RM ${Number(stop.codAmount).toFixed(2)}` : ""}</p>
        </div>
        <div class="row-actions">
          <a class="text-btn" target="_blank" rel="noreferrer" href="${mapsLink(stop)}">Map</a>
          <button class="text-btn" onclick="setOrderStatus('${stop.id}', 'delivered')">Done</button>
        </div>
      </article>
    `).join("")}`;
}

function renderVehicles() {
  $("vehicleCount").textContent = `${app.workspace.vehicles.length} vehicles`;
  $("vehicleList").innerHTML = app.workspace.vehicles.map((vehicle) => `
    <div class="card">
      <strong>${escapeHtml(vehicle.name)} · ${Number(vehicle.capacity)} kg</strong>
      <p>${escapeHtml(vehicle.driverName || "No driver name")} · ${escapeHtml(vehicle.driverPhone || "No WhatsApp")}</p>
      <div class="settings-grid">
        <label class="field">Driver name<input id="driverName_${vehicle.id}" value="${escapeHtml(vehicle.driverName || "")}"></label>
        <label class="field">Driver WhatsApp<input id="driverPhone_${vehicle.id}" value="${escapeHtml(vehicle.driverPhone || "")}"></label>
      </div>
      <div class="toolbar spaced">
        <button class="btn" onclick="updateVehicle('${vehicle.id}')">Save Driver</button>
      </div>
    </div>
  `).join("");
}

function renderSettings() {
  const business = app.workspace.business;
  $("settingName").value = business.name || "";
  $("settingDepot").value = business.depot || "";
  $("settingWindow").value = business.deliveryWindow || "";
  $("settingStopMinutes").value = business.stopMinutes || 12;
  $("settingSpeed").value = business.speedKmh || 32;
  $("settingRouteStyle").value = business.routeStyle || "balanced";
}

async function loadSample() {
  const response = await fetch("/api/sample-csv", { headers: authHeaders() });
  $("csvText").value = await response.text();
  showView("dashboard");
  toast("Sample Shopee CSV loaded.");
}

async function readCsvFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  $("csvText").value = await file.text();
  toast(`${file.name} loaded.`);
}

async function importOrders() {
  const csv = $("csvText").value.trim();
  if (!csv) return toast("Paste or upload CSV first.");
  const result = await api("/api/import-orders", { method: "POST", body: { csv } });
  app.workspace = result.workspace;
  renderApp();
  toast(`${result.imported} orders imported.`);
}

async function buildRoute() {
  try {
    const result = await api("/api/build-route", { method: "POST", body: {} });
    app.workspace = result.workspace;
    app.activeRouteId = app.workspace.routes[0]?.id || null;
    renderApp();
    showView("dispatch");
    toast("Daily route built.");
  } catch (error) {
    toast(error.message);
  }
}

async function setOrderStatus(orderId, status) {
  const result = await api("/api/orders/status", { method: "PATCH", body: { orderId, status } });
  app.workspace = result.workspace;
  renderApp();
  toast(`Order marked ${status}.`);
}

async function addVehicle() {
  const body = {
    name: $("vehicleName").value,
    capacity: $("vehicleCapacity").value,
    driverName: $("driverName").value,
    driverPhone: $("driverPhone").value
  };
  const result = await api("/api/vehicles", { method: "POST", body });
  app.workspace = result.workspace;
  renderApp();
  $("vehicleName").value = "";
  $("vehicleCapacity").value = "500";
  $("driverName").value = "";
  $("driverPhone").value = "";
  toast("Vehicle added.");
}

async function updateVehicle(id) {
  const vehicle = app.workspace.vehicles.find((item) => item.id === id);
  const result = await api("/api/vehicles", {
    method: "PATCH",
    body: {
      id,
      name: vehicle.name,
      capacity: vehicle.capacity,
      driverName: $(`driverName_${id}`).value,
      driverPhone: $(`driverPhone_${id}`).value
    }
  });
  app.workspace = result.workspace;
  renderApp();
  toast("Driver saved.");
}

async function saveSettings() {
  const result = await api("/api/settings", {
    method: "PATCH",
    body: {
      name: $("settingName").value,
      depot: $("settingDepot").value,
      deliveryWindow: $("settingWindow").value,
      stopMinutes: $("settingStopMinutes").value,
      speedKmh: $("settingSpeed").value,
      routeStyle: $("settingRouteStyle").value
    }
  });
  app.workspace = result.workspace;
  renderApp();
  toast("Settings saved.");
}

function selectRoute(routeId) {
  app.activeRouteId = routeId;
  renderDispatch();
}

function activeRoute() {
  return app.workspace.routes.find((route) => route.id === app.activeRouteId) || app.workspace.routes[0] || null;
}

function sendRouteToDriver() {
  const route = activeRoute();
  if (!route) return toast("Build a route first.");
  const message = driverText(route);
  const phone = whatsappPhone(route.driverPhone);
  if (!phone) {
    navigator.clipboard.writeText(message);
    toast("No driver WhatsApp saved. Route copied instead.");
    showView("drivers");
    return;
  }
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  toast("WhatsApp route prepared.");
}

function openDriverPage() {
  const route = activeRoute();
  if (!route) return toast("Build a route first.");
  window.open(`/driver.html?route=${route.shareToken}`, "_blank", "noopener");
}

async function copyDriverRoute() {
  const route = activeRoute();
  if (!route) return toast("Build a route first.");
  await navigator.clipboard.writeText(driverText(route));
  toast("Driver route copied.");
}

function driverText(route) {
  const driverUrl = `${location.origin}/driver.html?route=${route.shareToken}`;
  return [
    `${app.workspace.business.name} delivery route`,
    `Vehicle: ${route.vehicleName}`,
    `Stops: ${route.stops.length}`,
    `Estimated: ${Math.round(route.summary.distance)} km · ${formatMinutes(route.summary.minutes)}`,
    `Driver mobile page: ${driverUrl}`,
    `Google route: ${routeDirectionsLink(route)}`,
    "",
    ...route.stops.map((stop, index) => `${index + 1}. ${stop.customer} (${stop.orderId})\n${stop.phone || "-"}\n${stop.cleanAddress}\n${stop.items}${stop.codAmount ? `\nCOD RM ${Number(stop.codAmount).toFixed(2)}` : ""}${stop.note ? `\nNote: ${stop.note}` : ""}\nMap: ${mapsLink(stop)}`)
  ].join("\n\n");
}

function mapsLink(stop) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.cleanAddress)}`;
}

function routeDirectionsLink(route) {
  if (!route?.stops.length) return "https://www.google.com/maps";
  const origin = app.workspace.business.depot || "Current Location";
  const destination = route.stops[route.stops.length - 1].cleanAddress;
  const waypoints = route.stops.slice(0, -1).slice(0, 8).map((stop) => stop.cleanAddress).join("|");
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.auth === false ? {} : authHeaders()) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function authHeaders() {
  return app.token ? { authorization: `Bearer ${app.token}` } : {};
}

function statusChip(order) {
  const label = order.issues?.length && !["delivered", "failed"].includes(order.status) ? "review" : order.status;
  const cls = label === "delivered" ? "ok" : label === "failed" ? "red" : label === "review" ? "warn" : "";
  return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
}

function getBounds(stops) {
  const lats = stops.map((stop) => stop.lat);
  const lngs = stops.map((stop) => stop.lng);
  const pad = 0.015;
  return { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad };
}

function scale(value, min, max, outMin, outMax) {
  if (Math.abs(max - min) < 0.00001) return (outMin + outMax) / 2;
  return outMin + ((value - min) / (max - min)) * (outMax - outMin);
}

function formatMinutes(value) {
  const minutes = Math.round(value || 0);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function whatsappPhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) return `6${digits}`;
  return digits;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2400);
}
