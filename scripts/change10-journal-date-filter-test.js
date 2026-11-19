const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const testDatabase = `petcare_change10_dates_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
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
  assert.notEqual(response.headers.get('location'), '/login', `Login failed for ${username}`);
  const sessionCookie = cookies(response);
  assert.ok(sessionCookie, `Login did not issue a session cookie for ${username}`);
  return sessionCookie;
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
      const timeout = setTimeout(() => {
        server.removeListener('exit', onExit);
        resolve(false);
      }, 5000);
      server.once('exit', onExit);
      try {
        if (!server.kill(signal)) {
          clearTimeout(timeout);
          server.removeListener('exit', onExit);
          resolve(false);
        }
      } catch {
        clearTimeout(timeout);
        server.removeListener('exit', onExit);
        resolve(false);
      }
    });
    if (exited || server.exitCode !== null) return;
  }
  throw new Error('Spawned test server did not terminate');
}

async function page(url, cookie) {
  const response = await request(url, { headers: { cookie } });
  assert.equal(response.status, 200, `${url} should load`);
  return response.text();
}

async function main() {
  await assertPortAvailable();
  connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true
  });

  await connection.query(`CREATE DATABASE \`${testDatabase}\``);
  created = true;
  await connection.query(`USE \`${testDatabase}\``);
  await connection.query(`
    CREATE TABLE users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password CHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, role ENUM('admin','user') NOT NULL DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
    CREATE TABLE pets (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_id INT UNSIGNED NOT NULL, name VARCHAR(80) NOT NULL, species VARCHAR(50) NOT NULL, breed VARCHAR(80) NOT NULL, age TINYINT UNSIGNED NOT NULL, image VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB;
    CREATE TABLE journal (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pet_id INT UNSIGNED NOT NULL, activity VARCHAR(120) NOT NULL, notes TEXT, entry_date DATE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE) ENGINE=InnoDB;
    INSERT INTO users (username, password, name, role) VALUES ('date_admin', SHA2('admin123',256), 'Date Admin', 'admin'), ('date_owner', SHA2('user123',256), 'Date Owner', 'user'), ('date_other', SHA2('other123',256), 'Date Other', 'user');
    INSERT INTO pets (owner_id, name, species, breed, age, image) VALUES (2, 'Owner One', 'Dog', 'Retriever', 5, 'owner-one.jpg'), (2, 'Owner Two', 'Cat', 'Tabby', 3, 'owner-two.jpg'), (3, 'Other Pet', 'Bird', 'Parrot', 2, 'other.jpg');
    INSERT INTO journal (pet_id, activity, notes, entry_date) VALUES (1, 'Walk', 'Early boundary', '2026-01-05'), (1, 'Vet Visit', 'Inclusive boundary', '2026-01-15'), (1, 'Grooming', 'Late boundary', '2026-01-31'), (2, 'Second Pet Activity', 'Owner second pet', '2026-01-15'), (3, 'Secret Other Activity', 'Must not leak', '2026-01-15');
  `);

  server = spawn(process.execPath, ['app.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change10-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  await waitForServer();

  let response = await request('/journals');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');

  const owner = await login('date_owner', 'user123');
  let body = await page('/journals', owner);
  assert.match(body, /Walk/);
  assert.match(body, /Vet Visit/);
  assert.match(body, /Grooming/);
  assert.match(body, /Second Pet Activity/);
  assert.doesNotMatch(body, /Secret Other Activity/);

  body = await page('/journals?startDate=2026-01-15&endDate=2026-01-15', owner);
  assert.match(body, /Vet Visit/);
  assert.match(body, /Second Pet Activity/);
  assert.doesNotMatch(body, />Walk</);
  assert.doesNotMatch(body, /Grooming/);
  assert.doesNotMatch(body, /Secret Other Activity/);
  assert.match(body, /<option value="" selected>-- All Pets --<\/option>/);
  assert.match(body, /href="\/journals" class="btn btn-outline-secondary">Clear Filters<\/a>/);

  body = await page('/journals?petId=', owner);
  assert.match(body, /Walk/);
  assert.match(body, /Second Pet Activity/);
  assert.doesNotMatch(body, /Secret Other Activity/);

  body = await page('/journals?startDate=2026-01-15', owner);
  assert.match(body, /name="startDate" value="2026-01-15"/);
  assert.doesNotMatch(body, />Walk</);
  assert.match(body, /Vet Visit/);
  assert.match(body, /Grooming/);
  assert.match(body, /Second Pet Activity/);
  assert.doesNotMatch(body, /Secret Other Activity/);

  body = await page('/journals?petId=1&endDate=2026-01-15', owner);
  assert.match(body, /Walk/);
  assert.match(body, /Vet Visit/);
  assert.doesNotMatch(body, /Grooming/);
  assert.match(body, /Owner One/);
  assert.match(body, /href="\/pets\/1\/edit"/);
  assert.match(body, /href="\/journals\?petId=1" class="btn btn-outline-secondary">Clear Filters<\/a>/);

  body = await page('/journals?petId=1&startDate=2026-01-15&endDate=2026-01-15', owner);
  assert.match(body, /Vet Visit/);
  assert.doesNotMatch(body, />Walk</);
  assert.doesNotMatch(body, /Grooming/);

  body = await page('/journals?petId=2&startDate=2026-01-15&endDate=2026-01-15', owner);
  assert.match(body, /Second Pet Activity/);
  assert.doesNotMatch(body, /Vet Visit/);

  for (const url of [
    '/journals?petId=1&startDate=2026-02-30',
    '/journals?petId=1&endDate=2026-1-15',
    '/journals?petId=1&startDate=2026-01-31&endDate=2026-01-15'
  ]) {
    body = await page(url, owner);
    assert.match(body, /Provide valid start and end dates\./);
    assert.match(body, /No journal entries found\./);
  }

  body = await page('/journals?petId=1&startDate=2026-02-01', owner);
  assert.match(body, /No journal entries found\./);

  body = await page('/journals?petId=3&startDate=2026-01-01&endDate=2026-01-31', owner);
  assert.doesNotMatch(body, /Secret Other Activity/);
  assert.match(body, /No journal entries found\./);

  body = await page('/journals/search?q=Vet&petId=1', owner);
  assert.match(body, /Vet Visit/);
  assert.doesNotMatch(body, /Secret Other Activity/);

  response = await request('/payments/prepare/2?amount=1');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { serviceId: 2, serviceName: 'Pet Grooming', amount: 50, currency: 'sgd', status: 'READY_FOR_PAYMENT' });
  response = await request('/pets/new', { headers: { cookie: owner } });
  assert.equal(response.status, 200);
  const admin = await login('date_admin', 'admin123');
  response = await request('/admin/dashboard', { headers: { cookie: admin } });
  assert.equal(response.status, 200);

  console.log('PASS: Change 10 isolated journal date-filter integration checks');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    try { await stopServer(); } catch (error) { console.error(error); process.exitCode = 1; }
    if (connection && created) {
      try { await connection.query(`DROP DATABASE \`${testDatabase}\``); } catch (error) { console.error(error); process.exitCode = 1; }
    }
    if (connection) await connection.end();
  });
