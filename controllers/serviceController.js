const petModel = require('../models/petModel');
const serviceModel = require('../models/serviceModel');
const serviceBookingModel = require('../models/serviceBookingModel');

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function validBookingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && value >= localToday();
}

const serviceController = {
  listServices: (req, res) => {
    const ownerId = req.session.user.id;
    petModel.getPetsByOwnerId(ownerId, (petError, pets) => {
      if (petError) return res.status(500).send('Unable to load pets.');

      serviceModel.getActiveServices((serviceError, services) => {
        if (serviceError) return res.status(500).send('Unable to load services.');
        const requestedPetId = String(req.query.petId || '');
        const selectedPetId = pets.some((pet) => String(pet.id) === requestedPetId) ? requestedPetId : '';
        res.render('services', {
          pets,
          services,
          selectedPetId,
          today: localToday(),
          messages: req.flash('success'),
          errors: req.flash('error'),
          session: req.session
        });
      });
    });
  },

  createBooking: (req, res) => {
    const ownerId = req.session.user.id;
    const petId = positiveInteger(req.body.petId);
    const serviceId = positiveInteger(req.body.serviceId);
    const bookingDate = req.body.bookingDate;

    if (!petId || !serviceId || !validBookingDate(bookingDate)) {
      req.flash('error', 'Choose a pet, service, and valid booking date.');
      return res.redirect('/services');
    }

    serviceBookingModel.createPendingBooking(ownerId, petId, serviceId, bookingDate, (error, result) => {
      if (error) {
        console.error('Error creating booking:', error);
        req.flash('error', 'Unable to create the booking. Please try again.');
        return res.redirect('/services');
      }
      if (!result) {
        req.flash('error', 'That pet or service is unavailable for booking.');
        return res.redirect('/services');
      }

      req.flash('success', 'Booking created. Payment is pending; no payment has been processed.');
      res.redirect('/bookings');
    });
  },

  listBookings: (req, res) => {
    serviceBookingModel.getBookingsByOwner(req.session.user.id, (error, bookings) => {
      if (error) return res.status(500).send('Unable to load booking history.');
      res.render('bookings', {
        bookings,
        messages: req.flash('success'),
        errors: req.flash('error'),
        session: req.session
      });
    });
  }
};

module.exports = serviceController;
