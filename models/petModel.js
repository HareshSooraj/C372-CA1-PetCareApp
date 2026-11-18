const connection = require('../config/db');

const petModel = {
  createPet: (ownerId, name, species, breed, age, image, callback) => {
    const sql = 'INSERT INTO pets (owner_id, name, species, breed, age, image) VALUES (?, ?, ?, ?, ?, ?)';
    connection.query(sql, [ownerId, name, species, breed, age, image], callback);
  }
};

module.exports = petModel;