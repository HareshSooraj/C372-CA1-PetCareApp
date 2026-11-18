
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
    }
};

module.exports = adminController;
