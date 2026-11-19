const express = require('express');
const authController = require('../controllers/authController');
const upload = require('../config/upload');

const router = express.Router();

router.get('/', authController.getHome);
router.get('/signup', authController.getSignup);
router.post('/signup', upload.single('pet_image'), authController.signup);
router.get('/login', authController.getLogin);
router.post('/login', authController.login);
router.get('/logout', authController.logout);

module.exports = router;
