
const userModel = require('../models/userModel');
const petModel = require('../models/petModel');
const journalModel = require('../models/journalModel');

const adminController = {
    getUserDetails: (req, res) => {
        const userId = req.params.id;

        userModel.findById(userId, (err, userResults) => {
            if (err || !userResults || userResults.length === 0) {
                return res.send('User not found');
            }

            petModel.getPetsByOwnerId(userId, (err2, petResults) => {
                if (err2) {
                    return res.send('Error retrieving pet info');
                }

                journalModel.getJournalsByOwnerId(userId, (err3, journalResults) => {
                    if (err3) {
                        return res.send('Error retrieving journal entries');
                    }

                    res.render('adminUserDetails', {
                        user: userResults[0],
                        pets: petResults,
                        journals: journalResults,
                        session: req.session
                    });
                });
            });
        });
    },

    getAllUsers: (req, res) => {
        userModel.getAllUsers((err, results) => {
            if (err) {
                return res.send('Error loading users');
            }

            res.render('adminUsers', {
                users: results,
                session: req.session
            });
        });
    },



deleteUser: (req, res) => {
    const userId = Number(req.params.id);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).send('Invalid user ID');
    }

    userModel.findById(userId, (err, users) => {
        if (err) {
            return res.status(500).send('Error checking user');
        }

        if (!users || users.length === 0) {
            return res.status(404).send('User not found');
        }

        // Prevent deletion of administrator accounts
        if (users[0].role === 'admin') {
            return res.status(403).send('Cannot delete an admin account');
        }

        userModel.deleteById(userId, (deleteErr, result) => {
            if (deleteErr) {
                console.error('Error deleting user:', deleteErr);
                return res.status(500).send('Error deleting user');
            }

            if (result.affectedRows === 0) {
                return res.status(404).send('User not found');
            }

            res.redirect('/admin/users');
        });
    });
    }
};

module.exports = adminController;
