const db = require('../config/db');

const dashboardModel = {
  getDashboard: (ownerId, today, callback) => {
    const summarySql = `
      SELECT
        (SELECT COUNT(*) FROM pets WHERE owner_id = ?) AS pet_count,
        (SELECT COUNT(*) FROM journal JOIN pets ON journal.pet_id = pets.id WHERE pets.owner_id = ?) AS journal_count,
        (SELECT COUNT(*) FROM service_bookings JOIN pets ON service_bookings.pet_id = pets.id
          WHERE pets.owner_id = ? AND service_bookings.booking_date >= ? AND service_bookings.booking_status = 'pending') AS upcoming_booking_count,
        (SELECT COUNT(*) FROM payments
          JOIN service_bookings ON payments.booking_id = service_bookings.id
          JOIN pets ON service_bookings.pet_id = pets.id
          WHERE pets.owner_id = ? AND payments.payment_status = 'pending') AS pending_payment_count`;
    const recentJournalsSql = `
      SELECT pets.name AS pet_name, journal.activity,
             DATE_FORMAT(journal.entry_date, '%Y-%m-%d') AS entry_date
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE pets.owner_id = ?
      ORDER BY journal.entry_date DESC, journal.id DESC
      LIMIT 5`;
    const upcomingBookingsSql = `
      SELECT service_bookings.id AS booking_id, pets.name AS pet_name, services.name AS service_name,
             DATE_FORMAT(service_bookings.booking_date, '%Y-%m-%d') AS booking_date,
             service_bookings.booking_status
      FROM service_bookings
      JOIN pets ON service_bookings.pet_id = pets.id
      JOIN services ON service_bookings.service_id = services.id
      WHERE pets.owner_id = ? AND service_bookings.booking_date >= ? AND service_bookings.booking_status = 'pending'
      ORDER BY service_bookings.booking_date ASC, service_bookings.id ASC
      LIMIT 5`;

    db.query(summarySql, [ownerId, ownerId, ownerId, today, ownerId], (summaryError, summaryRows) => {
      if (summaryError) return callback(summaryError);
      db.query(recentJournalsSql, [ownerId], (journalError, recentJournals) => {
        if (journalError) return callback(journalError);
        db.query(upcomingBookingsSql, [ownerId, today], (bookingError, upcomingBookings) => {
          if (bookingError) return callback(bookingError);
          return callback(null, { summary: summaryRows[0], recentJournals, upcomingBookings });
        });
      });
    });
  }
};

module.exports = dashboardModel;
