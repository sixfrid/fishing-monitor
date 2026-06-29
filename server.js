// ================================================
// SEVA YA INTERNET - MFUMO WA UVUVI GEOFENCING
// Inapokea data kutoka laptop yako via HTTP POST
// Inaonyesha dashboard kwa watu wote mtandaoni
// ================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ════════════════════════════════════════════════
// ADMIN LOGIN (token-based)
// Badilisha majina/password hapa kulingana na unavyotaka
// ════════════════════════════════════════════════
const USERS = { admin: 'admin123', msimamizi: 'uvuvi2024' };
const sessions = new Map(); // token -> { user, expires }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // saa 8

function createToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { user, expires: Date.now() + SESSION_TTL_MS });
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(token); return null; }
  return s;
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Tafadhali ingia (login) kwanza' });
  req.user = session.user;
  next();
}

// ── WebSocket kwa dashboard — WAZI kwa kila mtu (hauitaji login) ──
// Hii inaruhusu control room attendant kufuatilia LIVE alarm/red-blink
// bila kuingia kwanza. Historia ya ukiukaji (log) ndiyo pekee inalindwa.
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  // Tuma hali ya SASA HIVI ya boti (LIVE state) — SI historia ya ukiukaji
  ws.send(JSON.stringify({ type: 'init', boats: Object.values(boats) }));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch(e) {}
    }
  });
}

// ── Hifadhi ──
const boats = {};
const alertsLog = [];
let packetCount = 0;

// ── Maeneo Yaliyokatazwa ──
// Badilisha kuratibu hizi kulingana na eneo lako halisi
const FORBIDDEN_ZONES = [
  {
    id: 'A',
    name: 'Eneo A - Lililokatazwa',
    bounds: { latMin: -8.937, latMax: -8.931, lonMin: 33.418, lonMax: 33.424 }
  },
  {
    id: 'B',
    name: 'Eneo B - Lililokatazwa',
    bounds: { latMin: -8.945, latMax: -8.939, lonMin: 33.422, lonMax: 33.428 }
  }
];

function checkViolation(lat, lon) {
  for (const zone of FORBIDDEN_ZONES) {
    const b = zone.bounds;
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) return zone;
  }
  return null;
}

function checkWarning(lat, lon) {
  const M = 0.001;
  for (const zone of FORBIDDEN_ZONES) {
    const b = zone.bounds;
    if (lat >= b.latMin-M && lat <= b.latMax+M && lon >= b.lonMin-M && lon <= b.lonMax+M) return zone;
  }
  return null;
}

function processBoatData(boatId, lat, lon, rawStatus) {
  const violation = checkViolation(lat, lon);
  const warning = !violation ? checkWarning(lat, lon) : null;
  const arduinoViolation = rawStatus && /PROHIBITED|NEEDS HELP/i.test(rawStatus);
  const status = (violation || arduinoViolation) ? 'violation' : warning ? 'warning' : 'safe';

  packetCount++;
  const record = {
    id: boatId, lat, lon, status,
    zone: violation?.name || warning?.name || (arduinoViolation ? 'Eneo Lililokatazwa' : null),
    time: new Date().toISOString(),
    packet: packetCount
  };

  boats[boatId] = record;
  broadcast({ type: 'boat_update', boat: record });

  if (status === 'violation') {
    const alert = { type:'alert', level:'danger',
      message:`🚨 ${boatId} amevuka mpaka! ${record.zone || ''}`,
      boat: record, time: record.time };
    alertsLog.unshift(alert);
    if (alertsLog.length > 100) alertsLog.pop();
    broadcast(alert);
    console.log(`🚨 UKIUKAJI! ${boatId} | Lat:${lat} Lon:${lon}`);
  } else if (status === 'warning') {
    const alert = { type:'alert', level:'warning',
      message:`⚠️ ${boatId} inakaribia ${record.zone}`,
      boat: record, time: record.time };
    alertsLog.unshift(alert);
    broadcast(alert);
    console.log(`⚠️  ONYO! ${boatId} | Lat:${lat} Lon:${lon}`);
  } else {
    console.log(`✅ SALAMA | ${boatId} | Lat:${lat} Lon:${lon} | #${packetCount}`);
  }
}

// ── API ──
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Laptop yako inatuma data hapa (HAIHITAJI login — ni mashine, si admin)
app.post('/api/data', (req, res) => {
  const { boat_id, lat, lon, status } = req.body;
  if (!boat_id || lat === undefined || lon === undefined) {
    return res.status(400).json({ error: 'Tuma: boat_id, lat, lon' });
  }
  processBoatData(boat_id, parseFloat(lat), parseFloat(lon), status);
  res.json({ ok: true, packet: packetCount });
});

