require('dotenv').config();                       
// Pet Care Journal System
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

const journalModel = require('./models/journalModel');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = 3000;



// Image upload configuration
const upload = require('./config/upload');


// View Engine and Middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

app.use(flash());

app.use(authRoutes);
app.use(adminRoutes);

// MySQL Connection
const connection = require('./config/db');

const petModel = require('./models/petModel');

// Auth Middleware
const { isLoggedIn } = require('./middleware/auth');

// =========================
// Pet Route
// =========================

// View Pet Profile
// app.get('/pets/:id', isLoggedIn, (req, res) => {
//   const sql = 'SELECT * FROM pets WHERE id = ?';
//   connection.query(sql, [req.params.id], (err, results) => {
//     if (err) throw err;
//     res.render('petProfile', { pet: results[0] });
//   });
// });

//add pet
app.get('/pets/new', isLoggedIn, (req, res) => {
  res.render('newPet', {session: req.session});
});

app.post('/pets', upload.single('pet_image'), isLoggedIn, (req, res) => {
  const { pet_name, species, breed, age } = req.body;
  let petImage;

  if (req.file) {
    petImage = req.file.filename; // use uploaded filename
  } else {
    petImage = null;
  }

  const ownerId = req.session.user.id;

  const sql = 'INSERT INTO pets (owner_id, name, species, breed, age, image) VALUES (?, ?, ?, ?, ?, ?)';
  connection.query(sql, [ownerId, pet_name, species, breed, age, petImage], (err) => {
    if (err) {
      console.error(err);
      return res.send('Failed to add pet.');
    }
    res.redirect('/journals');
  });
});


// =========================
// Journal Routes
// =========================

// View All Journals
app.get('/journals', isLoggedIn, (req, res) => {
  const userId = req.session.user.id;
  let selectedPetId = req.query.petId;

  // Get all pets of this user
  const petSql = 'SELECT * FROM pets WHERE owner_id = ?';
  connection.query(petSql, [userId], (err, pets) => {
    if (err) return res.send('Error loading pets');

    // If no pet selected yet, default to first pet (if available)
    if (!selectedPetId && pets.length > 0) {
      selectedPetId = pets[0].id;
    }

    if (!selectedPetId) {
      // No pets at all
      return res.render('journals', {
        journals: [],
        pets,
        selectedPetId: '',
        pet: null,
        session: req.session
      });
    }

    const journalSql = `
      SELECT journal.*, pets.name, pets.species, pets.breed, pets.age, pets.image 
      FROM journal 
      JOIN pets ON journal.pet_id = pets.id 
      WHERE pets.owner_id = ? AND pets.id = ?
    `;
    const params = [userId, selectedPetId];

    connection.query(journalSql, params, (err2, journals) => {
      if (err2) return res.send('Error loading journals');

      // Pet info always comes from the pets list
      const petInfo = pets.find(p => p.id == selectedPetId);

      return res.render('journals', {
        journals,
        pets,
        selectedPetId,
        pet: petInfo,
        session: req.session
      });
    });
  });
});

// app.get('/journals', isLoggedIn, (req, res) => {
//   const userId = req.session.user.id;
//   const sql = `SELECT journal.*, pets.name, pets.species, pets.breed, pets.age, pets.image 
//                 AS image FROM pets 
//                 LEFT JOIN journal ON pets.id = journal.pet_id 
//                 WHERE pets.owner_id = ?`;
//   connection.query(sql, [userId], (err, journals) => {
//     res.render('journals', { journals, session: req.session });
//   });
// });

// New Journal Form
app.get('/journals/new', isLoggedIn, (req, res) => {
  const userId = req.session.user.id;
  const selectedPetId = req.query.petId; // Get optional petId from query

  const sql = 'SELECT * FROM pets WHERE owner_id = ?';
  connection.query(sql, [userId], (err, pets) => {
    if (err) return res.send('Error loading pets');
    
    res.render('newJournal', { pets, session: req.session, selectedPetId });
  });
});

// app.get('/journals/new', isLoggedIn, (req, res) => {
//   const userId = req.session.user.id;
//   const sql = 'SELECT * FROM pets WHERE owner_id = ?';
//   connection.query(sql, [userId], (err, pets) => {
//     res.render('newJournal', { pets, session: req.session });
//   });
// });


// Handle New Journal Submission
app.post('/journals/new', isLoggedIn, (req, res) => {
  const { pet_id, activity, notes, entry_date } = req.body;
  const userId = req.session.user.id;
  const requestedPetId = Number(pet_id);
  const selectedPetId = Number.isSafeInteger(requestedPetId) && requestedPetId > 0 ? requestedPetId : null;

  const sql = `
    INSERT INTO journal (pet_id, activity, notes, entry_date)
    SELECT pets.id, ?, ?, ?
    FROM pets
    WHERE pets.id = ? AND pets.owner_id = ?
  `;
  connection.query(sql, [activity, notes, entry_date, selectedPetId, userId], (err, result) => {
    if (err) return res.send('Error saving journal');
    if (result.affectedRows === 0) return res.send('Error saving journal');

    // Redirect to journals page and keep selected pet
    res.redirect(`/journals?petId=${selectedPetId}`);
  });
});


