// ================================================
// SEVA YA INTERNET - MFUMO WA UVUVI GEOFENCING
// Inapokea data kutoka laptop yako via HTTP POST
// Inaonyesha dashboard kwa watu wote mtandaoni
// ================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── WebSocket kwa dashboard ──
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  // Tuma data iliyopo tayari kwa mtumiaji mpya
  ws.send(JSON.stringify({ type: 'init', boats: Object.values(boats), alerts: alertsLog.slice(0,20) }));
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
const startTime = new Date(); // muda mfumo ulipoanza kuwa active

// ── Maeneo Yaliyokatazwa ──
// Kila eneo ni "point" + eneo dogo (radius) kuzunguka, kufanana na mantiki ya Arduino
// (targetLat, targetLon, allowedError) kwenye sketch ya LoRa Receiver
const FORBIDDEN_ZONES = [
  {
    id: 'A',
    name: 'Eneo A - Lililokatazwa',
    lat: -8.933936,
    lon: 33.420630,
    allowedError: 0.000084 // takriban mita 9, sawa na Arduino
  }
];

// Eneo la "onyo" (warning) ni doa kubwa kidogo kuzunguka eneo lililokatazwa
const WARNING_MARGIN = 0.0003; // takriban mita 33 za ziada

function checkViolation(lat, lon) {
  for (const zone of FORBIDDEN_ZONES) {
    const latDiff = Math.abs(lat - zone.lat);
    const lonDiff = Math.abs(lon - zone.lon);
    if (latDiff < zone.allowedError && lonDiff < zone.allowedError) return zone;
  }
  return null;
}

function checkWarning(lat, lon) {
  for (const zone of FORBIDDEN_ZONES) {
    const latDiff = Math.abs(lat - zone.lat);
    const lonDiff = Math.abs(lon - zone.lon);
    if (latDiff < zone.allowedError + WARNING_MARGIN && lonDiff < zone.allowedError + WARNING_MARGIN) return zone;
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
app.get('/api/full-history', (req, res) => res.json({
  startTime: startTime.toISOString(),
  alerts: alertsLog
}));
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
