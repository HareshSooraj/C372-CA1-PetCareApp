const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const testDatabase = `petcare_change9_editpet_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
const imageDirectory = path.resolve(__dirname, '..', 'public', 'images');
const replacementName = `ca1_edit_pet_${Date.now()}.jpg`;
const rejectedName = `ca1_edit_pet_rejected_${Date.now()}.jpg`;
const invalidAgeName = `ca1_edit_pet_invalid_age_${Date.now()}.jpg`;
const failedUpdateName = `ca1_edit_pet_failed_update_${Date.now()}.jpg`;
const baseUrl = 'http://localhost:3000';
let connection; let created = false; let server; let output = '';

function getCookie(response) { const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')]; return cookies.filter(Boolean).map((item) => item.split(';')[0]).join('; '); }
async function request(url, options = {}) { return fetch(`${baseUrl}${url}`, { redirect: 'manual', ...options }); }
async function login(username, password) { const response = await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `username=${username}&password=${password}` }); return { response, cookie: getCookie(response) }; }
function form(name, age = '6') { const data = new FormData(); data.append('pet_name', 'Updated Pet'); data.append('species', 'Cat'); data.append('breed', 'Updated Breed'); data.append('age', age); if (name) data.append('pet_image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), name); return data; }
async function assertPort() { for (const host of ['127.0.0.1', '::1']) await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', (error) => reject(error)); probe.listen({ host, port: 3000, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolve())); }); }
async function waitForServer() { for (let i = 0; i < 30; i += 1) { try { if ((await request('/')).status === 200) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 200)); } throw new Error(`Server did not start: ${output}`); }
async function stopServer() { if (!server || server.exitCode !== null) return; for (const signal of ['SIGTERM', 'SIGKILL']) { const exited = await new Promise((resolve) => { const timer = setTimeout(() => { server.removeListener('exit', onExit); resolve(false); }, 5000); const onExit = () => { clearTimeout(timer); resolve(true); }; server.once('exit', onExit); try { if (!server.kill(signal)) { clearTimeout(timer); server.removeListener('exit', onExit); resolve(false); } } catch { clearTimeout(timer); server.removeListener('exit', onExit); resolve(false); } }); if (exited || server.exitCode !== null) return; } throw new Error('Spawned test server did not terminate'); }
async function assertNoUpload(originalName) { for (let attempt = 0; attempt < 20; attempt += 1) { const names = await fs.readdir(imageDirectory); if (!names.some((file) => file.endsWith(`_${originalName}`))) return; await new Promise((resolve) => setTimeout(resolve, 25)); } assert.fail(`Unexpected upload remained for ${originalName}`); }
async function cleanFiles() { const names = await fs.readdir(imageDirectory); const suffixes = [replacementName, rejectedName, invalidAgeName, failedUpdateName].map((name) => `_${name}`); for (const file of names.filter((item) => suffixes.some((suffix) => item.endsWith(suffix)))) { const target = path.resolve(imageDirectory, file); assert.equal(path.dirname(target), imageDirectory); await fs.unlink(target); } }

async function main() {
  await assertPort();
  connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
  await connection.query(`CREATE DATABASE \`${testDatabase}\``); created = true; await connection.query(`USE \`${testDatabase}\``);
  await connection.query("CREATE TABLE users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password CHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, role ENUM('admin','user') NOT NULL DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB; CREATE TABLE pets (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_id INT UNSIGNED NOT NULL, name VARCHAR(80) NOT NULL, species VARCHAR(50) NOT NULL, breed VARCHAR(80) NOT NULL, age TINYINT UNSIGNED NOT NULL, image VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB; CREATE TABLE journal (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pet_id INT UNSIGNED NOT NULL, activity VARCHAR(120) NOT NULL, notes TEXT, entry_date DATE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE) ENGINE=InnoDB; INSERT INTO users (username,password,name,role) VALUES ('edit_admin',SHA2('admin123',256),'Edit Admin','admin'),('edit_owner',SHA2('user123',256),'Edit Owner','user'),('edit_other',SHA2('other123',256),'Edit Other','user'); INSERT INTO pets (owner_id,name,species,breed,age,image) VALUES (2,'Owner Pet','Dog','Original',5,'existing-owner.jpg'),(3,'Other Pet','Cat','Other',4,'existing-other.jpg'); INSERT INTO journal (pet_id,activity,notes,entry_date) VALUES (1,'Edit regression','journal still works',CURDATE())");
  server = spawn(process.execPath, ['app.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change9-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] }); server.stdout.on('data', (chunk) => { output += chunk; }); server.stderr.on('data', (chunk) => { output += chunk; }); await waitForServer();
  let response = await request('/pets/1/edit'); assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/login');
  const owner = await login('edit_owner', 'user123');
  response = await request('/pets/1/edit', { headers: { cookie: owner.cookie } }); assert.equal(response.status, 200); assert.match(await response.text(), /Owner Pet/);
  response = await request('/pets/2/edit', { headers: { cookie: owner.cookie } }); assert.equal(response.status, 404);
  response = await request('/pets/not-a-number/edit', { headers: { cookie: owner.cookie } }); assert.equal(response.status, 404);
  response = await request('/pets/1/edit', { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'pet_name=&species=Cat&breed=Breed&age=6' }); assert.equal(response.headers.get('location'), '/pets/1/edit');
  let [rows] = await connection.query('SELECT name, image FROM pets WHERE id = 1'); assert.equal(rows[0].name, 'Owner Pet'); assert.equal(rows[0].image, 'existing-owner.jpg');
  response = await request('/pets/1/edit', { method: 'POST', headers: { cookie: owner.cookie }, body: form(invalidAgeName, '') }); assert.equal(response.headers.get('location'), '/pets/1/edit'); await assertNoUpload(invalidAgeName);
  for (const invalidAge of ['-1', '1.5', '0x10', '1e2', 'abc']) { response = await request('/pets/1/edit', { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: `pet_name=Updated&species=Cat&breed=Breed&age=${encodeURIComponent(invalidAge)}` }); assert.equal(response.headers.get('location'), '/pets/1/edit'); }
  [rows] = await connection.query('SELECT name, age, image FROM pets WHERE id = 1'); assert.deepEqual({ name: rows[0].name, age: rows[0].age, image: rows[0].image }, { name: 'Owner Pet', age: 5, image: 'existing-owner.jpg' });
  response = await request('/pets/1/edit', { method: 'POST', headers: { cookie: owner.cookie }, body: form() }); assert.equal(response.headers.get('location'), '/journals?petId=1');
  [rows] = await connection.query('SELECT name, species, breed, age, image, owner_id FROM pets WHERE id = 1'); assert.deepEqual({ name: rows[0].name, species: rows[0].species, breed: rows[0].breed, age: rows[0].age, image: rows[0].image, owner_id: rows[0].owner_id }, { name: 'Updated Pet', species: 'Cat', breed: 'Updated Breed', age: 6, image: 'existing-owner.jpg', owner_id: 2 });
  response = await request('/pets/1/edit', { method: 'POST', headers: { cookie: owner.cookie }, body: form(replacementName) }); assert.equal(response.headers.get('location'), '/journals?petId=1');
  [rows] = await connection.query('SELECT image FROM pets WHERE id = 1'); assert.match(rows[0].image, new RegExp(`_${replacementName.replace('.', '\\.')}$`)); await fs.access(path.resolve(imageDirectory, rows[0].image));
  await connection.query("CREATE TRIGGER fail_change9_update BEFORE UPDATE ON pets FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced update failure'");
  response = await request('/pets/1/edit', { method: 'POST', headers: { cookie: owner.cookie }, body: form(failedUpdateName) }); assert.equal(response.headers.get('location'), '/pets/1/edit'); await assertNoUpload(failedUpdateName);
  [rows] = await connection.query('SELECT image FROM pets WHERE id = 1'); assert.match(rows[0].image, new RegExp(`_${replacementName.replace('.', '\\.')}$`));
  await connection.query('DROP TRIGGER fail_change9_update');
  response = await request('/pets/2/edit', { method: 'POST', headers: { cookie: owner.cookie }, body: form(rejectedName) }); assert.equal(response.status, 404); const files = await fs.readdir(imageDirectory); assert.equal(files.filter((file) => file.endsWith(`_${rejectedName}`)).length, 0);
  response = await request('/journals?petId=1', { headers: { cookie: owner.cookie } }); assert.match(await response.text(), /Updated Pet/);
  response = await request('/pets/new', { headers: { cookie: owner.cookie } }); assert.equal(response.status, 200);
  const admin = await login('edit_admin', 'admin123'); response = await request('/admin/dashboard', { headers: { cookie: admin.cookie } }); assert.equal(response.status, 200);
  console.log('PASS: Change 9 isolated edit-pet integration checks');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await stopServer(); } catch (error) { console.error(error); process.exitCode = 1; } try { await cleanFiles(); } catch (error) { console.error(error); process.exitCode = 1; } if (connection && created) { try { await connection.query(`DROP DATABASE \`${testDatabase}\``); } catch (error) { console.error(error); process.exitCode = 1; } } if (connection) await connection.end(); });
