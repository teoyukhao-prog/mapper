import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const dbPath = join(dataDir, "routewise-db.json");
const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "0.0.0.0";

const zones = [
  { name: "Bukit Jalil", lat: 3.058, lng: 101.691, keys: ["bukit jalil", "seri kembangan", "57000", "43300"] },
  { name: "Petaling Jaya", lat: 3.112, lng: 101.605, keys: ["petaling jaya", "pj", "ss2", "sea park", "46300", "47300"] },
  { name: "Puchong", lat: 3.032, lng: 101.617, keys: ["puchong", "471", "bandar bukit puchong"] },
  { name: "Subang Jaya", lat: 3.073, lng: 101.586, keys: ["subang", "usj", "476", "475"] },
  { name: "Shah Alam", lat: 3.073, lng: 101.518, keys: ["shah alam", "setia alam", "kota kemuning", "400", "404"] },
  { name: "Klang", lat: 3.044, lng: 101.449, keys: ["klang", "port klang", "pelabuhan", "41"] },
  { name: "Kuala Lumpur", lat: 3.147, lng: 101.695, keys: ["kuala lumpur", "kl", "cheras", "setapak", "ampang", "kepong", "53300", "56000"] },
  { name: "Kajang", lat: 2.993, lng: 101.789, keys: ["kajang", "bangi", "semenyih", "430", "435"] },
  { name: "Rawang", lat: 3.322, lng: 101.576, keys: ["rawang", "480"] },
  { name: "Cyberjaya", lat: 2.922, lng: 101.655, keys: ["cyberjaya", "putrajaya", "630", "620"] }
];

const sampleCsv = `order_id,customer_name,phone,address,postcode,city,state,items,delivery_note,weight_kg,cod_amount,preferred_time
SP24060101,Aina Rahman,012-3456789,"B-12-06, Residensi Jalilmas, Bukit Jalil",57000,Kuala Lumpur,Kuala Lumpur,"Samsung 2-door fridge","Call before arrival",68,0,"10am-1pm"
SP24060102,Mr Tan,017-2228899,"No 18 Jalan SS2/24, SS2",47300,Petaling Jaya,Selangor,"Sharp washing machine","Guard house registration needed",42,1299,"2pm-5pm"
SP24060103,Nurul,011-99887766,"Lot 7 Jalan BP 6/3, Bandar Bukit Puchong",47120,Puchong,Selangor,"Panasonic microwave","Evening preferred",12,0,"5pm-7pm"
SP24060104,Lee Wei,016-8844122,"12 Jalan USJ 11/3K, Subang Jaya",47620,Subang Jaya,Selangor,"Midea air conditioner","Lift available",32,0,""
SP24060105,Kumar,019-7788991,"A-08-10, Saville Kajang, Jalan Reko",43000,Kajang,Selangor,"Hisense TV 55 inch","Customer can help receive at lobby",19,1899,""
SP24060106,Lim Mei,012-7766123,"No 9 Jalan Anggerik Vanilla 31/93, Kota Kemuning",40460,Shah Alam,Selangor,"Electrolux dryer","",38,0,""
SP24060107,Hafiz,013-2221414,"Block C, PV128, Jalan Genting Klang",53300,Setapak,Kuala Lumpur,"Toshiba freezer","Loading bay at back entrance",55,0,"11am-2pm"
SP24060108,Michelle Ong,018-6688123,"23 Jalan 21/17, Sea Park",46300,Petaling Jaya,Selangor,"Philips vacuum","",8,0,""`;

await mkdir(dataDir, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RouteWise Cloud running on http://${HOST}:${PORT}`);
});

