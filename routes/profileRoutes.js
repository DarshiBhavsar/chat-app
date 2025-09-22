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

router.post('/picture', verifyToken, upload.single('profilePicture'), uploadProfilePicture);

router.delete('/picture', verifyToken, removeProfilePicture);

router.get('/:userId', verifyToken, getUserProfile);

router.get('/', verifyToken, getAllUsers);

router.post('/:groupId/picture', verifyToken, upload.single('profilePicture'), uploadGroupPicture);

router.delete('/:groupId/picture', verifyToken, removeGroupPicture);

router.get('/:groupId', verifyToken, getGroupProfile);

router.put('/users/:id', verifyToken, updateUserProfile);

module.exports = router;
