const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const testDatabase = `petcare_change7_payment_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
const baseUrl = 'http://localhost:3000';
let adminConnection;
let databaseCreated = false;
let server;
let serverOutput = '';

function getCookie(response) {
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return cookies.filter(Boolean).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function query(sql, values = []) {
  return adminConnection.query(sql, values);
}

async function assertPortIsAvailable() {
  async function probe(host) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', (error) => reject(new Error(`Port 3000 is unavailable on ${host}; test aborted safely. (${error.code})`)));
      probe.listen({ host, port: 3000, exclusive: true }, () => {
        probe.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }

  await probe('127.0.0.1');
  await probe('::1');
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The test server did not start. ${serverOutput || lastError || ''}`);
}

async function signalServerAndWait(signal, timeoutMs) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return true;
  const exited = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    server.once('exit', onExit);
    try {
      const signalSent = server.kill(signal);
      if (!signalSent && server.exitCode === null && server.signalCode === null) {
        clearTimeout(timeout);
        server.removeListener('exit', onExit);
        resolve(false);
      }
    } catch (error) {
      clearTimeout(timeout);
      server.removeListener('exit', onExit);
      resolve(false);
    }
  });
  return exited || server.exitCode !== null || server.signalCode !== null;
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  if (await signalServerAndWait('SIGTERM', 5000)) return;
  if (await signalServerAndWait('SIGKILL', 5000)) return;
  throw new Error('The spawned test server did not terminate after SIGTERM and SIGKILL.');
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, { redirect: 'manual', ...options });
}

async function login(username, password) {
  const response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${username}&password=${password}`
  });
  return { response, cookie: getCookie(response) };
}

async function main() {
  await assertPortIsAvailable();
  adminConnection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  await query(`CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databaseCreated = true;
  await query(`USE \`${testDatabase}\``);
  await query('CREATE TABLE users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password CHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, role ENUM(\'admin\', \'user\') NOT NULL DEFAULT \'user\', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
  await query('CREATE TABLE pets (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_id INT UNSIGNED NOT NULL, name VARCHAR(80) NOT NULL, species VARCHAR(50) NOT NULL, breed VARCHAR(80) NOT NULL, age TINYINT UNSIGNED NOT NULL, image VARCHAR(255) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_pets_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB');
  await query('CREATE TABLE journal (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pet_id INT UNSIGNED NOT NULL, activity VARCHAR(120) NOT NULL, notes TEXT NULL, entry_date DATE NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_journal_pet FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE) ENGINE=InnoDB');
  await query("INSERT INTO users (username, password, name, role) VALUES ('payment_admin', SHA2('admin123', 256), 'Payment Admin', 'admin'), ('payment_user', SHA2('user123', 256), 'Payment User', 'user')");
  await query("INSERT INTO pets (owner_id, name, species, breed, age) VALUES (2, 'Payment Pet', 'Dog', 'Mixed', 3)");
  await query("INSERT INTO journal (pet_id, activity, notes, entry_date) VALUES (1, 'Payment regression', 'Journal regression check', '2026-11-20')");

  server = spawn(process.execPath, ['app.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change7-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();

  const expectedServices = [
    [1, 'Vaccination', 35],
    [2, 'Pet Grooming', 50],
    [3, 'Boarding', 80]
  ];
  for (const [serviceId, serviceName, amount] of expectedServices) {
    const response = await request(`/payments/prepare/${serviceId}`);
    assert.equal(response.status, 200, `Service ${serviceId} should prepare`);
    const body = await response.json();
    assert.deepEqual(body, { serviceId, serviceName, amount, currency: 'sgd', status: 'READY_FOR_PAYMENT' });
    assert.equal(Object.keys(body).length, 5, 'Prepare response must have exactly five fields');
  }

  let response = await request('/payments/prepare/1?amount=1');
  assert.equal((await response.json()).amount, 35, 'Client query amount must be ignored');
  response = await request('/payments/prepare/999');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Service not found' });

  for (const [testStatus, bookingStatus] of [['APPROVED', 'CONFIRMED'], ['PENDING', 'AWAITING_PAYMENT'], ['DECLINED', 'PAYMENT_FAILED']]) {
    response = await request('/payments/mock/2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ testStatus, amount: 1 })
    });
    assert.equal(response.status, 200, `${testStatus} mock payment should succeed`);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['serviceId', 'providerPaymentId', 'merchantReference', 'paymentStatus', 'bookingStatus']);
    assert.equal(body.serviceId, 2);
    assert.match(body.providerPaymentId, /^mock_\d+$/);
    assert.equal(body.merchantReference, 'SERVICE-2');
    assert.equal(body.paymentStatus, testStatus);
    assert.equal(body.bookingStatus, bookingStatus);
  }

  response = await request('/payments/mock/2', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paymentStatus, 'PENDING', 'Omitted testStatus must default to PENDING');
  response = await request('/payments/mock/999', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ testStatus: 'PENDING' })
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Service not found' });
  response = await request('/payments/mock/2', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{invalid json'
  });
  assert.equal(response.status, 400, 'Malformed JSON must be rejected safely by the JSON parser');

  response = await request('/journals');
  assert.equal(response.status, 302, 'Authentication regression route should still redirect');
  const userLogin = await login('payment_user', 'user123');
  assert.equal(userLogin.response.headers.get('location'), '/journals');
  response = await request('/journals', { headers: { cookie: userLogin.cookie } });
  assert.equal(response.status, 200, 'Journal regression route should still load');
  assert.match(await response.text(), /Payment regression/);
  response = await request('/pets/new', { headers: { cookie: userLogin.cookie } });
  assert.equal(response.status, 200, 'Pet regression route should still load');
  const adminLogin = await login('payment_admin', 'admin123');
  assert.equal(adminLogin.response.headers.get('location'), '/admin/dashboard');
  response = await request('/admin/dashboard', { headers: { cookie: adminLogin.cookie } });
  assert.equal(response.status, 200, 'Administrator regression route should still load');

  console.log('PASS: Change 7 isolated payment API integration checks');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await stopServer();
  } catch (error) {
    console.error('Test server cleanup failed:', error);
    process.exitCode = 1;
  }
  if (adminConnection && databaseCreated) {
    try {
      await query(`DROP DATABASE \`${testDatabase}\``);
    } catch (error) {
      console.error('Test database cleanup failed:', error);
      process.exitCode = 1;
    }
  }
  if (adminConnection) await adminConnection.end();
});
