const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const testDatabase = `pc12_${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
const baseUrl = 'http://localhost:3000';
let connection; let created = false; let server; let output = '';

function localDate(offset) { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function cookies(response) { const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')]; return values.filter(Boolean).map((value) => value.split(';')[0]).join('; '); }
async function request(url, options = {}) { return fetch(`${baseUrl}${url}`, { redirect: 'manual', ...options }); }
async function login(username, password) { const response = await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `username=${username}&password=${password}` }); assert.equal(response.status, 302); assert.notEqual(response.headers.get('location'), '/login'); return cookies(response); }
async function assertPortAvailable() { for (const host of ['127.0.0.1', '::1']) { const occupied = await new Promise((resolve) => { const socket = net.createConnection({ host, port: 3000 }); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); }); if (occupied) throw new Error(`Port 3000 is already occupied on ${host}; refusing to start the test server.`); await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen({ host, port: 3000, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolve())); }); } }
async function waitForServer() { for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await request('/')).status === 200) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 200)); } throw new Error(`Server did not start: ${output}`); }
async function stopServer() { if (!server || server.exitCode !== null) return; for (const signal of ['SIGTERM', 'SIGKILL']) { const exited = await new Promise((resolve) => { const onExit = () => { clearTimeout(timeout); resolve(true); }; const timeout = setTimeout(() => { server.removeListener('exit', onExit); resolve(false); }, 5000); server.once('exit', onExit); try { if (!server.kill(signal)) { clearTimeout(timeout); server.removeListener('exit', onExit); resolve(false); } } catch { clearTimeout(timeout); server.removeListener('exit', onExit); resolve(false); } }); if (exited || server.exitCode !== null) return; } throw new Error('Spawned test server did not terminate'); }
function position(text, value) { const index = text.indexOf(value); assert.notEqual(index, -1, `${value} was not rendered`); return index; }

async function main() {
  const today = localDate(0); const tomorrow = localDate(1);
  await assertPortAvailable();
  connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
  await connection.query(`CREATE DATABASE \`${testDatabase}\``); created = true; await connection.query(`USE \`${testDatabase}\``);
  await connection.query(`
    CREATE TABLE users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password CHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, role ENUM('admin','user') NOT NULL DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
    CREATE TABLE pets (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_id INT UNSIGNED NOT NULL, name VARCHAR(80) NOT NULL, species VARCHAR(50) NOT NULL, breed VARCHAR(80) NOT NULL, age TINYINT UNSIGNED NOT NULL, image VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB;
    CREATE TABLE journal (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pet_id INT UNSIGNED NOT NULL, activity VARCHAR(120) NOT NULL, notes TEXT, entry_date DATE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE) ENGINE=InnoDB;
    CREATE TABLE services (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, price DECIMAL(10,2) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
    CREATE TABLE service_bookings (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pet_id INT UNSIGNED NOT NULL, service_id INT UNSIGNED NOT NULL, booking_status VARCHAR(20) NOT NULL, booked_price DECIMAL(10,2) NOT NULL, booking_date DATE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (pet_id) REFERENCES pets(id), FOREIGN KEY (service_id) REFERENCES services(id)) ENGINE=InnoDB;
    CREATE TABLE payments (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, booking_id INT UNSIGNED NOT NULL, amount DECIMAL(10,2) NOT NULL, payment_status VARCHAR(20) NOT NULL, payment_reference VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (booking_id) REFERENCES service_bookings(id)) ENGINE=InnoDB;
    INSERT INTO users (username,password,name,role) VALUES ('dash_admin',SHA2('admin123',256),'Dashboard Admin','admin'),('dash_owner',SHA2('user123',256),'Dashboard Owner','user'),('dash_other',SHA2('other123',256),'Dashboard Other','user'),('dash_empty',SHA2('empty123',256),'Empty Owner','user');
    INSERT INTO pets (owner_id,name,species,breed,age,image) VALUES (2,'Owner One','Dog','Retriever',5,'one.jpg'),(2,'Owner Two','Cat','Tabby',3,'two.jpg'),(3,'Other Pet','Bird','Parrot',2,'other.jpg');
    INSERT INTO services (name,price,is_active) VALUES ('Service 1',10,1),('Service 2',10,1),('Service 3',10,1),('Service 4',10,1),('Service 5',10,1),('Service 6',10,1),('Service 7',10,1),('Service 8',10,1),('Other Service',10,1);
  `);
  for (let index = 1; index <= 6; index += 1) await connection.query('INSERT INTO journal (pet_id,activity,notes,entry_date) VALUES (?,?,?,?)', [index % 2 ? 1 : 2, `Journal ${index}`, 'owner journal', localDate(index === 6 ? -2 : index - 7)]);
  await connection.query('INSERT INTO journal (pet_id,activity,notes,entry_date) VALUES (?,?,?,?)', [3, 'Secret Journal', 'other journal', localDate(10)]);
  for (let index = 1; index <= 6; index += 1) await connection.query('INSERT INTO service_bookings (pet_id,service_id,booking_status,booked_price,booking_date) VALUES (?,?,?,?,?)', [index % 2 ? 1 : 2, index, 'pending', 10, localDate(index - 1)]);
  await connection.query('INSERT INTO service_bookings (pet_id,service_id,booking_status,booked_price,booking_date) VALUES (?,?,?,?,?),(?,?,?,?,?),(?,?,?,?,?)', [1, 7, 'pending', 10, localDate(-1), 1, 8, 'confirmed', 10, localDate(6), 3, 9, 'pending', 10, today]);
  await connection.query("INSERT INTO payments (booking_id,amount,payment_status) VALUES (1,10,'pending'),(2,10,'pending'),(3,10,'approved'),(7,10,'pending'),(8,10,'pending'),(9,10,'pending')");
  server = spawn(process.execPath, ['app.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DB_NAME: testDatabase, SESSION_SECRET: 'change12-test-secret', TZ: 'Asia/Singapore' }, stdio: ['ignore', 'pipe', 'pipe'] }); server.stdout.on('data', (chunk) => { output += chunk; }); server.stderr.on('data', (chunk) => { output += chunk; }); await waitForServer();
  let response = await request('/dashboard'); assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/login');
  const owner = await login('dash_owner', 'user123'); response = await request('/dashboard', { headers: { cookie: owner } }); assert.equal(response.status, 200); const page = await response.text();
  assert.match(page, /My Pets<\/div><div class="display-6">2/); assert.match(page, /Journal Entries<\/div><div class="display-6">6/); assert.match(page, /Upcoming Bookings<\/div><div class="display-6">6/); assert.match(page, /Pending Payments<\/div><div class="display-6">4/);
  assert.equal(page.includes('Secret Journal'), false); assert.equal(page.includes('Other Service'), false); assert.equal(page.includes('Other Pet'), false);
  assert.ok(position(page, 'Journal 6') < position(page, 'Journal 5')); assert.ok(position(page, 'Journal 5') < position(page, 'Journal 4')); assert.ok(position(page, 'Journal 4') < position(page, 'Journal 3')); assert.ok(position(page, 'Journal 3') < position(page, 'Journal 2')); assert.equal(page.includes('Journal 1'), false);
  assert.ok(position(page, 'Service 1') < position(page, 'Service 2')); assert.ok(position(page, 'Service 2') < position(page, 'Service 3')); assert.ok(position(page, 'Service 3') < position(page, 'Service 4')); assert.ok(position(page, 'Service 4') < position(page, 'Service 5')); assert.equal(page.includes('Service 6'), false); assert.match(page, new RegExp(today)); assert.match(page, new RegExp(tomorrow));
  for (const href of ['/dashboard', '/journals', '/services', '/bookings']) assert.match(page, new RegExp(`href="${href}"`));
  const empty = await login('dash_empty', 'empty123'); response = await request('/dashboard', { headers: { cookie: empty } }); const emptyPage = await response.text(); assert.equal((emptyPage.match(/display-6">0/g) || []).length, 4); assert.match(emptyPage, /No journal entries yet\./); assert.match(emptyPage, /No upcoming pending bookings\./);
  response = await request('/journals?startDate=' + today, { headers: { cookie: owner } }); assert.equal(response.status, 200);
  console.log('PASS: Change 12 isolated dashboard integration checks');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await stopServer(); } catch (error) { console.error(error); process.exitCode = 1; } if (connection && created) { try { await connection.query(`DROP DATABASE \`${testDatabase}\``); } catch (error) { console.error(error); process.exitCode = 1; } } if (connection) await connection.end(); });
