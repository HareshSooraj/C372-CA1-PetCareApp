const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const testDatabase = `petcare_change8_booking_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
const baseUrl = 'http://localhost:3000';
let connection;
let databaseCreated = false;
let server;
let serverOutput = '';

function localDate(offsetDays = 0) {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  local.setDate(local.getDate() + offsetDays);
  return local.toISOString().slice(0, 10);
}

function cookie(response) {
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return cookies.filter(Boolean).map((item) => item.split(';')[0]).join('; ');
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, { redirect: 'manual', ...options });
}

async function login(username, password) {
  const response = await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `username=${username}&password=${password}` });
  return { response, cookie: cookie(response) };
}

async function assertPortIsAvailable() {
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', (error) => reject(new Error(`Port 3000 is unavailable on ${host}; test aborted safely. (${error.code})`)));
      probe.listen({ host, port: 3000, exclusive: true }, () => probe.close((error) => (error ? reject(error) : resolve())));
    });
  }
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { if ((await request('/')).status === 200) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The test server did not start. ${serverOutput || lastError || ''}`);
}

async function signalServerAndWait(signal) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return true;
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => { server.removeListener('exit', onExit); resolve(false); }, 5000);
    const onExit = () => { clearTimeout(timer); resolve(true); };
    server.once('exit', onExit);
    try { if (!server.kill(signal) && server.exitCode === null) { clearTimeout(timer); server.removeListener('exit', onExit); resolve(false); } } catch { clearTimeout(timer); server.removeListener('exit', onExit); resolve(false); }
  });
  return exited || server.exitCode !== null || server.signalCode !== null;
}

async function stopServer() {
  if (await signalServerAndWait('SIGTERM')) return;
  if (await signalServerAndWait('SIGKILL')) return;
  throw new Error('The spawned test server did not terminate.');
}

async function count(table) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
  return rows[0].count;
}

