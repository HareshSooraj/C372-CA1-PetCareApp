const connection = require('../config/db');

const petModel = {
  createPet: (ownerId, name, species, breed, age, image, callback) => {
    const sql = 'INSERT INTO pets (owner_id, name, species, breed, age, image) VALUES (?, ?, ?, ?, ?, ?)';
    connection.query(sql, [ownerId, name, species, breed, age, image], callback);
  },

  getPetsByOwnerId: (userId, callback) => {
    const sql = 'SELECT * FROM pets WHERE owner_id = ?';
    connection.query(sql, [userId], callback);
  },

  getByIdAndOwner: (petId, ownerId, callback) => {
    const sql = 'SELECT * FROM pets WHERE id = ? AND owner_id = ?';
    connection.query(sql, [petId, ownerId], callback);
  },

  updateByIdAndOwner: (petId, ownerId, name, species, breed, age, image, callback) => {
    const values = [name, species, breed, age];
    let sql = 'UPDATE pets SET name = ?, species = ?, breed = ?, age = ?';

    if (image) {
      sql += ', image = ?';
      values.push(image);
    }

    sql += ' WHERE id = ? AND owner_id = ?';
    values.push(petId, ownerId);
    connection.query(sql, values, callback);
  }
};

module.exports = petModel;
