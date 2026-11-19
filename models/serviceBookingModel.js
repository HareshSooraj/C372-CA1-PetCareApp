const db = require('../config/db');

function rollbackAndRelease(connection, callback, error, result) {
  connection.rollback(() => {
    connection.release();
    callback(error, result);
  });
}

const serviceBookingModel = {
  createPendingBooking: (ownerId, petId, serviceId, bookingDate, callback) => {
    db.getConnection((connectionError, connection) => {
      if (connectionError) return callback(connectionError);

      connection.beginTransaction((beginError) => {
        if (beginError) {
          connection.release();
          return callback(beginError);
        }

        connection.query(
          'SELECT id FROM pets WHERE id = ? AND owner_id = ? FOR UPDATE',
          [petId, ownerId],
          (petError, pets) => {
            if (petError) return rollbackAndRelease(connection, callback, petError);
            if (pets.length === 0) return rollbackAndRelease(connection, callback, null, null);

            connection.query(
              'SELECT id, price FROM services WHERE id = ? AND is_active = 1 FOR UPDATE',
              [serviceId],
              (serviceError, services) => {
                if (serviceError) return rollbackAndRelease(connection, callback, serviceError);
                if (services.length === 0) return rollbackAndRelease(connection, callback, null, null);

                const service = services[0];
                connection.query(
                  `INSERT INTO service_bookings
                   (pet_id, service_id, booking_status, booked_price, booking_date)
                   VALUES (?, ?, 'pending', ?, ?)`,
                  [pets[0].id, service.id, service.price, bookingDate],
                  (bookingError, bookingResult) => {
                    if (bookingError) return rollbackAndRelease(connection, callback, bookingError);

                    connection.query(
                      `INSERT INTO payments
                       (booking_id, amount, payment_status, payment_reference)
                       VALUES (?, ?, 'pending', NULL)`,
                      [bookingResult.insertId, service.price],
                      (paymentError, paymentResult) => {
                        if (paymentError) return rollbackAndRelease(connection, callback, paymentError);

                        connection.commit((commitError) => {
                          if (commitError) return rollbackAndRelease(connection, callback, commitError);
                          connection.release();
                          callback(null, { bookingId: bookingResult.insertId, paymentId: paymentResult.insertId });
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  },

  getBookingsByOwner: (ownerId, callback) => {
    const sql = `
      SELECT service_bookings.id AS booking_id,
             DATE_FORMAT(service_bookings.booking_date, '%Y-%m-%d') AS booking_date,
             pets.name AS pet_name,
             services.name AS service_name,
             service_bookings.booked_price,
             service_bookings.booking_status,
             payments.payment_status
      FROM service_bookings
      JOIN pets ON service_bookings.pet_id = pets.id
      JOIN services ON service_bookings.service_id = services.id
      LEFT JOIN payments ON payments.booking_id = service_bookings.id
      WHERE pets.owner_id = ?
      ORDER BY service_bookings.created_at DESC, service_bookings.id DESC`;
    db.query(sql, [ownerId], callback);
  }
};

module.exports = serviceBookingModel;
