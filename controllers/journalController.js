const journalModel = require('../models/journalModel');
const petModel = require('../models/petModel');

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
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
