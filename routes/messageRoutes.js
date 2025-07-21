const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const audioUpload = require('../middleware/audioUpload');
const uploadDocument = require('../middleware/uploadDocument');
const uploadVideo = require('../middleware/uploadVideo');
const {
    sendMessage,
    getMessages,
    sendGroupMessage,
    getGroupMessages,
    deleteMessage,
    softDeleteMessage
} = require('../controllers/messageController');

router.post('/send', sendMessage);

router.post('/upload-image', upload.array('image'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No image uploaded' });
    }

    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.status(200).json({ imageUrls });
});

router.post('/upload-document', uploadDocument.array('document', 5), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No document uploaded' });
    }

    const documentUrls = req.files.map(file => `/documents/${file.filename}`);
    res.status(200).json({ documentUrls });
});

router.post('/upload-audio', audioUpload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No audio file uploaded' });
    }

    const audioUrl = `${req.protocol}://${req.get('host')}/audio/${req.file.filename}`;

    res.status(200).json({
        message: 'Audio uploaded successfully',
        audioUrls: [audioUrl]
    });
});

router.post('/upload-video', uploadVideo.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoUrl = `/videos/${req.file.filename}`;
    res.json({ videoUrls: [videoUrl] });
});

router.post('/group/send', sendGroupMessage);

router.get('/fetch/:senderId/:recipientId', getMessages);

router.get('/fetch/group/:groupId', getGroupMessages);

// Delete message routes
router.delete('/delete/:messageId', deleteMessage); // Hard delete
router.put('/soft-delete/:messageId', softDeleteMessage); // Soft delete

module.exports = router;