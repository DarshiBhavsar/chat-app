const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const upload = require('../middleware/multerConfig');
const {
    uploadProfilePicture,
    removeProfilePicture,
    getUserProfile,
    getAllUsers,
    uploadGroupPicture,
    removeGroupPicture,
    getGroupProfile,
    updateUserProfile
} = require('../controllers/profileController');

const router = express.Router();

// User profile routes (more specific routes first)
router.get('/current', verifyToken, getUserProfile);
router.get('/users', verifyToken, getAllUsers); // Changed from '/' to '/users'
router.post('/picture', verifyToken, upload.single('profilePicture'), uploadProfilePicture);
router.delete('/picture', verifyToken, removeProfilePicture);
router.put('/update', verifyToken, updateUserProfile); // Changed from '/users/:id' to '/update'

// Group routes (with explicit 'group' prefix to avoid conflicts)
router.post('/group/:groupId/picture', verifyToken, upload.single('profilePicture'), uploadGroupPicture);
router.delete('/group/:groupId/picture', verifyToken, removeGroupPicture);
router.get('/group/:groupId', verifyToken, getGroupProfile);

// User profile by ID (this should be last to avoid conflicts)
router.get('/user/:userId', verifyToken, getUserProfile); // Changed from '/:userId' to '/user/:userId'

module.exports = router;