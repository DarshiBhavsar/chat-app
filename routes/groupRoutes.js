const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
// const verifyToken = require('../middleware/authMiddleware');
const groupController = require('../controllers/groupController');

router.post('/create', groupController.createGroup);

router.post('/upload-image', upload.array('image'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No image uploaded' });
    }

    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.status(200).json({ imageUrls });
});


router.get('/all', groupController.getAllGroups);

router.get('/my-groups/:userId', groupController.getUserGroups)

router.post('/:groupId/members', groupController.addUserToGroup);

router.delete('/:groupId/members/:userId', groupController.removeUserFromGroup);

module.exports = router;
