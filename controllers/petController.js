const petModel = require('../models/petModel');
const fs = require('fs');
const path = require('path');

const imageDirectory = path.resolve(__dirname, '..', 'public', 'images');

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validPetDetails(name, species, breed, age) {
  if (typeof age !== 'string' || !/^\d+$/.test(age)) return false;
  const parsedAge = Number(age);
  return typeof name === 'string' && name.trim()
    && typeof species === 'string' && species.trim()
    && typeof breed === 'string' && breed.trim()
    && Number.isSafeInteger(parsedAge) && parsedAge >= 0 && parsedAge <= 255;
}

function removeNewUpload(req) {
  if (!req.file) return;
  const uploadedPath = path.resolve(imageDirectory, req.file.filename);
  if (path.dirname(uploadedPath) !== imageDirectory) return;

  fs.unlink(uploadedPath, (error) => {
    if (error && error.code !== 'ENOENT') {
      console.error('Error removing failed pet upload:', error);
    }
  });
}

const petController = {
  getNewPet: (req, res) => {
    res.render('newPet', { session: req.session });
  },

  createPet: (req, res) => {
    const { pet_name, species, breed, age } = req.body;
    const petImage = req.file ? req.file.filename : null;
    const ownerId = req.session.user.id;

    petModel.createPet(ownerId, pet_name, species, breed, age, petImage, (err) => {
      if (err) {
        console.error(err);
        return res.send('Failed to add pet.');
      }
      res.redirect('/journals');
    });
  },

  requireOwnedPet: (req, res, next) => {
    const petId = positiveInteger(req.params.id);
    if (!petId) return res.status(404).send('Pet not found');

    petModel.getByIdAndOwner(petId, req.session.user.id, (err, pets) => {
      if (err) return res.status(500).send('Unable to load pet.');
      if (!pets.length) return res.status(404).send('Pet not found');
      req.ownedPet = pets[0];
      next();
    });
  },

  getEditPet: (req, res) => {
    res.render('editPet', {
      pet: req.ownedPet,
      errors: req.flash('error'),
      session: req.session
    });
  },

  updatePet: (req, res) => {
    const { pet_name, species, breed, age } = req.body;
    if (!validPetDetails(pet_name, species, breed, age)) {
      removeNewUpload(req);
      req.flash('error', 'Provide a name, species, breed, and valid age.');
      return res.redirect(`/pets/${req.ownedPet.id}/edit`);
    }

    const image = req.file ? req.file.filename : null;
    petModel.updateByIdAndOwner(
      req.ownedPet.id,
      req.session.user.id,
      pet_name.trim(),
      species.trim(),
      breed.trim(),
      Number(age),
      image,
      (err, result) => {
        if (err || result.affectedRows === 0) {
          console.error('Error updating pet:', err);
          removeNewUpload(req);
          req.flash('error', 'Unable to update pet. Please try again.');
          return res.redirect(`/pets/${req.ownedPet.id}/edit`);
        }
        res.redirect(`/journals?petId=${req.ownedPet.id}`);
      }
    );
  }
};

module.exports = petController;
