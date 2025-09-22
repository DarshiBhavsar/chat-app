const express = require('express');
const {
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
    getFriendRequests,
    getFriends,
    getFriendsList, // NEW: Added for search functionality
    removeFriend,
    searchUsers,
    getFriendshipStatus
} = require('../controllers/friendController');
const verifyToken = require('../middleware/authMiddleware');
const router = express.Router();

// Friend request routes
router.post('/send-request/:userId', verifyToken, sendFriendRequest);
router.post('/accept-request/:userId', verifyToken, acceptFriendRequest);
router.post('/reject-request/:userId', verifyToken, rejectFriendRequest);
router.delete('/cancel-request/:userId', verifyToken, cancelFriendRequest);
router.get('/requests', verifyToken, getFriendRequests);

// Friend management routes
router.get('/friends', verifyToken, getFriends);
router.get('/list', verifyToken, getFriendsList); // NEW: Added for search functionality
router.delete('/remove/:userId', verifyToken, removeFriend);

// Search and status routes
router.get('/search', verifyToken, searchUsers); // UPDATED: Now includes friends in results
router.get('/status/:userId', verifyToken, getFriendshipStatus);

module.exports = router;