const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const { sendMessage, getMessages, sendGroupMessage, getGroupMessages } = require('../controllers/messageController');

router.post('/send', sendMessage);

router.post('/upload-image', upload.array('image'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No image uploaded' });
    }

    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.status(200).json({ imageUrls });
});


router.post('/group/send', sendGroupMessage);

router.get('/fetch/:senderId/:recipientId', getMessages);

router.get('/fetch/group/:groupId', getGroupMessages);


module.exports = router;