async function handleApi(req, res, url) {
  const db = await readDb();
  const route = `${req.method} ${url.pathname}`;

  if (route === "POST /api/login") {
    const body = await readJson(req);
    const user = db.users.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase() && item.password === body.password);
    if (!user) return sendJson(res, 401, { error: "Invalid email or password" });
    const token = crypto.randomUUID();
    db.sessions[token] = { userId: user.id, businessId: user.businessId, createdAt: now() };
    await writeDb(db);
    return sendJson(res, 200, { token, user: publicUser(user), business: db.businesses.find((item) => item.id === user.businessId) });
  }

  if (route === "POST /api/platform-login") {
    const body = await readJson(req);
    const admin = db.platformAdmins.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase() && item.password === body.password);
    if (!admin) return sendJson(res, 401, { error: "Invalid platform admin login" });
    const token = crypto.randomUUID();
    db.platformSessions[token] = { adminId: admin.id, createdAt: now() };
    await writeDb(db);
    return sendJson(res, 200, { token, admin: { id: admin.id, name: admin.name, email: admin.email } });
  }

  if (route === "POST /api/register-business") {
    const body = await readJson(req);
    if (!body.businessName || !body.email || !body.password) return sendJson(res, 400, { error: "Business name, email, and password are required" });
    if (db.users.some((user) => user.email.toLowerCase() === body.email.toLowerCase())) return sendJson(res, 409, { error: "Email already exists" });
    const business = {
      id: id("biz"),
      name: body.businessName,
      depot: body.depot || "Bukit Jalil, Kuala Lumpur",
      deliveryWindow: "10am-6pm",
      stopMinutes: 12,
      speedKmh: 32,
      routeStyle: "balanced",
      createdAt: now()
    };
    const user = { id: id("usr"), businessId: business.id, name: body.name || "Owner", email: body.email, password: body.password, role: "owner", createdAt: now() };
    db.businesses.push(business);
    db.users.push(user);
    db.vehicles.push({ id: id("veh"), businessId: business.id, name: "Van 1", capacity: 500, driverName: "Driver 1", driverPhone: "", createdAt: now() });
    addEvent(db, business.id, "business_created", { businessName: business.name });
    const token = crypto.randomUUID();
    db.sessions[token] = { userId: user.id, businessId: business.id, createdAt: now() };
    await writeDb(db);
    return sendJson(res, 201, { token, user: publicUser(user), business });
  }

  if (req.method === "GET" && url.pathname === "/api/driver-route") {
    const shareToken = url.searchParams.get("route");
    const routeItem = db.routes.find((item) => item.shareToken === shareToken);
    if (!routeItem) return sendJson(res, 404, { error: "Driver route not found" });
    const business = db.businesses.find((item) => item.id === routeItem.businessId);
    return sendJson(res, 200, { business: { name: business.name, depot: business.depot, deliveryWindow: business.deliveryWindow }, route: routeItem });
  }

  if (route === "PATCH /api/driver-stop") {
    const body = await readJson(req);
    const routeItem = db.routes.find((item) => item.shareToken === body.routeToken);
    if (!routeItem) return sendJson(res, 404, { error: "Driver route not found" });
    routeItem.stops = routeItem.stops.map((stop) => stop.id === body.orderId ? { ...stop, status: body.status, statusNote: body.note || "", updatedAt: now() } : stop);
    db.orders = db.orders.map((order) => order.businessId === routeItem.businessId && order.id === body.orderId ? { ...order, status: body.status, statusNote: body.note || "", updatedAt: now() } : order);
    addEvent(db, routeItem.businessId, "driver_stop_updated", { routeId: routeItem.id, orderId: body.orderId, status: body.status });
    await writeDb(db);
    return sendJson(res, 200, { route: routeItem });
  }

  if (route === "GET /api/platform/overview") {
    const platformSession = platformAuth(req, db);
    if (!platformSession) return sendJson(res, 401, { error: "Platform admin login required" });
    return sendJson(res, 200, platformOverview(db));
  }

  const session = auth(req, db);
  if (!session) return sendJson(res, 401, { error: "Login required" });
  const businessId = session.businessId;

  if (route === "GET /api/workspace") {
    return sendJson(res, 200, workspace(db, businessId));
  }

  if (route === "GET /api/sample-csv") {
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
    res.end(sampleCsv);
    return;
  }

  if (route === "POST /api/import-orders") {
    const body = await readJson(req);
    const rows = parseTable(String(body.csv || ""));
    const imported = rows.map((row, index) => normalizeOrder(row, index, businessId));
    const orderMap = new Map(db.orders.filter((order) => order.businessId === businessId).map((order) => [order.orderId, order]));
    imported.forEach((order) => {
      const current = orderMap.get(order.orderId);
      if (current) {
        Object.assign(current, order, { id: current.id, status: current.status, createdAt: current.createdAt, updatedAt: now() });
      } else {
        db.orders.push(order);
      }
      upsertCustomer(db, order);
    });
    addEvent(db, businessId, "orders_imported", { count: imported.length });
    await writeDb(db);
    return sendJson(res, 200, { imported: imported.length, workspace: workspace(db, businessId) });
  }

  if (route === "POST /api/orders") {
    const body = await readJson(req);
    const order = normalizeOrder(body, db.orders.length, businessId);
    db.orders.push(order);
    upsertCustomer(db, order);
    await writeDb(db);
    return sendJson(res, 201, { order, workspace: workspace(db, businessId) });
  }

  if (route === "PATCH /api/orders/status") {
    const body = await readJson(req);
    db.orders = db.orders.map((order) => order.businessId === businessId && order.id === body.orderId ? { ...order, status: body.status, updatedAt: now() } : order);
    db.routes.forEach((routeItem) => {
      if (routeItem.businessId === businessId) {
        routeItem.stops = routeItem.stops.map((stop) => stop.id === body.orderId ? { ...stop, status: body.status } : stop);
      }
    });
    addEvent(db, businessId, "admin_order_status_updated", { orderId: body.orderId, status: body.status });
    await writeDb(db);
    return sendJson(res, 200, { workspace: workspace(db, businessId) });
  }

  if (route === "POST /api/vehicles") {
    const body = await readJson(req);
    const vehicle = { id: id("veh"), businessId, name: body.name || "Vehicle", capacity: Number(body.capacity || 500), driverName: body.driverName || "", driverPhone: cleanPhone(body.driverPhone || ""), createdAt: now() };
    db.vehicles.push(vehicle);
    addEvent(db, businessId, "vehicle_created", { vehicleId: vehicle.id });
    await writeDb(db);
    return sendJson(res, 201, { vehicle, workspace: workspace(db, businessId) });
  }

  if (route === "PATCH /api/vehicles") {
    const body = await readJson(req);
    db.vehicles = db.vehicles.map((vehicle) => vehicle.businessId === businessId && vehicle.id === body.id ? { ...vehicle, ...body, capacity: Number(body.capacity || vehicle.capacity), driverPhone: cleanPhone(body.driverPhone || vehicle.driverPhone || "") } : vehicle);
    await writeDb(db);
    return sendJson(res, 200, { workspace: workspace(db, businessId) });
  }

  if (route === "POST /api/build-route") {
    const pendingOrders = db.orders.filter((order) => order.businessId === businessId && !["delivered", "cancelled"].includes(order.status));
    const vehicles = db.vehicles.filter((vehicle) => vehicle.businessId === businessId);
    if (!pendingOrders.length) return sendJson(res, 400, { error: "No pending orders to route" });
    const business = db.businesses.find((item) => item.id === businessId);
    const builtRoutes = assignToVehicles(pendingOrders, vehicles.length ? vehicles : [{ id: "default", name: "Vehicle 1", capacity: 9999, driverPhone: "" }], business);
    db.routes = db.routes.filter((routeItem) => routeItem.businessId !== businessId || routeItem.date !== today());
    db.routes.push(...builtRoutes);
    const routedOrderIds = new Set(builtRoutes.flatMap((routeItem) => routeItem.stops.map((stop) => stop.orderId)));
    db.orders = db.orders.map((order) => order.businessId === businessId && routedOrderIds.has(order.id) ? { ...order, status: order.issues.length ? "review" : "routed", updatedAt: now() } : order);
    addEvent(db, businessId, "route_built", { routes: builtRoutes.length, stops: builtRoutes.reduce((sum, routeItem) => sum + routeItem.stops.length, 0) });
    await writeDb(db);
    return sendJson(res, 200, { routes: builtRoutes, workspace: workspace(db, businessId) });
  }

  if (route === "PATCH /api/settings") {
    const body = await readJson(req);
    db.businesses = db.businesses.map((business) => business.id === businessId ? { ...business, ...body, stopMinutes: Number(body.stopMinutes || business.stopMinutes), speedKmh: Number(body.speedKmh || business.speedKmh) } : business);
    await writeDb(db);
    return sendJson(res, 200, { workspace: workspace(db, businessId) });
  }

  sendJson(res, 404, { error: "Not found" });
}