// ── Admin login/logout ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username && USERS[username] && USERS[username] === password) {
    const token = createToken(username);
    return res.json({ ok: true, token, user: username });
  }
  res.status(401).json({ error: 'Jina au neno la siri si sahihi' });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization || '';
  sessions.delete(header.slice(7));
  res.json({ ok: true });
});

// Hali ya SASA HIVI ya boti — WAZI kwa kila mtu (control room, hauitaji login)
app.get('/api/boats', (req, res) => res.json(Object.values(boats)));
app.get('/api/zones', (req, res) => res.json(FORBIDDEN_ZONES));

// Historia ya ukiukaji (log la kudumu) — TU kwa admin aliyeingia (login)
app.get('/api/alerts', requireAuth, (req, res) => res.json(alertsLog.slice(0, 50)));
app.get('/api/status', (req, res) => res.json({
  online: true,
  boats: Object.keys(boats).length,
  packets: packetCount,
  clients: clients.size,
  uptime: Math.floor(process.uptime()) + 's'
}));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   MFUMO WA UVUVI - ONLINE SERVER        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port: ${PORT}                               ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('Inasubiri data kutoka laptop...');
});const alertsLog = [];
let packetCount = 0;

// ── Maeneo Yaliyokatazwa ──
// Badilisha kuratibu hizi kulingana na eneo lako halisi
const FORBIDDEN_ZONES = [
  {
    id: 'A',
    name: 'Eneo A - Lililokatazwa',
    bounds: { latMin: -8.937, latMax: -8.931, lonMin: 33.418, lonMax: 33.424 }
  },
  {
    id: 'B',
    name: 'Eneo B - Lililokatazwa',
    bounds: { latMin: -8.945, latMax: -8.939, lonMin: 33.422, lonMax: 33.428 }
  }
];

function checkViolation(lat, lon) {
  for (const zone of FORBIDDEN_ZONES) {
    const b = zone.bounds;
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) return zone;
  }
  return null;
}

function checkWarning(lat, lon) {
  const M = 0.001;
  for (const zone of FORBIDDEN_ZONES) {
    const b = zone.bounds;
    if (lat >= b.latMin-M && lat <= b.latMax+M && lon >= b.lonMin-M && lon <= b.lonMax+M) return zone;
  }
  return null;
}

function processBoatData(boatId, lat, lon, rawStatus) {
  const violation = checkViolation(lat, lon);
  const warning = !violation ? checkWarning(lat, lon) : null;
  const arduinoViolation = rawStatus && /PROHIBITED|NEEDS HELP/i.test(rawStatus);
  const status = (violation || arduinoViolation) ? 'violation' : warning ? 'warning' : 'safe';

  packetCount++;
  const record = {
    id: boatId, lat, lon, status,
    zone: violation?.name || warning?.name || (arduinoViolation ? 'Eneo Lililokatazwa' : null),
    time: new Date().toISOString(),
    packet: packetCount
  };

  boats[boatId] = record;
  broadcast({ type: 'boat_update', boat: record });

  if (status === 'violation') {
    const alert = { type:'alert', level:'danger',
      message:`🚨 ${boatId} amevuka mpaka! ${record.zone || ''}`,
      boat: record, time: record.time };
    alertsLog.unshift(alert);
    if (alertsLog.length > 100) alertsLog.pop();
    broadcast(alert);
    console.log(`🚨 UKIUKAJI! ${boatId} | Lat:${lat} Lon:${lon}`);
  } else if (status === 'warning') {
    const alert = { type:'alert', level:'warning',
      message:`⚠️ ${boatId} inakaribia ${record.zone}`,
      boat: record, time: record.time };
    alertsLog.unshift(alert);
    broadcast(alert);
    console.log(`⚠️  ONYO! ${boatId} | Lat:${lat} Lon:${lon}`);
  } else {
    console.log(`✅ SALAMA | ${boatId} | Lat:${lat} Lon:${lon} | #${packetCount}`);
  }
}

// ── API ──
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Laptop yako inatuma data hapa
app.post('/api/data', (req, res) => {
  const { boat_id, lat, lon, status } = req.body;
  if (!boat_id || lat === undefined || lon === undefined) {
    return res.status(400).json({ error: 'Tuma: boat_id, lat, lon' });
  }
  processBoatData(boat_id, parseFloat(lat), parseFloat(lon), status);
  res.json({ ok: true, packet: packetCount });
});

app.get('/api/boats', (req, res) => res.json(Object.values(boats)));
app.get('/api/alerts', (req, res) => res.json(alertsLog.slice(0, 50)));
app.get('/api/zones', (req, res) => res.json(FORBIDDEN_ZONES));
app.get('/api/status', (req, res) => res.json({
  online: true,
  boats: Object.keys(boats).length,
  packets: packetCount,
  clients: clients.size,
  uptime: Math.floor(process.uptime()) + 's'
}));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   MFUMO WA UVUVI - ONLINE SERVER        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port: ${PORT}                               ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('Inasubiri data kutoka laptop...');
});
