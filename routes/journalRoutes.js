const express = require('express');
const journalController = require('../controllers/journalController');
const { isLoggedIn } = require('../middleware/auth');

const router = express.Router();

router.get('/journals', isLoggedIn, journalController.list);
router.get('/journals/export', isLoggedIn, journalController.exportCsv);
router.get('/journals/new', isLoggedIn, journalController.getNew);
router.post('/journals/new', isLoggedIn, journalController.create);
router.get('/journals/edit/:id', isLoggedIn, journalController.getEdit);
router.post('/journals/edit/:id', isLoggedIn, journalController.update);
// Preserved for this structural refactor; GET deletion remains vulnerable to CSRF.
router.get('/journals/delete/:id', isLoggedIn, journalController.delete);
router.get('/journals/search', isLoggedIn, journalController.search);

module.exports = router;
