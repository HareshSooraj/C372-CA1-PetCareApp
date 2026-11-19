const dashboardModel = require('../models/dashboardModel');

function localToday() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const dashboardController = {
  show: (req, res) => {
    const ownerId = req.session.user.id;
    dashboardModel.getDashboard(ownerId, localToday(), (error, dashboard) => {
      if (error) return res.status(500).send('Unable to load dashboard.');
      return res.render('dashboard', { ...dashboard, session: req.session });
    });
  }
};

module.exports = dashboardController;
