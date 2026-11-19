const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const testDatabase = `petcare_change4_auth_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
const imageDirectory = path.resolve(__dirname, '..', 'public', 'images');
const uploadOriginalName = `ca1_auth_route_test_${Date.now()}.jpg`;
const baseUrl = 'http://localhost:3000';
let adminConnection;
let databaseCreated = false;
let server;
let serverOutput = '';
let serverError;
let serverExit;

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
      probe.once('error', (error) => {
        reject(new Error(`Port 3000 is already in use or unavailable on ${host}; test aborted safely. (${error.code})`));
      });
      probe.listen({ host, port: 3000, exclusive: true }, () => {
        probe.close((error) => {
          if (error) return reject(error);
          resolve();
        });
      });
    });
  }

  await probe('127.0.0.1');
  await probe('::1');
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (serverError || serverExit) break;
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The test server did not start. ${serverOutput || lastError || ''} ${serverError || serverExit || ''}`);
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

  if (!exited && server.exitCode === null && server.signalCode === null) {
    return false;
  }
  return true;
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

async function cleanUploadArtifact() {
  const fileNames = await fs.readdir(imageDirectory);
  const matchingFiles = fileNames.filter((fileName) => fileName.endsWith(`_${uploadOriginalName}`));
  await Promise.all(matchingFiles.map(async (fileName) => {
    const filePath = path.resolve(imageDirectory, fileName);
    assert.equal(path.dirname(filePath), imageDirectory, 'Upload cleanup path must stay in public/images');
    await fs.unlink(filePath);
  }));
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
  await query(`
    CREATE TABLE users (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password CHAR(64) NOT NULL,
      name VARCHAR(100) NOT NULL,
      role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await query(`
    CREATE TABLE pets (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      owner_id INT UNSIGNED NOT NULL,
      name VARCHAR(80) NOT NULL,
      species VARCHAR(50) NOT NULL,
      breed VARCHAR(80) NOT NULL,
      age TINYINT UNSIGNED NOT NULL,
      image VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_pets_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await query(`
    CREATE TABLE journal (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      pet_id INT UNSIGNED NOT NULL,
      activity VARCHAR(120) NOT NULL,
      notes TEXT NULL,
      entry_date DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_journal_pet FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await query("INSERT INTO users (username, password, name, role) VALUES ('auth_admin', SHA2('admin123', 256), 'Auth Admin', 'admin'), ('auth_user', SHA2('user123', 256), 'Auth User', 'user')");
  await query("INSERT INTO pets (owner_id, name, species, breed, age) VALUES (2, 'Regression Pet', 'Dog', 'Mixed', 3)");
  await query("INSERT INTO journal (pet_id, activity, notes, entry_date) VALUES (1, 'Regression walk', 'Journal regression check', '2026-11-19')");

  server = spawn(process.execPath, ['app.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change4-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.once('error', (error) => { serverError = error; });
  server.once('exit', (code, signal) => { serverExit = `Child exited with code ${code} and signal ${signal}.`; });
  await waitForServer();

  let response = await request('/');
  assert.equal(response.status, 200, 'Public home should load');
  assert.match(await response.text(), /Pet Care Journal/);

  response = await request('/signup');
  assert.equal(response.status, 200, 'Public signup page should load');
  assert.match(await response.text(), /Create an Account/);

  const signupForm = new FormData();
  signupForm.append('username', 'auth_new_user');
  signupForm.append('password', 'new123');
  signupForm.append('name', 'New User');
  signupForm.append('role', 'admin');
  signupForm.append('pet_name', 'Uploaded Pet');
  signupForm.append('species', 'Cat');
  signupForm.append('breed', 'Domestic Short Hair');
  signupForm.append('age', '2');
  signupForm.append('pet_image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), uploadOriginalName);
  response = await request('/signup', { method: 'POST', body: signupForm });
  assert.equal(response.status, 302, 'Signup should redirect');
  assert.equal(response.headers.get('location'), '/login');

  const [newUsers] = await query("SELECT id, role FROM users WHERE username = 'auth_new_user'");
  assert.equal(newUsers.length, 1, 'Signup should create one user');
  assert.equal(newUsers[0].role, 'user', 'Forged administrator role must be ignored');
  const [newPets] = await query('SELECT image FROM pets WHERE owner_id = ?', [newUsers[0].id]);
  assert.equal(newPets.length, 1, 'Signup should create the initial pet');
  assert.match(newPets[0].image, new RegExp(`_${uploadOriginalName.replace('.', '\\.')}$`));
  await fs.access(path.resolve(imageDirectory, newPets[0].image));

  response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=auth_user&password=user123'
  });
  assert.equal(response.status, 302, 'Normal user login should redirect');
  assert.equal(response.headers.get('location'), '/journals');
  const userCookie = getCookie(response);
  assert.ok(userCookie, 'Normal user login should establish a session');

  response = await request('/journals', { headers: { cookie: userCookie } });
  assert.equal(response.status, 200, 'Existing journal listing should still load for a signed-in user');
  assert.match(await response.text(), /Regression walk/);

  response = await request('/logout', { headers: { cookie: userCookie } });
  assert.equal(response.status, 302, 'Logout should redirect');
  assert.equal(response.headers.get('location'), '/login');
  response = await request('/journals', { headers: { cookie: userCookie } });
  assert.equal(response.status, 302, 'Logout should destroy the session');
  assert.equal(response.headers.get('location'), '/login');

  response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=auth_admin&password=admin123'
  });
  assert.equal(response.status, 302, 'Administrator login should redirect');
  assert.equal(response.headers.get('location'), '/admin/dashboard');
  const adminCookie = getCookie(response);
  response = await request('/admin/dashboard', { headers: { cookie: adminCookie } });
  assert.equal(response.status, 200, 'Existing administrator dashboard should still load');

  console.log('PASS: Change 4 isolated auth/home MVC integration checks');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await stopServer();
  } catch (cleanupError) {
    console.error('Test server cleanup failed:', cleanupError);
    process.exitCode = 1;
  }
  try {
    await cleanUploadArtifact();
  } catch (cleanupError) {
    console.error('Upload cleanup failed:', cleanupError);
    process.exitCode = 1;
  }
  if (adminConnection && databaseCreated) {
    try {
      await query(`DROP DATABASE \`${testDatabase}\``);
    } catch (cleanupError) {
      console.error('Test database cleanup failed:', cleanupError);
      process.exitCode = 1;
    }
  }
  if (adminConnection) {
    await adminConnection.end();
  }
});
