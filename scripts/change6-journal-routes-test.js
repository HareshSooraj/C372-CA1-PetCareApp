const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const testDatabase = `petcare_change6_journal_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
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
  await query("INSERT INTO users (username, password, name, role) VALUES ('journal_admin', SHA2('admin123', 256), 'Journal Admin', 'admin'), ('journal_owner', SHA2('user123', 256), 'Journal Owner', 'user'), ('journal_other', SHA2('other123', 256), 'Journal Other', 'user')");
  await query("INSERT INTO pets (owner_id, name, species, breed, age) VALUES (2, 'Owner Pet One', 'Dog', 'Mixed', 3), (2, 'Owner Pet Two', 'Cat', 'Mixed', 4), (3, 'Other Pet', 'Dog', 'Mixed', 5)");
  await query("INSERT INTO journal (pet_id, activity, notes, entry_date) VALUES (1, 'Owner Walk', 'Owner-only note', '2026-11-20'), (3, 'Other Secret', 'Other-only note', '2026-11-20')");

  server = spawn(process.execPath, ['app.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change6-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();

  let response = await request('/journals');
  assert.equal(response.status, 302, 'Signed-out journal listing should redirect');
  assert.equal(response.headers.get('location'), '/login');

  const ownerLogin = await login('journal_owner', 'user123');
  assert.equal(ownerLogin.response.headers.get('location'), '/journals');
  assert.ok(ownerLogin.cookie, 'Journal owner login should create a session');

  response = await request('/journals', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 200, 'Journal listing should load');
  const listing = await response.text();
  assert.match(listing, /Owner Walk/);
  assert.doesNotMatch(listing, /Other Secret/);

  response = await request('/journals?petId=2', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 200, 'Owned-pet journal filtering should load');
  assert.match(await response.text(), /Owner Pet Two/);
  response = await request('/journals?petId=3', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 200, 'Foreign-pet filtering should be handled safely');
  assert.doesNotMatch(await response.text(), /Other Secret/);

  response = await request('/journals/new?petId=2', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 200, 'New journal form should load');
  response = await request('/journals/new', {
    method: 'POST',
    headers: { cookie: ownerLogin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'pet_id=2&activity=Created+Entry&notes=Created+note&entry_date=2026-11-20'
  });
  assert.equal(response.status, 302, 'Owner journal creation should redirect');
  assert.equal(response.headers.get('location'), '/journals?petId=2');
  const [createdRows] = await query("SELECT id, pet_id FROM journal WHERE activity = 'Created Entry'");
  assert.equal(createdRows.length, 1, 'Owner journal creation should insert one row');
  assert.equal(createdRows[0].pet_id, 2, 'Created journal must belong to an owned pet');

  response = await request('/journals/new', {
    method: 'POST',
    headers: { cookie: ownerLogin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'pet_id=3&activity=Bad+Entry&notes=Nope&entry_date=2026-11-20'
  });
  assert.equal(response.status, 200, 'Foreign-pet journal creation should be rejected');
  assert.match(await response.text(), /Error saving journal/);

  response = await request('/journals/edit/1', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 200, 'Owner journal edit form should load');
  response = await request('/journals/edit/2', { headers: { cookie: ownerLogin.cookie } });
  assert.match(await response.text(), /Journal not found/);
  response = await request('/journals/edit/not-a-number', { headers: { cookie: ownerLogin.cookie } });
  assert.match(await response.text(), /Journal not found/);

  response = await request('/journals/edit/2', {
    method: 'POST',
    headers: { cookie: ownerLogin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'pet_id=1&activity=Tampered&notes=Nope&entry_date=2026-11-20'
  });
  assert.match(await response.text(), /Journal not found/);
  const [otherRows] = await query('SELECT activity FROM journal WHERE id = 2');
  assert.equal(otherRows[0].activity, 'Other Secret', 'Foreign journal update must not change data');

  response = await request('/journals/edit/1', {
    method: 'POST',
    headers: { cookie: ownerLogin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'pet_id=2&activity=Updated+Owner+Entry&notes=Updated+note&entry_date=2026-11-20'
  });
  assert.equal(response.status, 302, 'Owner journal update should redirect');
  assert.equal(response.headers.get('location'), '/journals?petId=2');
  const [updatedRows] = await query('SELECT pet_id, activity FROM journal WHERE id = 1');
  assert.equal(updatedRows[0].pet_id, 2);
  assert.equal(updatedRows[0].activity, 'Updated Owner Entry');

  response = await request('/journals/edit/1', {
    method: 'POST',
    headers: { cookie: ownerLogin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'pet_id=999&activity=Invalid+Pet&notes=Nope&entry_date=2026-11-20'
  });
  assert.match(await response.text(), /Journal not found/);

  response = await request('/journals/search?q=Updated&petId=2', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 200, 'Journal search should load');
  assert.match(await response.text(), /Updated Owner Entry/);
  response = await request('/journals/search?q=Secret&petId=3', { headers: { cookie: ownerLogin.cookie } });
  assert.doesNotMatch(await response.text(), /Other Secret/);

  response = await request('/journals/delete/2', { headers: { cookie: ownerLogin.cookie } });
  assert.match(await response.text(), /Journal not found\./);
  const [foreignAfterDelete] = await query('SELECT COUNT(*) AS count FROM journal WHERE id = 2');
  assert.equal(foreignAfterDelete[0].count, 1, 'Foreign journal deletion must not remove data');
  response = await request('/journals/delete/not-a-number', { headers: { cookie: ownerLogin.cookie } });
  assert.match(await response.text(), /Journal not found\./);
  response = await request('/journals/delete/1', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 302, 'Owner journal deletion should redirect');
  assert.equal(response.headers.get('location'), '/journals?petId=2');
  const [deletedRows] = await query('SELECT COUNT(*) AS count FROM journal WHERE id = 1');
  assert.equal(deletedRows[0].count, 0, 'Owner journal deletion should remove the row');

  response = await request('/pets/new', { headers: { cookie: ownerLogin.cookie } });
  assert.equal(response.status, 200, 'Pet regression route should still load');
  const adminLogin = await login('journal_admin', 'admin123');
  assert.equal(adminLogin.response.headers.get('location'), '/admin/dashboard');
  response = await request('/admin/dashboard', { headers: { cookie: adminLogin.cookie } });
  assert.equal(response.status, 200, 'Administrator regression route should still load');
  response = await request('/admin/users/2', { headers: { cookie: adminLogin.cookie } });
  assert.equal(response.status, 200, 'Administrator user-details route should retain journal-model access');

  console.log('PASS: Change 6 isolated journal MVC integration checks');
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
