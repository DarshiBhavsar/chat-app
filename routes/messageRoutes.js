const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const audioUpload = require('../middleware/audioUpload');
const uploadDocument = require('../middleware/uploadDocument');
const uploadVideo = require('../middleware/uploadVideo');
const authenticateToken = require('../middleware/authMiddleware');
const {
    sendMessage,
    getMessages,
    sendGroupMessage,
    getGroupMessages,
    deleteMessage,
    softDeleteMessage,
    clearPrivateChat,
    clearGroupChat,
    softClearPrivateChat,
    softClearGroupChat,
    toggleReaction,
    getMessageReactions,
    getReactionDetails,
    markMessageDelivered,
    markMessageRead,
    markMultipleMessagesRead,
    getMessageStatus,
    batchStatusCheck,
    updateMessageStatusRealTime
} = require('../controllers/messageController');

// Send message routes - PROTECTED
router.post('/send', authenticateToken, sendMessage);
router.post('/group/send', authenticateToken, sendGroupMessage); // FIXED: Added authentication

// File upload routes - PROTECTED
router.post('/upload-image', authenticateToken, upload.array('image'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No image uploaded' });
    }

    // ✅ Use file.path which contains the full Cloudinary URL
    const imageUrls = req.files.map(file => file.path);

    console.log('Uploaded images to Cloudinary:', imageUrls); // For debugging

    res.status(200).json({ imageUrls });
});

router.post('/upload-document', authenticateToken, uploadDocument.array('document', 5), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No document uploaded' });
    }

    const documentUrls = req.files.map(file => `/documents/${file.filename}`);
    res.status(200).json({ documentUrls });
});

router.post('/upload-audio', authenticateToken, audioUpload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No audio file uploaded' });
    }

    const audioUrl = `${req.protocol}://${req.get('host')}/audio/${req.file.filename}`;

    res.status(200).json({
        message: 'Audio uploaded successfully',
        audioUrls: [audioUrl]
    });
});

router.post('/upload-video', authenticateToken, uploadVideo.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoUrl = `/videos/${req.file.filename}`;
    res.json({ videoUrls: [videoUrl] });
});

// Fetch messages routes - PROTECTED  
router.get('/fetch/:senderId/:recipientId', authenticateToken, getMessages);
router.get('/fetch/group/:groupId', authenticateToken, getGroupMessages); // FIXED: Added authentication

// Delete message routes - PROTECTED
router.delete('/delete/:messageId', authenticateToken, deleteMessage); // Hard delete
router.put('/soft-delete/:messageId', authenticateToken, softDeleteMessage); // Soft delete

// Clear chat routes - PROTECTED
router.delete('/clear-private/:recipientId', authenticateToken, clearPrivateChat);
router.delete('/clear-group/:groupId', authenticateToken, clearGroupChat);
router.put('/soft-clear-private/:senderId/:recipientId', authenticateToken, softClearPrivateChat);
router.put('/soft-clear-group/:groupId', authenticateToken, softClearGroupChat);

// Message reaction routes - PROTECTED
router.post('/reactions/:messageId', authenticateToken, toggleReaction);
router.get('/reactions/:messageId', authenticateToken, getMessageReactions);
router.get('/reactions/:messageId/:emoji', authenticateToken, getReactionDetails);

// Message status routes - PROTECTED
router.post('/mark-delivered/:messageId', authenticateToken, markMessageDelivered);
router.post('/mark-read/:messageId', authenticateToken, markMessageRead);
router.post('/mark-multiple-read', authenticateToken, markMultipleMessagesRead);
router.get('/status/:messageId', authenticateToken, getMessageStatus);

router.post('/status-batch', authenticateToken, batchStatusCheck);

// Optional: Add real-time status update route
router.put('/status-update/:messageId', authenticateToken, updateMessageStatusRealTime);

module.exports = router;