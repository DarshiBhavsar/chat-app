const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const verifyToken = require('../middleware/authMiddleware');
const groupController = require('../controllers/groupController');

// Add error handling for multer import
console.log('📦 Multer upload object:', typeof upload);
console.log('📦 Upload methods available:', Object.getOwnPropertyNames(upload));

// Create group
router.post('/create', verifyToken, groupController.createGroup);

// Fixed image upload route with proper error handling
router.post('/upload-image', verifyToken, (req, res, next) => {
    if (!upload || typeof upload.array !== 'function') {
        console.error('❌ Upload middleware not properly configured');
        return res.status(500).json({
            message: 'Server configuration error - upload middleware not available',
            debug: {
                uploadType: typeof upload,
                hasArray: upload && typeof upload.array === 'function',
                uploadMethods: upload ? Object.getOwnPropertyNames(upload) : 'null'
            }
        });
    }

    upload.array('image', 10)(req, res, (err) => {
        if (err) {
            console.error('❌ Multer error:', err);
            return res.status(400).json({
                message: 'File upload error',
                error: err.message
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No image uploaded' });
        }

        const imageUrls = req.files.map(file => {
            console.log('📸 Uploaded file:', file);
            return file.path;
        });

        res.status(200).json({
            message: 'Images uploaded successfully',
            imageUrls,
            debug: {
                filesCount: req.files.length,
                firstFile: req.files[0]
            }
        });
    });
});

// NEW ROUTES - Match frontend URL pattern
// Upload group profile picture
router.post('/profile/:groupId/picture', verifyToken, (req, res, next) => {
    console.log('📸 Upload group picture request for groupId:', req.params.groupId);

    if (!upload || typeof upload.single !== 'function') {
        console.error('❌ Upload middleware not configured');
        return res.status(500).json({ message: 'Upload middleware not configured' });
    }

    upload.single('profilePicture')(req, res, (err) => {
        if (err) {
            console.error('❌ Upload error:', err);
            return res.status(400).json({
                message: 'File upload error',
                error: err.message
            });
        }

        console.log('✅ File uploaded, calling controller');
        groupController.uploadGroupPicture(req, res);
    });
});

// Remove group profile picture
router.delete('/profile/:groupId/picture', verifyToken, groupController.removeGroupPicture);

// Get group profile with picture
router.get('/profile/:groupId', verifyToken, groupController.getGroupProfile);

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

// Update group profile picture (old route - backward compatibility)
router.put('/:groupId/profile-picture', verifyToken, (req, res, next) => {
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

// Update group
router.put('/update/:groupId', verifyToken, groupController.updateGroup);

module.exports = router;