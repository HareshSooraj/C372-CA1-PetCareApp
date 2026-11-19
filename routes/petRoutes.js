const express = require('express');
const petController = require('../controllers/petController');
const upload = require('../config/upload');
const { isLoggedIn } = require('../middleware/auth');

const router = express.Router();

router.get('/pets/new', isLoggedIn, petController.getNewPet);
router.post('/pets', isLoggedIn, upload.single('pet_image'), petController.createPet);

module.exports = router;
