const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const testDatabase = `petcare_change11_csv_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
const baseUrl = 'http://localhost:3000';
let connection;
let created = false;
let server;
let output = '';

function cookies(response) {
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return values.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
}

async function request(url, options = {}) {
  return fetch(`${baseUrl}${url}`, { redirect: 'manual', ...options });
}

async function login(username, password) {
  const response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
  });
  assert.equal(response.status, 302);
  assert.notEqual(response.headers.get('location'), '/login');
  return cookies(response);
}

async function assertPortAvailable() {
  for (const host of ['127.0.0.1', '::1']) {
    const occupied = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port: 3000 });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (occupied) throw new Error(`Port 3000 is already occupied on ${host}; refusing to start the test server.`);
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen({ host, port: 3000, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolve()));
    });
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await request('/')).status === 200) return;
    } catch {
      // The spawned process may still be loading its database pool.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start: ${output}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const exited = await new Promise((resolve) => {
      const onExit = () => { clearTimeout(timeout); resolve(true); };
      const timeout = setTimeout(() => { server.removeListener('exit', onExit); resolve(false); }, 5000);
      server.once('exit', onExit);
      try {
        if (!server.kill(signal)) { clearTimeout(timeout); server.removeListener('exit', onExit); resolve(false); }
      } catch {
        clearTimeout(timeout); server.removeListener('exit', onExit); resolve(false);
      }
    });
    if (exited || server.exitCode !== null) return;
  }
  throw new Error('Spawned test server did not terminate');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = text.charCodeAt(0) === 0xFEFF ? 1 : 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; } else if (character === '"') quoted = false; else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\r' && text[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index += 1; }
    else cell += character;
  }
  return rows;
}

async function exportCsv(url, cookie) {
  const response = await request(url, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="pet-care-journal.csv"');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  return parseCsv(bytes.toString('utf8'));
}

async function main() {
  await assertPortAvailable();
  connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
  await connection.query(`CREATE DATABASE \`${testDatabase}\``);
  created = true;
  await connection.query(`USE \`${testDatabase}\``);
  await connection.query(`
    CREATE TABLE users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password CHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, role ENUM('admin','user') NOT NULL DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
    CREATE TABLE pets (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_id INT UNSIGNED NOT NULL, name VARCHAR(80) NOT NULL, species VARCHAR(50) NOT NULL, breed VARCHAR(80) NOT NULL, age TINYINT UNSIGNED NOT NULL, image VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB;
    CREATE TABLE journal (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pet_id INT UNSIGNED NOT NULL, activity VARCHAR(120) NOT NULL, notes TEXT, entry_date DATE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE) ENGINE=InnoDB;
    INSERT INTO users (username, password, name, role) VALUES ('csv_admin', SHA2('admin123',256), 'CSV Admin', 'admin'), ('csv_owner', SHA2('user123',256), 'CSV Owner', 'user'), ('csv_other', SHA2('other123',256), 'CSV Other', 'user');
    INSERT INTO pets (owner_id, name, species, breed, age, image) VALUES (2, 'Owner One', 'Dog', 'Retriever', 5, 'owner-one.jpg'), (2, 'Owner Two', 'Cat', 'Tabby', 3, 'owner-two.jpg'), (3, 'Other Pet', 'Bird', 'Parrot', 2, 'other.jpg');
    INSERT INTO journal (pet_id, activity, notes, entry_date) VALUES (1, 'Walk', 'Comma, "quote"\nUnicode 😀', '2026-01-05'), (1, '=2+2', ' \t@cmd', '2026-01-15'), (2, '-10', CONCAT(CHAR(1), '+COMMAND'), '2026-01-15'), (2, 'Grooming', '', '2026-01-31'), (3, 'Secret Other Activity', 'Must not leak', '2026-01-15');
  `);
  server = spawn(process.execPath, ['app.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change11-test-secret', TZ: 'Asia/Singapore' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  await waitForServer();

  let response = await request('/journals/export');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');

  const owner = await login('csv_owner', 'user123');
  let rows = await exportCsv('/journals/export', owner);
  assert.deepEqual(rows[0], ['Pet Name', 'Entry Date', 'Activity', 'Notes']);
  assert.equal(rows.length, 5);
  assert.equal(rows.some((row) => row.includes('Secret Other Activity')), false);
  assert.deepEqual(rows[1], ['Owner One', '2026-01-05', 'Walk', 'Comma, "quote"\nUnicode 😀']);
  assert.deepEqual(rows[2], ['Owner One', '2026-01-15', "'=2+2", "' \t@cmd"]);
  assert.deepEqual(rows[3], ['Owner Two', '2026-01-15', "'-10", "'\u0001+COMMAND"]);

  response = await request('/journals?petId=1&startDate=2026-01-15&endDate=2026-01-15', { headers: { cookie: owner } });
  let page = await response.text();
  assert.match(page, /<td>\s*2026-01-15\s*<\/td>/);
  assert.doesNotMatch(page, /2026-01-14/);

  rows = await exportCsv('/journals/export?petId=1', owner);
  assert.equal(rows.length, 3);
  assert.equal(rows.slice(1).every((row) => row[0] === 'Owner One'), true);
  rows = await exportCsv('/journals/export?startDate=2026-01-15', owner);
  assert.equal(rows.length, 4);
  assert.equal(rows.some((row) => row[2] === 'Walk'), false);
  rows = await exportCsv('/journals/export?endDate=2026-01-15', owner);
  assert.equal(rows.length, 4);
  rows = await exportCsv('/journals/export?startDate=2026-01-15&endDate=2026-01-15', owner);
  assert.equal(rows.length, 3);
  rows = await exportCsv('/journals/export?petId=2&startDate=2026-01-15&endDate=2026-01-15', owner);
  assert.deepEqual(rows, [['Pet Name', 'Entry Date', 'Activity', 'Notes'], ['Owner Two', '2026-01-15', "'-10", "'\u0001+COMMAND"]]);
  rows = await exportCsv('/journals/export?petId=3', owner);
  assert.deepEqual(rows, [['Pet Name', 'Entry Date', 'Activity', 'Notes']]);
  rows = await exportCsv('/journals/export?startDate=2026-02-01', owner);
  assert.deepEqual(rows, [['Pet Name', 'Entry Date', 'Activity', 'Notes']]);

  for (const url of ['/journals/export?startDate=2026-02-30', '/journals/export?endDate=2026-1-15', '/journals/export?startDate=2026-01-31&endDate=2026-01-15', '/journals/export?startDate=2026-01-15&startDate=2026-01-16', '/journals/export?petId=1.5', '/journals/export?petId=-1', '/journals/export?petId=0x1', '/journals/export?petId=1e0', '/journals/export?petId=1.0', '/journals/export?petId=1&petId=2']) {
    response = await request(url, { headers: { cookie: owner } });
    assert.equal(response.status, 400);
    assert.equal(await response.text(), 'Invalid journal export filters.');
  }

  response = await request('/journals?petId=2&startDate=2026-01-15&endDate=2026-01-15', { headers: { cookie: owner } });
  page = await response.text();
  assert.match(page, /href="\/journals\/export\?petId=2&amp;startDate=2026-01-15&amp;endDate=2026-01-15"/);
  assert.match(page, /-10/);
  response = await request('/journals/search?q=Walk&petId=1', { headers: { cookie: owner } });
  assert.match(await response.text(), /Walk/);
  response = await request('/pets/new', { headers: { cookie: owner } });
  assert.equal(response.status, 200);
  const admin = await login('csv_admin', 'admin123');
  response = await request('/admin/dashboard', { headers: { cookie: admin } });
  assert.equal(response.status, 200);
  console.log('PASS: Change 11 isolated CSV export integration checks');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await stopServer(); } catch (error) { console.error(error); process.exitCode = 1; }
  if (connection && created) { try { await connection.query(`DROP DATABASE \`${testDatabase}\``); } catch (error) { console.error(error); process.exitCode = 1; } }
  if (connection) await connection.end();
});
