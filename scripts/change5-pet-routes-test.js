const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const testDatabase = `petcare_change5_pet_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
const imageDirectory = path.resolve(__dirname, '..', 'public', 'images');
const uploadOriginalName = `ca1_pet_route_test_${Date.now()}.jpg`;
const rejectedUploadOriginalName = `ca1_pet_route_rejected_${Date.now()}.jpg`;
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

async function cleanUploadArtifacts() {
  const fileNames = await fs.readdir(imageDirectory);
  const suffixes = [`_${uploadOriginalName}`, `_${rejectedUploadOriginalName}`];
  await Promise.all(fileNames.filter((fileName) => suffixes.some((suffix) => fileName.endsWith(suffix))).map(async (fileName) => {
    const filePath = path.resolve(imageDirectory, fileName);
    assert.equal(path.dirname(filePath), imageDirectory, 'Upload cleanup path must stay in public/images');
    await fs.unlink(filePath);
  }));
}

function createPetForm(originalName) {
  const form = new FormData();
  form.append('pet_name', 'New Route Pet');
  form.append('species', 'Cat');
  form.append('breed', 'Domestic Short Hair');
  form.append('age', '2');
  form.append('pet_image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), originalName);
  return form;
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
  await query("INSERT INTO users (username, password, name, role) VALUES ('pet_admin', SHA2('admin123', 256), 'Pet Admin', 'admin'), ('pet_user', SHA2('user123', 256), 'Pet User', 'user')");
  await query("INSERT INTO pets (owner_id, name, species, breed, age) VALUES (2, 'Existing Pet', 'Dog', 'Mixed', 3)");
  await query("INSERT INTO journal (pet_id, activity, notes, entry_date) VALUES (1, 'Regression walk', 'Journal regression check', '2026-11-20')");

  server = spawn(process.execPath, ['app.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change5-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();

  let response = await request('/pets/new');
  assert.equal(response.status, 302, 'Signed-out pet form access should redirect');
  assert.equal(response.headers.get('location'), '/login');

  response = await request('/pets', { method: 'POST', body: createPetForm(rejectedUploadOriginalName) });
  assert.equal(response.status, 302, 'Signed-out pet creation should redirect before upload processing');
  assert.equal(response.headers.get('location'), '/login');
  const imageNamesAfterRejectedUpload = await fs.readdir(imageDirectory);
  assert.equal(imageNamesAfterRejectedUpload.filter((fileName) => fileName.endsWith(`_${rejectedUploadOriginalName}`)).length, 0, 'Signed-out upload must not create a file');
  const [beforePets] = await query('SELECT COUNT(*) AS count FROM pets');
  assert.equal(beforePets[0].count, 1, 'Signed-out pet creation must not create a row');

  response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=pet_user&password=user123'
  });
  assert.equal(response.headers.get('location'), '/journals');
  const userCookie = getCookie(response);

  response = await request('/pets/new', { headers: { cookie: userCookie } });
  assert.equal(response.status, 200, 'Signed-in pet form should load');
  assert.match(await response.text(), /Add a New Pet/);

  response = await request('/pets', { method: 'POST', headers: { cookie: userCookie }, body: createPetForm(uploadOriginalName) });
  assert.equal(response.status, 302, 'Valid pet creation should redirect');
  assert.equal(response.headers.get('location'), '/journals');
  const [createdPets] = await query("SELECT owner_id, name, image FROM pets WHERE name = 'New Route Pet'");
  assert.equal(createdPets.length, 1, 'Valid pet creation should insert one pet');
  assert.equal(createdPets[0].owner_id, 2, 'New pet must belong to the session user');
  assert.match(createdPets[0].image, new RegExp(`_${uploadOriginalName.replace('.', '\\.')}$`));
  await fs.access(path.resolve(imageDirectory, createdPets[0].image));

  response = await request('/pets', {
    method: 'POST',
    headers: { cookie: userCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'species=Cat&breed=Mixed&age=2'
  });
  assert.equal(response.status, 200, 'Invalid pet creation should retain the existing response status');
  assert.match(await response.text(), /Failed to add pet\./);
  const [afterInvalidPets] = await query('SELECT COUNT(*) AS count FROM pets');
  assert.equal(afterInvalidPets[0].count, 2, 'Invalid pet creation must not add a row');

  response = await request('/journals', { headers: { cookie: userCookie } });
  assert.equal(response.status, 200, 'Journal regression route should still load');
  assert.match(await response.text(), /Regression walk/);

  response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=pet_admin&password=admin123'
  });
  assert.equal(response.headers.get('location'), '/admin/dashboard');
  const adminCookie = getCookie(response);
  response = await request('/admin/dashboard', { headers: { cookie: adminCookie } });
  assert.equal(response.status, 200, 'Administrator regression route should still load');

  console.log('PASS: Change 5 isolated pet MVC integration checks');
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
  try {
    await cleanUploadArtifacts();
  } catch (error) {
    console.error('Upload cleanup failed:', error);
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