function workspace(db, businessId) {
  const business = db.businesses.find((item) => item.id === businessId);
  const orders = db.orders.filter((item) => item.businessId === businessId);
  const vehicles = db.vehicles.filter((item) => item.businessId === businessId);
  const customers = db.customers.filter((item) => item.businessId === businessId);
  const routes = db.routes.filter((item) => item.businessId === businessId && item.date === today());
  return { business, orders, vehicles, customers, routes };
}

function platformOverview(db) {
  const businesses = db.businesses.map((business) => {
    const orders = db.orders.filter((order) => order.businessId === business.id);
    const routes = db.routes.filter((route) => route.businessId === business.id);
    const vehicles = db.vehicles.filter((vehicle) => vehicle.businessId === business.id);
    const events = db.deliveryEvents.filter((event) => event.businessId === business.id);
    const delivered = orders.filter((order) => order.status === "delivered").length;
    const failed = orders.filter((order) => order.status === "failed").length;
    const review = orders.filter((order) => order.issues?.length || order.status === "review").length;
    const lastEvent = events.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      id: business.id,
      name: business.name,
      createdAt: business.createdAt,
      orders: orders.length,
      delivered,
      failed,
      review,
      routes: routes.length,
      vehicles: vehicles.length,
      lastActiveAt: lastEvent?.createdAt || business.createdAt,
      usageScore: orders.length + routes.length * 5 + delivered * 2
    };
  });
  const eventsByType = db.deliveryEvents.reduce((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] || 0) + 1;
    return acc;
  }, {});
  const recentEvents = db.deliveryEvents.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map((event) => ({
    ...event,
    businessName: db.businesses.find((business) => business.id === event.businessId)?.name || "Unknown"
  }));
  return {
    totals: {
      businesses: db.businesses.length,
      users: db.users.length,
      orders: db.orders.length,
      routes: db.routes.length,
      vehicles: db.vehicles.length,
      delivered: db.orders.filter((order) => order.status === "delivered").length,
      failed: db.orders.filter((order) => order.status === "failed").length,
      review: db.orders.filter((order) => order.issues?.length || order.status === "review").length
    },
    businesses,
    eventsByType,
    recentEvents,
    improvementSignals: buildImprovementSignals(db, businesses)
  };
}

