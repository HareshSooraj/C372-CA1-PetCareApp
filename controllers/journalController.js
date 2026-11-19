const journalModel = require('../models/journalModel');
const petModel = require('../models/petModel');

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

const journalController = {
  list: (req, res) => {
    const userId = req.session.user.id;
    let selectedPetId = req.query.petId;

    petModel.getPetsByOwnerId(userId, (err, pets) => {
      if (err) return res.send('Error loading pets');

      if (!selectedPetId && pets.length > 0) {
        selectedPetId = pets[0].id;
      }

      if (!selectedPetId) {
        return res.render('journals', {
          journals: [],
          pets,
          selectedPetId: '',
          pet: null,
          session: req.session
        });
      }

      journalModel.getJournalsForOwnedPet(userId, selectedPetId, (err2, journals) => {
        if (err2) return res.send('Error loading journals');

        const petInfo = pets.find((pet) => pet.id == selectedPetId);
        return res.render('journals', {
          journals,
          pets,
          selectedPetId,
          pet: petInfo,
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
          session: req.session
        });
      });
    });
  }
};

module.exports = journalController;
