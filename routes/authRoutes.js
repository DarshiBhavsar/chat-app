const express = require('express');
const {
    registerUser,
    loginUser,
    getAllUsers,
    blockUser,
    unblockUser,
    getCurrentUser,
    getBlockedUsers,
    updateUser,
    forgotPassword,
    resetPassword

} = require('../controllers/authController');
const verifyToken = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword); // ← CORRECT
router.get('/users', verifyToken, getAllUsers);
router.get('/user/me', verifyToken, getCurrentUser);
router.post('/block/:userId', verifyToken, blockUser);
router.post('/unblock/:userId', verifyToken, unblockUser);
router.get('/blocked-users', verifyToken, getBlockedUsers);
router.post('/block/:userId', verifyToken, blockUser);
router.post('/unblock/:userId', verifyToken, unblockUser);
router.get('/blocked-users', verifyToken, getBlockedUsers);
router.put('/users/:id', verifyToken, updateUser);

module.exports = router;