function buildImprovementSignals(db, businesses) {
  const signals = [];
  const totalOrders = db.orders.length || 1;
  const reviewCount = db.orders.filter((order) => order.issues?.length || order.status === "review").length;
  const failedCount = db.orders.filter((order) => order.status === "failed").length;
  const driverUpdates = db.deliveryEvents.filter((event) => event.eventType === "driver_stop_updated").length;
  if (reviewCount / totalOrders > 0.2) signals.push("Many orders need review. Improve address parsing or add Google Geocoding API.");
  if (failedCount / totalOrders > 0.08) signals.push("Failed delivery rate is rising. Add failure reasons and customer pre-delivery confirmation.");
  if (driverUpdates < Math.max(1, db.routes.length)) signals.push("Drivers are not updating many stops. Improve driver page training or add WhatsApp reminders.");
  if (businesses.some((business) => business.orders > 0 && business.routes === 0)) signals.push("Some businesses import orders but do not build routes. Add onboarding checklist or in-app guide.");
  if (!signals.length) signals.push("Usage looks healthy. Next upgrade: exact geocoding, proof of delivery, and subscription billing.");
  return signals;
}

function assignToVehicles(orders, vehicles, business) {
  const depot = estimateDepot(business.depot);
  const sorted = [...orders].sort((a, b) => {
    if (business.routeStyle === "heavyFirst") return (b.weight || 0) - (a.weight || 0);
    if (business.routeStyle === "zoneSweep") return a.zone.localeCompare(b.zone) || distanceKm(depot, a) - distanceKm(depot, b);
    return distanceKm(depot, a) - distanceKm(depot, b);
  });
  const buckets = vehicles.map((vehicle) => ({ vehicle, load: 0, stops: [] }));
  sorted.forEach((order) => {
    let bucket = buckets.find((item) => item.load + (order.weight || 0) <= Number(item.vehicle.capacity || 9999));
    if (!bucket) bucket = buckets.reduce((lightest, item) => item.load < lightest.load ? item : lightest, buckets[0]);
    bucket.stops.push(order);
    bucket.load += order.weight || 0;
  });
  return buckets.filter((bucket) => bucket.stops.length).map((bucket) => {
    const stops = twoOpt(optimizeRoute(bucket.stops, depot, business), depot);
    return {
      id: id("rte"),
      businessId: business.id,
      date: today(),
      vehicleId: bucket.vehicle.id,
      vehicleName: bucket.vehicle.name,
      driverName: bucket.vehicle.driverName || "",
      driverPhone: bucket.vehicle.driverPhone || "",
      shareToken: crypto.randomUUID().slice(0, 12),
      load: bucket.load,
      summary: summarize(stops, depot, business),
      stops: stops.map((stop, index) => ({ ...stop, sequence: index + 1 })),
      createdAt: now()
    };
  });
}

