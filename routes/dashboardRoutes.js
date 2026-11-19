const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { isLoggedIn } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', isLoggedIn, dashboardController.show);

module.exports = router;
