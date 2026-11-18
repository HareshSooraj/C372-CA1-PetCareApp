
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
    }
};

module.exports = journalModel;