function optimizeRoute(orders, depot, business) {
  const remaining = [...orders];
  const route = [];
  let current = depot;
  while (remaining.length) {
    let bestIndex = 0;
    let bestScore = Infinity;
    remaining.forEach((order, index) => {
      let score = distanceKm(current, order);
      if (business.routeStyle === "balanced") score += order.issues.length * 2.5;
      if (business.routeStyle === "heavyFirst") score -= Math.min(order.weight || 0, 100) * 0.06;
      if (order.preferredTime) score -= 0.8;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    route.push(next);
    current = next;
  }
  return route;
}

function twoOpt(route, depot) {
  if (route.length < 4) return route;
  let best = [...route];
  let improved = true;
  let guard = 0;
  while (improved && guard < 50) {
    improved = false;
    guard++;
    for (let i = 0; i < best.length - 2; i++) {
      for (let k = i + 2; k < best.length; k++) {
        const candidate = best.slice(0, i + 1).concat(best.slice(i + 1, k + 1).reverse(), best.slice(k + 1));
        if (routeDistance(candidate, depot) + 0.01 < routeDistance(best, depot)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

function normalizeOrder(row, index, businessId) {
  const orderId = pick(row, ["order_id", "orderId", "order", "order_sn", "order_no", "order_number"]) || `ORDER-${Date.now()}-${index + 1}`;
  const customer = pick(row, ["customer_name", "customer", "buyer_name", "recipient_name", "name"]) || "Unknown customer";
  const phone = cleanPhone(pick(row, ["phone", "mobile", "recipient_phone", "buyer_phone", "contact"]));
  const postcode = pick(row, ["postcode", "postal_code", "zip", "zipcode"]);
  const city = pick(row, ["city", "town", "district"]);
  const stateName = pick(row, ["state", "province", "stateName"]);
  const rawAddress = pick(row, ["address", "rawAddress", "recipient_address", "shipping_address", "buyer_address", "full_address"]) || Object.values(row).join(" ");
  const items = pick(row, ["items", "item", "product", "product_name", "sku_name"]) || "-";
  const note = pick(row, ["delivery_note", "note", "remark", "remarks", "buyer_remark"]) || "";
  const weight = Number(pick(row, ["weight_kg", "weight", "parcel_weight"]) || 0);
  const codAmount = Number(pick(row, ["cod_amount", "cod", "amount_to_collect"]) || 0);
  const preferredTime = pick(row, ["preferred_time", "time_window", "delivery_window"]) || "";
  const cleanAddress = cleanAddressText([rawAddress, postcode, city, stateName].filter(Boolean).join(", "));
  const estimate = estimateLocation(cleanAddress, postcode, city, stateName, index);
  const issues = detectIssues({ cleanAddress, postcode, phone, estimate });
  return {
    id: stableOrderId(orderId),
    businessId,
    orderId,
    customer,
    phone,
    postcode,
    city,
    stateName,
    rawAddress,
    cleanAddress,
    zone: estimate.zone,
    lat: estimate.lat,
    lng: estimate.lng,
    confidence: estimate.confidence,
    items,
    note,
    weight,
    codAmount,
    preferredTime,
    issues,
    status: issues.length ? "review" : "pending",
    createdAt: now(),
    updatedAt: now()
  };
}

function upsertCustomer(db, order) {
  const key = `${order.businessId}:${order.phone || order.customer}`.toLowerCase();
  const existing = db.customers.find((customer) => customer.id === key);
  const customer = {
    id: key,
    businessId: order.businessId,
    name: order.customer,
    phone: order.phone,
    address: order.cleanAddress,
    zone: order.zone,
    lat: order.lat,
    lng: order.lng,
    deliveryCount: existing ? existing.deliveryCount + 1 : 1,
    lastOrderId: order.orderId,
    updatedAt: now()
  };
  if (existing) Object.assign(existing, customer);
  else db.customers.push(customer);
}

function estimateLocation(address, postcode, city, stateName, index) {
  const haystack = [address, postcode, city, stateName].join(" ").toLowerCase();
  let best = zones[0];
  let score = -1;
  zones.forEach((zone) => {
    const zoneScore = zone.keys.reduce((total, key) => total + (haystack.includes(key) ? 1 : 0), 0);
    if (zoneScore > score) {
      best = zone;
      score = zoneScore;
    }
  });
  const jitter = deterministicJitter(address || String(index));
  return { zone: best.name, lat: best.lat + jitter.lat, lng: best.lng + jitter.lng, confidence: score <= 0 ? "low" : score === 1 ? "medium" : "high" };
}

function detectIssues(order) {
  const issues = [];
  if (!order.cleanAddress || order.cleanAddress.length < 18) issues.push("Address looks too short");
  if (!/\b\d{5}\b/.test(order.cleanAddress) && !order.postcode) issues.push("Missing postcode");
  if (!order.phone || order.phone.length < 9) issues.push("Missing phone");
  if (order.estimate?.confidence === "low") issues.push("Area not recognized");
  if (/condo|residen|apartment|pangsapuri|block|blok/i.test(order.cleanAddress) && !/[a-z]-?\d|unit|level|floor|tingkat/i.test(order.cleanAddress)) issues.push("Check unit number");
  return issues;
}

function parseTable(text) {
  const delimiter = text.includes("\t") && !text.includes(",") ? "\t" : ",";
  const rows = parseDelimited(text, delimiter).filter((row) => row.some(Boolean));
  if (!rows.length) return [];
  const first = rows[0].map((cell) => normalizeKey(cell));
  const hasHeader = first.some((key) => ["address", "postcode", "customer_name", "name", "order_id", "order"].includes(key));
  const headers = hasHeader ? first : defaultHeaders(rows[0].length);
  return (hasHeader ? rows.slice(1) : rows).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || "").trim()])));
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const cleanPath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const fullPath = join(publicDir, cleanPath);
  if (!fullPath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");
  if (!existsSync(fullPath)) return sendText(res, 404, "Not found");
  const content = await readFile(fullPath);
  res.writeHead(200, { "content-type": contentType(extname(fullPath)) });
  res.end(content);
}

async function readDb() {
  if (!existsSync(dbPath)) {
    const seed = seedDb();
    await writeDb(seed);
    return seed;
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.platformAdmins ||= [{ id: "padm_demo", name: "RouteWise Founder", email: "founder@routewise.local", password: "founder123", createdAt: now() }];
  db.platformSessions ||= {};
  db.deliveryEvents ||= [];
  db.sessions ||= {};
  return db;
}

async function writeDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function seedDb() {
  const businessId = "biz_demo";
  const userId = "usr_demo";
  return {
    businesses: [{ id: businessId, name: "Family Appliance Store", depot: "Bukit Jalil, Kuala Lumpur", deliveryWindow: "10am-6pm", stopMinutes: 12, speedKmh: 32, routeStyle: "balanced", createdAt: now() }],
    users: [{ id: userId, businessId, name: "Demo Owner", email: "demo@routewise.local", password: "demo123", role: "owner", createdAt: now() }],
    vehicles: [
      { id: "veh_van1", businessId, name: "Van 1", capacity: 500, driverName: "Ahmad", driverPhone: "60123456789", createdAt: now() },
      { id: "veh_van2", businessId, name: "Van 2", capacity: 350, driverName: "Lim", driverPhone: "", createdAt: now() }
    ],
    platformAdmins: [{ id: "padm_demo", name: "RouteWise Founder", email: "founder@routewise.local", password: "founder123", createdAt: now() }],
    platformSessions: {},
    orders: [],
    customers: [],
    routes: [],
    deliveryEvents: [],
    sessions: {}
  };
}

function auth(req, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return db.sessions[token] || null;
}

function platformAuth(req, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return db.platformSessions[token] || null;
}

function addEvent(db, businessId, eventType, payload = {}) {
  if (!db.deliveryEvents) db.deliveryEvents = [];
  db.deliveryEvents.push({ id: id("evt"), businessId, eventType, payload, createdAt: now() });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function contentType(ext) {
  return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".csv": "text/csv; charset=utf-8" }[ext] || "application/octet-stream";
}

function publicUser(user) {
  return { id: user.id, businessId: user.businessId, name: user.name, email: user.email, role: user.role };
}

function pick(row, keys) {
  for (const key of keys) if (row[key]) return row[key];
  return "";
}

function defaultHeaders(length) {
  const headers = ["order_id", "customer_name", "phone", "address", "postcode", "city", "state", "items", "delivery_note", "weight_kg", "cod_amount", "preferred_time"];
  return Array.from({ length }, (_, index) => headers[index] || `field_${index + 1}`);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cleanPhone(value) {
  return String(value || "").trim().replace(/[^\d+]/g, "").replace(/^60(?=1)/, "0");
}

function cleanAddressText(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/,{2,}/g, ",").replace(/\b(jln)\b/ig, "Jalan").replace(/\b(no)\b/ig, "No").trim();
}

function stableOrderId(value) {
  return `ord_${String(value || id("order")).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function estimateDepot(value) {
  const lower = String(value || "").toLowerCase();
  const match = zones.find((zone) => zone.keys.some((key) => lower.includes(key)));
  return match ? { lat: match.lat, lng: match.lng } : { lat: 3.058, lng: 101.691 };
}

function summarize(stops, depot, business) {
  const distance = routeDistance(stops, depot);
  const minutes = (distance / Number(business.speedKmh || 32)) * 60 + stops.length * Number(business.stopMinutes || 12);
  return { distance, minutes };
}

function routeDistance(route, depot) {
  let total = 0;
  let current = depot;
  route.forEach((stop) => {
    total += distanceKm(current, stop);
    current = stop;
  });
  return total;
}

function distanceKm(a, b) {
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function toRad(value) {
  return value * Math.PI / 180;
}

function deterministicJitter(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i);
  return { lat: (((hash % 100) / 100) - 0.5) * 0.035, lng: ((((hash >> 8) % 100) / 100) - 0.5) * 0.035 };
}
