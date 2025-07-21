const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const verifyToken = require('../middleware/authMiddleware');
const groupController = require('../controllers/groupController');

router.post('/create', verifyToken, groupController.createGroup);

router.post('/upload-image', upload.array('image'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No image uploaded' });
    }

    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.status(200).json({ imageUrls });
});


router.get('/all', groupController.getAllGroups);

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

module.exports = router;