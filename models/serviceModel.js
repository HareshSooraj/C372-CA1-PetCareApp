const db = require('../config/db');

const serviceModel = {
  getActiveServices: (callback) => {
    db.query(
      'SELECT id, name, price FROM services WHERE is_active = 1 ORDER BY name',
      callback
    );
  }
};

module.exports = serviceModel;
