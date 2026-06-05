const routeToken = new URLSearchParams(location.search).get("route");
let driverData = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("refreshBtn").addEventListener("click", loadDriverRoute);
  loadDriverRoute();
});

async function loadDriverRoute() {
  if (!routeToken) {
    $("driverStops").innerHTML = `<div class="card"><strong>Missing route</strong><p>Ask the office to resend today's route link.</p></div>`;
    return;
  }
  const response = await fetch(`/api/driver-route?route=${encodeURIComponent(routeToken)}`);
  const data = await response.json();
  if (!response.ok) {
    $("driverStops").innerHTML = `<div class="card"><strong>Route unavailable</strong><p>${escapeHtml(data.error || "Unable to load route.")}</p></div>`;
    return;
  }
  driverData = data;
  renderDriverRoute();
}

function renderDriverRoute() {
  const { business, route } = driverData;
  $("driverHeading").textContent = `${business.name} · ${route.vehicleName}`;
  $("driverSummary").textContent = `${route.stops.length} stops · ${Math.round(route.summary.distance)} km · ${formatMinutes(route.summary.minutes)}`;
  $("fullMapBtn").href = routeDirectionsLink(route, business);
  $("driverStops").innerHTML = route.stops.map((stop, index) => `
    <article class="stop driver-stop">
      <div class="stop-num">${index + 1}</div>
      <div>
        <h4>${escapeHtml(stop.customer)} <span style="color:var(--muted);font-weight:600;">${escapeHtml(stop.orderId)}</span></h4>
        <p>${escapeHtml(stop.cleanAddress)}</p>
        <p>${escapeHtml(stop.items)}${stop.codAmount ? ` · COD RM ${Number(stop.codAmount).toFixed(2)}` : ""}${stop.note ? ` · ${escapeHtml(stop.note)}` : ""}</p>
        <p>${statusChip(stop)}</p>
      </div>
      <div class="row-actions">
        <a class="btn full" target="_blank" rel="noreferrer" href="${mapsLink(stop)}">Open Stop In Maps</a>
        <button class="btn primary" type="button" onclick="updateStop('${stop.id}', 'delivered')">Delivered</button>
        <button class="btn" type="button" onclick="updateStop('${stop.id}', 'failed')">Failed</button>
      </div>
    </article>
  `).join("");
}

async function updateStop(orderId, status) {
  const response = await fetch("/api/driver-stop", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routeToken, orderId, status })
  });
  const data = await response.json();
  if (!response.ok) return toast(data.error || "Unable to update stop.");
  driverData.route = data.route;
  renderDriverRoute();
  toast(`Stop marked ${status}.`);
}

function mapsLink(stop) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.cleanAddress)}`;
}

function routeDirectionsLink(route, business) {
  if (!route?.stops.length) return "https://www.google.com/maps";
  const origin = business.depot || "Current Location";
  const destination = route.stops[route.stops.length - 1].cleanAddress;
  const waypoints = route.stops.slice(0, -1).slice(0, 8).map((stop) => stop.cleanAddress).join("|");
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function statusChip(stop) {
  const label = stop.status || "pending";
  const cls = label === "delivered" ? "ok" : label === "failed" ? "red" : label === "review" ? "warn" : "";
  return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
}

function formatMinutes(value) {
  const minutes = Math.round(value || 0);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
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
