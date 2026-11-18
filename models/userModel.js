const connection = require('../config/db');

const userModel = {
  findByCredentials: (username, hashedPassword, callback) => {
    const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
    connection.query(sql, [username, hashedPassword], callback);
  },

  createUser: (username, hashedPassword, name, role, callback) => {
    const sql = 'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)';
    connection.query(sql, [username, hashedPassword, name, role], callback);
  },

  getAllUsers: (callback) => {
    const sql = 'SELECT id, name, username, role FROM users';
    connection.query(sql, callback);
  },
  findById: (userId, callback) => {
  const sql = 'SELECT id, name, username, role FROM users WHERE id = ?';
  connection.query(sql, [userId], callback);
}
};

module.exports = userModel;