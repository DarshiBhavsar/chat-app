const express = require('express');
const {
    registerUser,
    loginUser,
    getAllUsers,
    blockUser,
    unblockUser,
    getBlockedUsers
} = require('../controllers/authController');
const verifyToken = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/users', verifyToken, getAllUsers);
router.post('/block/:userId', verifyToken, blockUser);
router.post('/unblock/:userId', verifyToken, unblockUser);
router.get('/blocked-users', verifyToken, getBlockedUsers);
router.post('/block/:userId', verifyToken, blockUser);
router.post('/unblock/:userId', verifyToken, unblockUser);
router.get('/blocked-users', verifyToken, getBlockedUsers);

module.exports = router;