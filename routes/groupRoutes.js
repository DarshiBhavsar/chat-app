const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const verifyToken = require('../middleware/authMiddleware');
const groupController = require('../controllers/groupController');

// ✅ Add error handling for multer import
console.log('📦 Multer upload object:', typeof upload);
console.log('📦 Upload methods available:', Object.getOwnPropertyNames(upload));

// Create group
router.post('/create', verifyToken, groupController.createGroup);

// ✅ Fixed image upload route with proper error handling
router.post('/upload-image', verifyToken, (req, res, next) => {
    if (!upload || typeof upload.array !== 'function') {
        return res.status(500).json({
            message: 'Server configuration error - upload middleware not available'
        });
    }

    upload.array('image', 10)(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                message: 'File upload error',
                error: err.message
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No image uploaded' });
        }

        const imageUrls = req.files.map(file => file.path);
        res.status(200).json({
            message: 'Images uploaded successfully',
            imageUrls
        });
    });
});

// Get all groups
router.get('/all', groupController.getAllGroups);

// Get user's groups
router.get('/my-groups/:userId', verifyToken, groupController.getUserGroups);

// Leave a group
router.post('/leave/:groupId', verifyToken, groupController.leaveGroup);

// Add member to group
router.post('/add-member/:groupId', verifyToken, groupController.addMemberToGroup);

// Remove member from group
router.post('/remove-member/:groupId', verifyToken, groupController.removeMemberFromGroup);

// Legacy routes (keeping for backward compatibility)
router.post('/:groupId/members', verifyToken, groupController.addUserToGroup);
router.delete('/:groupId/members/:userId', verifyToken, groupController.removeUserFromGroup);

// Update group profile picture
router.put('/:groupId/profile-picture', verifyToken, (req, res, next) => {
    // Check if single file upload is available
    if (!upload || typeof upload.single !== 'function') {
        return res.status(500).json({ message: 'Upload middleware not configured' });
    }

    upload.single('profilePicture')(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                message: 'File upload error',
                error: err.message
            });
        }
        groupController.updateGroupProfilePicture(req, res);
    });
});

router.get('/profile/:groupId', verifyToken, groupController.getGroupProfile);

// Update group
router.put('/update/:groupId', verifyToken, groupController.updateGroup);

module.exports = router;