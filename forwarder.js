// ================================================
// FORWARDER - INAFANYA KAZI KWENYE LAPTOP YAKO
// Inasoma data kutoka Arduino (COM15)
// Inatuma kwa seva ya internet (Railway)
// ================================================

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// !! BADILISHA hii baada ya kuweka Railway !!
const SERVER_URL = 'https://YOUR-APP.railway.app/api/data';

const SERIAL_PORT = 'COM15';
const BAUD_RATE = 9600;

let buf = { lat: null, lon: null };
let lastStatus = 'safe';
let sentCount = 0;

async function sendToServer(lat, lon, status) {
  try {
    const res = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boat_id: 'BOAT-001', lat, lon, status })
    });
    if (res.ok) {
      sentCount++;
      console.log(`📤 Imetumwa #${sentCount} | Lat:${lat} Lon:${lon} | ${status}`);
    }
  } catch (err) {
    console.log(`❌ Haiwezi kutuma: ${err.message}`);
  }
}

function processLine(line) {
  line = line.trim();
  if (!line) return;

  const latMatch = line.match(/LATITUDE\s*:\s*([-\d.]+)/i);
  if (latMatch) { buf.lat = parseFloat(latMatch[1]); return; }

  const lonMatch = line.match(/LONGITUDE\s*:\s*([-\d.]+)/i);
  if (lonMatch) { buf.lon = parseFloat(lonMatch[1]); }

  if (/PROHIBITED|NEEDS HELP/i.test(line)) lastStatus = 'violation';
  else if (/SAFE/i.test(line)) lastStatus = 'safe';

  if (buf.lat !== null && buf.lon !== null) {
    sendToServer(buf.lat, buf.lon, lastStatus);
    buf = { lat: null, lon: null };
    lastStatus = 'safe';
  }
}

function connect() {
  console.log(`🔌 Inaunganika na ${SERIAL_PORT}...`);
  try {
    const port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    port.on('open', () => console.log(`✅ ${SERIAL_PORT} imefunguliwa!`));
    parser.on('data', processLine);
    port.on('error', (err) => { console.log(`❌ ${err.message}`); setTimeout(connect, 5000); });
    port.on('close', () => { console.log('Serial imefungwa'); setTimeout(connect, 5000); });
  } catch (err) {
    console.log(`❌ ${err.message}`);
    setTimeout(connect, 5000);
  }
}

console.log('╔══════════════════════════════════════════╗');
console.log('║   FORWARDER - Laptop → Internet          ║');
console.log(`║   Inatuma kwa: ${SERVER_URL.slice(0,30)}...║`);
console.log('╚══════════════════════════════════════════╝\n');
connect();
