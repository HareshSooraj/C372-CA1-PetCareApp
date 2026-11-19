const journalModel = require('../models/journalModel');
const petModel = require('../models/petModel');

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (/^[\s\x00-\x1F\x7F]*[=+\-@]/u.test(text) || /^[\x00-\x1F\x7F]/.test(text)) {
    text = `'${text}`;
  }

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvDate(value) {
  if (!value) return '';
  if (!(value instanceof Date)) return String(value);

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const journalController = {
  list: (req, res) => {
    const userId = req.session.user.id;
    let selectedPetId = req.query.petId;
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const invalidDateRange = (startDate && !validDate(startDate))
      || (endDate && !validDate(endDate))
      || (startDate && endDate && startDate > endDate);

    petModel.getPetsByOwnerId(userId, (err, pets) => {
      if (err) return res.send('Error loading pets');

      const petInfo = pets.find((pet) => pet.id == selectedPetId);
      if (invalidDateRange) {
        return res.render('journals', {
          journals: [],
          pets,
          selectedPetId,
          pet: petInfo,
          startDate,
          endDate,
          errors: ['Provide valid start and end dates.'],
          session: req.session
        });
      }

      journalModel.getJournalsForOwnedPet(userId, selectedPetId, startDate, endDate, (err2, journals) => {
        if (err2) return res.send('Error loading journals');

        return res.render('journals', {
          journals,
          pets,
          selectedPetId,
          pet: petInfo,
          startDate,
          endDate,
          errors: [],
          session: req.session
        });
      });
    });
  },

  exportCsv: (req, res) => {
    const userId = req.session.user.id;
    const requestedPetId = req.query.petId;
    const hasPetFilter = requestedPetId !== undefined && requestedPetId !== '';
    const validPetFilter = !hasPetFilter
      || (typeof requestedPetId === 'string' && /^[1-9]\d*$/.test(requestedPetId));
    const selectedPetId = hasPetFilter ? Number(requestedPetId) : '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';

    if (!validPetFilter
      || (startDate && !validDate(startDate))
      || (endDate && !validDate(endDate))
      || (startDate && endDate && startDate > endDate)) {
      return res.status(400).send('Invalid journal export filters.');
    }

    journalModel.getJournalsForOwnedPet(userId, selectedPetId, startDate, endDate, (err, journals) => {
      if (err) return res.status(500).send('Unable to export journals.');

      const rows = [
        ['Pet Name', 'Entry Date', 'Activity', 'Notes'],
        ...journals.map((journal) => [journal.name, csvDate(journal.entry_date), journal.activity, journal.notes])
      ];
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="pet-care-journal.csv"'
      });
      return res.send(csv);
    });
  },

  getNew: (req, res) => {
    const userId = req.session.user.id;
    const selectedPetId = req.query.petId;

    petModel.getPetsByOwnerId(userId, (err, pets) => {
      if (err) return res.send('Error loading pets');
      res.render('newJournal', { pets, session: req.session, selectedPetId });
    });
  },

  create: (req, res) => {
    const { pet_id, activity, notes, entry_date } = req.body;
    const userId = req.session.user.id;
    const selectedPetId = positiveInteger(pet_id);

    journalModel.createForOwnedPet(userId, selectedPetId, activity, notes, entry_date, (err, result) => {
      if (err || result.affectedRows === 0) return res.send('Error saving journal');
      res.redirect(`/journals?petId=${selectedPetId}`);
    });
  },

  getEdit: (req, res) => {
    const userId = req.session.user.id;
    const journalId = positiveInteger(req.params.id);

    journalModel.getOwnedJournalById(userId, journalId, (err, journalResults) => {
      if (err || journalResults.length === 0) return res.send('Journal not found');

      petModel.getPetsByOwnerId(userId, (err2, pets) => {
        if (err2) return res.send('Error fetching pets');
        res.render('editJournal', { journal: journalResults[0], pets, session: req.session });
      });
    });
  },

  update: (req, res) => {
    const { entry_date, activity, notes, pet_id } = req.body;
    const userId = req.session.user.id;
    const journalId = positiveInteger(req.params.id);
    const selectedPetId = positiveInteger(pet_id);

    journalModel.updateOwnedJournal(userId, journalId, selectedPetId, entry_date, activity, notes, (err, result) => {
      if (err) return res.send('Error updating journal');
      if (result.affectedRows === 0) return res.send('Journal not found');
      res.redirect(`/journals?petId=${selectedPetId}`);
    });
  },

  delete: (req, res) => {
    const userId = req.session.user.id;
    const journalId = positiveInteger(req.params.id);

    journalModel.getOwnedJournalPetId(userId, journalId, (err, result) => {
      if (err || result.length === 0) return res.send('Journal not found.');

      const petId = result[0].pet_id;
      journalModel.deleteOwnedJournal(userId, journalId, (err2, deleteResult) => {
        if (err2) return res.send('Error deleting journal.');
        if (deleteResult.affectedRows === 0) return res.send('Journal not found.');
        res.redirect(`/journals?petId=${petId}`);
      });
    });
  },

  search: (req, res) => {
    const userId = req.session.user.id;
    const searchQuery = `%${req.query.q}%`;
    const selectedPetId = req.query.petId;

    petModel.getPetsByOwnerId(userId, (err, pets) => {
      if (err) return res.send('Error loading pets');

      journalModel.searchOwnedJournals(userId, searchQuery, selectedPetId, (err2, journals) => {
        if (err2) return res.send('Error searching journals');

        let pet = null;
        if (selectedPetId) {
          const found = pets.find((currentPet) => currentPet.id.toString() === selectedPetId);
          if (found) pet = found;
        }

        res.render('journals', {
          journals,
          pets,
          selectedPetId,
          pet,
          startDate: '',
          endDate: '',
          errors: [],
          session: req.session
        });
      });
    });
  }
};

module.exports = journalController;