async function book(userCookie, petId, serviceId, bookingDate) {
  return request('/services/book', { method: 'POST', headers: { cookie: userCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: `petId=${petId}&serviceId=${serviceId}&bookingDate=${bookingDate}` });
}

async function main() {
  await assertPortIsAvailable();
  connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
  await connection.query(`CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databaseCreated = true;
  await connection.query(`USE \`${testDatabase}\``);
  await connection.query("CREATE TABLE users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password CHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, role ENUM('admin','user') NOT NULL DEFAULT 'user', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB; CREATE TABLE pets (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_id INT UNSIGNED NOT NULL, name VARCHAR(80) NOT NULL, species VARCHAR(50) NOT NULL, breed VARCHAR(80) NOT NULL, age TINYINT UNSIGNED NOT NULL, image VARCHAR(255) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_pets_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB; CREATE TABLE journal (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pet_id INT UNSIGNED NOT NULL, activity VARCHAR(120) NOT NULL, notes TEXT NULL, entry_date DATE NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_journal_pet FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE) ENGINE=InnoDB");
  const extension = (await fs.readFile(path.resolve(__dirname, '..', 'ca1_references', 'db-lesson08-extension.sql'), 'utf8')).replace('USE petcare;', `USE \`${testDatabase}\`;`);
  await connection.query(extension);
  await connection.query("INSERT INTO users (username,password,name,role) VALUES ('booking_admin',SHA2('admin123',256),'Booking Admin','admin'),('booking_owner',SHA2('user123',256),'Booking Owner','user'),('booking_other',SHA2('other123',256),'Booking Other','user'); INSERT INTO pets (owner_id,name,species,breed,age) VALUES (2,'Owner Pet','Dog','Mixed',3),(3,'Other Pet','Cat','Mixed',4); INSERT INTO journal (pet_id,activity,notes,entry_date) VALUES (1,'Booking regression','Keep journal working',CURDATE())");

  server = spawn(process.execPath, ['app.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change8-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();

  for (const [method, url] of [['GET', '/services'], ['POST', '/services/book'], ['GET', '/bookings']]) {
    const response = await request(url, { method });
    assert.equal(response.status, 302, `AC8 ${method} ${url}`);
    assert.equal(response.headers.get('location'), '/login');
  }

  const owner = await login('booking_owner', 'user123');
  assert.equal(owner.response.headers.get('location'), '/journals');
  let response = await request('/services', { headers: { cookie: owner.cookie } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Basic Bath/);
  response = await request('/bookings', { headers: { cookie: owner.cookie } });
  assert.match(await response.text(), /You have no bookings yet/);

  const today = localDate();
  response = await book(owner.cookie, 1, 1, today);
  assert.equal(response.status, 302, 'AC1 booking redirect');
  assert.equal(response.headers.get('location'), '/bookings');
  const [firstBooking] = await connection.query('SELECT * FROM service_bookings WHERE pet_id = 1 AND service_id = 1');
  assert.equal(firstBooking.length, 1);
  assert.equal(firstBooking[0].booking_status, 'pending');
  assert.equal(Number(firstBooking[0].booked_price), 25);
  const [firstPayment] = await connection.query('SELECT * FROM payments WHERE booking_id = ?', [firstBooking[0].id]);
  assert.equal(firstPayment.length, 1);
  assert.equal(firstPayment[0].payment_status, 'pending');
  assert.equal(Number(firstPayment[0].amount), 25);
  response = await request('/bookings', { headers: { cookie: owner.cookie } });
  const firstHistory = await response.text();
  assert.match(firstHistory, /Booking created\. Payment is pending; no payment has been processed\./);
  assert.match(firstHistory, /Owner Pet/);

  response = await book(owner.cookie, 1, 3, localDate(1));
  assert.equal(response.status, 302, 'AC2 future date');
  const stableBookingCount = await count('service_bookings');
  const stablePaymentCount = await count('payments');
  for (const body of [`petId=&serviceId=1&bookingDate=${today}`, `petId=1.5&serviceId=1&bookingDate=${today}`, `petId=1&serviceId=0&bookingDate=${today}`, `petId=1&serviceId=1&bookingDate=2026-02-30`, `petId=1&serviceId=1&bookingDate=not-a-date`, `petId=1&serviceId=1&bookingDate=${localDate(-1)}`]) {
    response = await request('/services/book', { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body });
    assert.equal(response.headers.get('location'), '/services', 'AC3 invalid form redirect');
  }
  assert.equal(await count('service_bookings'), stableBookingCount);
  assert.equal(await count('payments'), stablePaymentCount);
  response = await request('/services', { headers: { cookie: owner.cookie } });
  assert.match(await response.text(), /Choose a pet, service, and valid booking date\./);

  response = await book(owner.cookie, 2, 1, today);
  assert.equal(response.headers.get('location'), '/services', 'AC4 foreign pet');
  response = await request('/services', { headers: { cookie: owner.cookie } });
  assert.match(await response.text(), /That pet or service is unavailable for booking\./);
  assert.equal(await count('service_bookings'), stableBookingCount);
  response = await book(owner.cookie, 1, 999, today);
  assert.equal(response.headers.get('location'), '/services', 'AC5 unknown service');
  await connection.query('UPDATE services SET is_active = 0 WHERE id = 2');
  response = await book(owner.cookie, 1, 2, today);
  assert.equal(response.headers.get('location'), '/services', 'AC5 inactive service');
  assert.equal(await count('service_bookings'), stableBookingCount);

  await connection.query("CREATE TRIGGER fail_change8_payment BEFORE INSERT ON payments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced payment failure'");
  response = await book(owner.cookie, 1, 1, today);
  assert.equal(response.headers.get('location'), '/services', 'AC6 database failure redirect');
  assert.equal(await count('service_bookings'), stableBookingCount, 'AC6 rollback booking');
  assert.equal(await count('payments'), stablePaymentCount, 'AC6 rollback payment');
  response = await request('/services', { headers: { cookie: owner.cookie } });
  assert.match(await response.text(), /Unable to create the booking\. Please try again\./);
  await connection.query('DROP TRIGGER fail_change8_payment');

  const other = await login('booking_other', 'other123');
  response = await book(other.cookie, 2, 1, today);
  assert.equal(response.headers.get('location'), '/bookings');
  response = await request('/bookings', { headers: { cookie: owner.cookie } });
  const ownerHistory = await response.text();
  assert.doesNotMatch(ownerHistory, /Other Pet/);
  assert.ok(ownerHistory.indexOf('Boarding') < ownerHistory.indexOf('Basic Bath'), 'AC7 history should be newest-first by booking ID when timestamps match');
  response = await request('/bookings', { headers: { cookie: other.cookie } });
  assert.match(await response.text(), /Other Pet/);

  response = await request('/payments/prepare/1?amount=1');
  assert.deepEqual(await response.json(), { serviceId: 1, serviceName: 'Vaccination', amount: 35, currency: 'sgd', status: 'READY_FOR_PAYMENT' });
  response = await request('/journals', { headers: { cookie: owner.cookie } });
  assert.match(await response.text(), /Booking regression/);
  response = await request('/pets/new', { headers: { cookie: owner.cookie } });
  assert.equal(response.status, 200);
  const admin = await login('booking_admin', 'admin123');
  response = await request('/admin/dashboard', { headers: { cookie: admin.cookie } });
  assert.equal(response.status, 200);

  console.log('PASS: Change 8 isolated service-booking integration checks');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await stopServer(); } catch (error) { console.error('Test server cleanup failed:', error); process.exitCode = 1; }
  if (connection && databaseCreated) { try { await connection.query(`DROP DATABASE \`${testDatabase}\``); } catch (error) { console.error('Test database cleanup failed:', error); process.exitCode = 1; } }
  if (connection) await connection.end();
});
