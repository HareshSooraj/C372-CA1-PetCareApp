
const db = require('../config/db');

const journalModel = {
  getJournalsByOwnerId: (userId, callback) => {
    const sql = `
      SELECT journal.*, pets.id AS pet_id
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE pets.owner_id = ?
    `;
    db.query(sql, [userId], callback);
  },

  getJournalsForOwnedPet: (userId, petId, startDate, endDate, callback) => {
    let sql = `
      SELECT journal.*, pets.name, pets.species, pets.breed, pets.age, pets.image
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE pets.owner_id = ?
    `;
    const params = [userId];

    if (petId) {
      sql += ' AND pets.id = ?';
      params.push(petId);
    }

    if (startDate) {
      sql += ' AND journal.entry_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND journal.entry_date <= ?';
      params.push(endDate);
    }

    db.query(sql, params, callback);
  },

  createForOwnedPet: (userId, petId, activity, notes, entryDate, callback) => {
    const sql = `
      INSERT INTO journal (pet_id, activity, notes, entry_date)
      SELECT pets.id, ?, ?, ?
      FROM pets
      WHERE pets.id = ? AND pets.owner_id = ?
    `;
    db.query(sql, [activity, notes, entryDate, petId, userId], callback);
  },

  getOwnedJournalById: (userId, journalId, callback) => {
    const sql = `
      SELECT journal.*
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE journal.id = ? AND pets.owner_id = ?
    `;
    db.query(sql, [journalId, userId], callback);
  },

  updateOwnedJournal: (userId, journalId, petId, entryDate, activity, notes, callback) => {
    const sql = `
      UPDATE journal
      JOIN pets AS current_pet ON journal.pet_id = current_pet.id
      JOIN pets AS selected_pet ON selected_pet.id = ?
      SET journal.entry_date = ?, journal.activity = ?, journal.notes = ?, journal.pet_id = selected_pet.id
      WHERE journal.id = ?
        AND current_pet.owner_id = ?
        AND selected_pet.owner_id = ?
    `;
    db.query(sql, [petId, entryDate, activity, notes, journalId, userId, userId], callback);
  },

  getOwnedJournalPetId: (userId, journalId, callback) => {
    const sql = `
      SELECT journal.pet_id
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE journal.id = ? AND pets.owner_id = ?
    `;
    db.query(sql, [journalId, userId], callback);
  },

  deleteOwnedJournal: (userId, journalId, callback) => {
    const sql = `
      DELETE journal
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE journal.id = ? AND pets.owner_id = ?
    `;
    db.query(sql, [journalId, userId], callback);
  },

  searchOwnedJournals: (userId, searchQuery, petId, callback) => {
    let sql = `
      SELECT journal.*, pets.name, pets.species, pets.breed, pets.age, pets.image
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE pets.owner_id = ? AND (journal.activity LIKE ? OR journal.notes LIKE ?)`;
    const params = [userId, searchQuery, searchQuery];

    if (petId) {
      sql += ' AND pets.id = ?';
      params.push(petId);
    }

    db.query(sql, params, callback);
  }
};

module.exports = journalModel;
