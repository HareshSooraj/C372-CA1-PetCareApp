const express = require('express');
const adminController = require('../controllers/adminController');
const { isAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/admin/dashboard', isAdmin, adminController.getDashboard);
router.get('/admin/users', isAdmin, adminController.getAllUsers);
router.get('/admin/users/:id', isAdmin, adminController.getUserDetails);
router.post('/admin/users/delete/:id', isAdmin, adminController.deleteUser);

module.exports = router;