// Edit Journal Form
app.get('/journals/edit/:id', isLoggedIn, (req, res) => {
  const requestedJournalId = Number(req.params.id);
  const journalId = Number.isSafeInteger(requestedJournalId) && requestedJournalId > 0 ? requestedJournalId : null;
  const userId = req.session.user.id;

  const sqlJournal = `
    SELECT journal.*
    FROM journal
    JOIN pets ON journal.pet_id = pets.id
    WHERE journal.id = ? AND pets.owner_id = ?
  `;
  const sqlPets = 'SELECT * FROM pets WHERE owner_id = ?';

  connection.query(sqlJournal, [journalId, userId], (err, journalResults) => {
    if (err || journalResults.length === 0) return res.send('Journal not found');

    connection.query(sqlPets, [userId], (err2, pets) => {
      if (err2) return res.send('Error fetching pets');

      res.render('editJournal', { journal: journalResults[0], pets, session: req.session });
    });
  });
});


// Handle Edit Submission
app.post('/journals/edit/:id', isLoggedIn, (req, res) => {
  const { entry_date, activity, notes, pet_id } = req.body;
  const requestedJournalId = Number(req.params.id);
  const journalId = Number.isSafeInteger(requestedJournalId) && requestedJournalId > 0 ? requestedJournalId : null;
  const userId = req.session.user.id;
  const requestedPetId = Number(pet_id);
  const selectedPetId = Number.isSafeInteger(requestedPetId) && requestedPetId > 0 ? requestedPetId : null;

  const sql = `
    UPDATE journal
    JOIN pets AS current_pet ON journal.pet_id = current_pet.id
    JOIN pets AS selected_pet ON selected_pet.id = ?
    SET journal.entry_date = ?, journal.activity = ?, journal.notes = ?, journal.pet_id = selected_pet.id
    WHERE journal.id = ?
      AND current_pet.owner_id = ?
      AND selected_pet.owner_id = ?
  `;
  const params = [selectedPetId, entry_date, activity, notes, journalId, userId, userId];
  connection.query(sql, params, (err, result) => {
    if (err) return res.send('Error updating journal');
    if (result.affectedRows === 0) return res.send('Journal not found');
    res.redirect(`/journals?petId=${selectedPetId}`); // 🔁 Redirect back to selected pet
  });
});


// Delete Journal
app.get('/journals/delete/:id', isLoggedIn, (req, res) => {
  const requestedJournalId = Number(req.params.id);
  const journalId = Number.isSafeInteger(requestedJournalId) && requestedJournalId > 0 ? requestedJournalId : null;
  const userId = req.session.user.id;

  // First, find the pet_id for this journal
  const findPetSql = `
    SELECT journal.pet_id
    FROM journal
    JOIN pets ON journal.pet_id = pets.id
    WHERE journal.id = ? AND pets.owner_id = ?
  `;
  connection.query(findPetSql, [journalId, userId], (err, result) => {
    if (err || result.length === 0) return res.send('Journal not found.');

    const petId = result[0].pet_id;

    // Now delete the journal
    const deleteSql = `
      DELETE journal
      FROM journal
      JOIN pets ON journal.pet_id = pets.id
      WHERE journal.id = ? AND pets.owner_id = ?
    `;
    connection.query(deleteSql, [journalId, userId], (err2, deleteResult) => {
      if (err2) return res.send('Error deleting journal.');
      if (deleteResult.affectedRows === 0) return res.send('Journal not found.');

      // Redirect to journals page for the correct pet
      res.redirect(`/journals?petId=${petId}`);
    });
  });
});

// app.get('/journals/delete/:id', (req, res) => {
//   const sql = 'DELETE FROM journal WHERE id = ?'
//   connection.query( sql, [req.params.id], () => {
//     res.redirect('/journals');
//   });
// });

// Search Journals
app.get('/journals/search', isLoggedIn, (req, res) => {
  const userId = req.session.user.id;
  const searchQuery = `%${req.query.q}%`;
  const selectedPetId = req.query.petId;

  const petSql = 'SELECT * FROM pets WHERE owner_id = ?';
  connection.query(petSql, [userId], (err, pets) => {
    if (err) return res.send('Error loading pets');

    let sql = `
      SELECT journal.*, pets.name, pets.species, pets.breed, pets.age, pets.image 
      FROM journal 
      JOIN pets ON journal.pet_id = pets.id 
      WHERE pets.owner_id = ? AND (journal.activity LIKE ? OR journal.notes LIKE ?)`;

    const params = [userId, searchQuery, searchQuery];

    if (selectedPetId) {
      sql += ' AND pets.id = ?';
      params.push(selectedPetId);
    }

    connection.query(sql, params, (err2, journals) => {
      if (err2) return res.send('Error searching journals');

      let pet = null;
      if (selectedPetId) {
        const found = pets.find(p => p.id.toString() === selectedPetId);
        if (found) pet = found;
      }

      res.render('journals', {
        journals,
        pets,
        selectedPetId,
        pet,
        session: req.session
      });
    });
  });
});

// =========================
// Start Server
// =========================
app.listen(PORT, () => console.log(`App running on http://localhost:${PORT}`));
