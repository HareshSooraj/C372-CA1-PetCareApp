const connection = require('../config/db');

const petModel = {
  createPet: (ownerId, name, species, breed, age, image, callback) => {
    const sql = 'INSERT INTO pets (owner_id, name, species, breed, age, image) VALUES (?, ?, ?, ?, ?, ?)';
    connection.query(sql, [ownerId, name, species, breed, age, image], callback);
  },

  getPetsByOwnerId: (userId, callback) => {
  const sql = 'SELECT * FROM pets WHERE owner_id = ?';
  connection.query(sql, [userId], callback);
}
};

module.exports = petModel;