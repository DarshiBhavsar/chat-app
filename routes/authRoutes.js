const express = require('express');
const { registerUser, loginUser, getAllUsers } = require('../controllers/authController');
const verifyToken = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/users', getAllUsers);

module.exports = router;
