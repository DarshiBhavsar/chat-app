const User = require('../models/user');
const path = require('path');

const emitStatusFeedRefresh = async (io, userId, refreshData) => {
    try {
        io.to(userId).emit('status_feed_refresh', refreshData);
        console.log(`📱 Status feed refresh sent to user ${userId}:`, refreshData.reason);
    } catch (error) {
        console.error('❌ Error emitting status feed refresh:', error);
    }
};

// Send friend request
exports.sendFriendRequest = async (req, res) => {
    try {
        const { userId } = req.params;
        const senderId = req.user.id;

        if (userId === senderId) {
            return res.status(400).json({ message: 'Cannot send friend request to yourself' });
        }

        const sender = await User.findById(senderId);
        const recipient = await User.findById(userId);

        if (!recipient) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if they are already friends
        if (sender.friends.includes(userId)) {
            return res.status(400).json({ message: 'Already friends' });
        }

        // Check if request already sent
        if (sender.sentFriendRequests.includes(userId)) {
            return res.status(400).json({ message: 'Friend request already sent' });
        }

        // Check if recipient has already sent a request (mutual request scenario)
        if (recipient.sentFriendRequests.includes(senderId)) {
            return res.status(400).json({ message: 'This user has already sent you a friend request' });
        }

        // Check blocking
        if (sender.blockedUsers.includes(userId) || recipient.blockedUsers.includes(senderId)) {
            return res.status(400).json({ message: 'Cannot send friend request to this user' });
        }

        // Remove from declined requests if retrying after decline
        await User.findByIdAndUpdate(senderId, {
            $pull: { declinedFriendRequests: userId }
        });

        // Add to sender's sent requests and recipient's received requests
        await User.findByIdAndUpdate(senderId, {
            $addToSet: { sentFriendRequests: userId }
        });

        await User.findByIdAndUpdate(userId, {
            $addToSet: { receivedFriendRequests: senderId }
        });

        // Emit socket event for real-time notification
        const io = req.app.get('io');
        if (io) {
            io.emit('friend_request_received', {
                recipientId: userId,
                senderId: senderId,
                senderName: sender.username,
                senderProfilePicture: sender.profilePicture
            });
        }

        res.json({ message: 'Friend request sent successfully' });
    } catch (error) {
        console.error('Error sending friend request:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Cancel friend request
exports.cancelFriendRequest = async (req, res) => {
    try {
        const { userId } = req.params;
        const senderId = req.user.id;

        const sender = await User.findById(senderId);
        const recipient = await User.findById(userId);

        if (!recipient) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if there's a pending request to cancel
        const hasPendingRequest = sender.sentFriendRequests.includes(userId);
        const wasDeclined = sender.declinedFriendRequests && sender.declinedFriendRequests.includes(userId);

        if (!hasPendingRequest && !wasDeclined) {
            return res.status(400).json({ message: 'No friend request found to cancel' });
        }

        if (wasDeclined && !hasPendingRequest) {
            await User.findByIdAndUpdate(senderId, {
                $pull: { declinedFriendRequests: userId }
            });
            return res.json({ message: 'Declined request cleared successfully' });
        }

        if (hasPendingRequest) {
            await User.findByIdAndUpdate(senderId, {
                $pull: { sentFriendRequests: userId }
            });

            await User.findByIdAndUpdate(userId, {
                $pull: { receivedFriendRequests: senderId }
            });

            const io = req.app.get('io');
            if (io) {
                io.emit('friend_request_cancelled', {
                    senderId: senderId,
                    recipientId: userId,
                    senderName: sender.username
                });
            }

            return res.json({ message: 'Friend request cancelled successfully' });
        }

    } catch (error) {
        console.error('Error cancelling friend request:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Accept friend request
exports.acceptFriendRequest = async (req, res) => {
    try {
        const { userId } = req.params;
        const accepterId = req.user.id;

        const accepter = await User.findById(accepterId);
        const requester = await User.findById(userId);

        if (!requester) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!accepter.receivedFriendRequests.includes(userId)) {
            return res.status(400).json({ message: 'No pending friend request from this user' });
        }

        await User.findByIdAndUpdate(accepterId, {
            $addToSet: { friends: userId },
            $pull: {
                receivedFriendRequests: userId,
                declinedFriendRequests: userId
            }
        });

        await User.findByIdAndUpdate(userId, {
            $addToSet: { friends: accepterId },
            $pull: {
                sentFriendRequests: accepterId,
                declinedFriendRequests: accepterId
            }
        });

        const io = req.app.get('io');
        if (io) {
            // Standard friend request accepted event
            io.emit('friend_request_accepted', {
                accepterId: accepterId,
                requesterId: userId,
                accepterName: accepter.username,
                requesterName: requester.username
            });

            // NEW: Trigger status refresh for both users
            await emitStatusFeedRefresh(io, accepterId, {
                reason: 'friend_accepted',
                friendId: userId,
                friendName: requester.username
            });

            await emitStatusFeedRefresh(io, userId, {
                reason: 'friend_accepted',
                friendId: accepterId,
                friendName: accepter.username
            });
        }

        res.json({ message: 'Friend request accepted successfully' });
    } catch (error) {
        console.error('Error accepting friend request:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Reject friend request
exports.rejectFriendRequest = async (req, res) => {
    try {
        const { userId } = req.params;
        const rejecterId = req.user.id;

        const rejecter = await User.findById(rejecterId);
        const requester = await User.findById(userId);

        if (!requester) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!rejecter.receivedFriendRequests.includes(userId)) {
            return res.status(400).json({ message: 'No pending friend request from this user' });
        }

        await User.findByIdAndUpdate(rejecterId, {
            $pull: { receivedFriendRequests: userId }
        });

        await User.findByIdAndUpdate(userId, {
            $pull: { sentFriendRequests: rejecterId },
            $addToSet: { declinedFriendRequests: rejecterId }
        });

        const io = req.app.get('io');
        if (io) {
            io.emit('friend_request_rejected', {
                rejecterId: rejecterId,
                requesterId: userId,
                rejecterName: rejecter.username
            });
        }

        res.json({ message: 'Friend request rejected successfully' });
    } catch (error) {
        console.error('Error rejecting friend request:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Get friend requests (both sent and received)
exports.getFriendRequests = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId)
            .populate('receivedFriendRequests', 'username email profilePicture createdAt')
            .populate('sentFriendRequests', 'username email profilePicture createdAt');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const receivedRequests = user.receivedFriendRequests.map(user => ({
            id: user._id,
            name: user.username,
            email: user.email,
            profilePicture: user.profilePicture ? `/uploads/${path.basename(user.profilePicture)}` : null,
            createdAt: user.createdAt
        }));

        const sentRequests = user.sentFriendRequests.map(user => ({
            id: user._id,
            name: user.username,
            email: user.email,
            profilePicture: user.profilePicture ? `/uploads/${path.basename(user.profilePicture)}` : null,
            createdAt: user.createdAt
        }));

        res.json({
            received: receivedRequests,
            sent: sentRequests
        });
    } catch (error) {
        console.error('Error fetching friend requests:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Get friends list
exports.getFriends = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).populate('friends', 'username email profilePicture isOnline lastSeen');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const friends = user.friends.map(friend => ({
            id: friend._id,
            name: friend.username,
            email: friend.email,
            profilePicture: friend.profilePicture ? `/uploads/${path.basename(friend.profilePicture)}` : null,
            online: friend.isOnline,
            lastSeen: friend.lastSeen
        }));

        res.json(friends);
    } catch (error) {
        console.error('Error fetching friends:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Get friends list (alias for search functionality)
exports.getFriendsList = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).populate('friends', 'username email profilePicture isOnline lastSeen');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const friends = user.friends.map(friend => ({
            id: friend._id,
            name: friend.username,
            email: friend.email,
            profilePicture: friend.profilePicture ? `/uploads/${path.basename(friend.profilePicture)}` : null,
            online: friend.isOnline,
            lastSeen: friend.lastSeen,
            friendshipStatus: 'friends'
        }));

        res.json(friends);
    } catch (error) {
        console.error('Error fetching friends list:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Remove friend - UPDATED with status refresh
exports.removeFriend = async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = req.user.id;

        const currentUser = await User.findById(currentUserId);
        const targetUser = await User.findById(userId);

        if (!targetUser || !currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        await User.findByIdAndUpdate(currentUserId, {
            $pull: { friends: userId }
        });

        await User.findByIdAndUpdate(userId, {
            $pull: { friends: currentUserId }
        });

        const io = req.app.get('io');
        if (io) {
            // Standard friend removed event
            io.emit('friend_removed_sync', {
                removedByUserId: currentUserId,
                removedByUserName: currentUser.username,
                targetUserId: userId,
                targetUserName: targetUser.username
            });

            // NEW: Trigger status refresh for both users
            await emitStatusFeedRefresh(io, currentUserId, {
                reason: 'friend_removed',
                removedFriendId: userId,
                removedFriendName: targetUser.username
            });

            await emitStatusFeedRefresh(io, userId, {
                reason: 'friend_removed',
                removedFriendId: currentUserId,
                removedFriendName: currentUser.username
            });
        }

        res.json({ message: 'Friend removed successfully' });
    } catch (error) {
        console.error('Error removing friend:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};


// Search users (for sending friend requests) - UPDATED to include friends
exports.searchUsers = async (req, res) => {
    try {
        const { query } = req.query;
        const currentUserId = req.user.id;

        if (!query || query.trim() === '') {
            return res.json([]);
        }

        const currentUser = await User.findById(currentUserId);

        const users = await User.find({
            _id: {
                $ne: currentUserId,
                $nin: [...currentUser.blockedUsers, ...currentUser.blockedBy]
            },
            $or: [
                { username: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } }
            ]
        }, 'username email profilePicture').limit(20);

        const searchResults = users.map(user => {
            const friendshipStatus = getFriendshipStatusHelper(currentUser, user._id);

            return {
                id: user._id,
                name: user.username,
                email: user.email,
                profilePicture: user.profilePicture ? `/uploads/${path.basename(user.profilePicture)}` : null,
                friendshipStatus
            };
        });

        searchResults.sort((a, b) => {
            if (a.friendshipStatus === 'friends' && b.friendshipStatus !== 'friends') return -1;
            if (a.friendshipStatus !== 'friends' && b.friendshipStatus === 'friends') return 1;
            return 0;
        });

        res.json(searchResults);
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Get friendship status between users
exports.getFriendshipStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = req.user.id;

        const currentUser = await User.findById(currentUserId);

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const status = getFriendshipStatusHelper(currentUser, userId);

        res.json({ status });
    } catch (error) {
        console.error('Error getting friendship status:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Helper function to determine friendship status
function getFriendshipStatusHelper(currentUser, targetUserId) {
    const targetUserIdStr = targetUserId.toString();

    if (currentUser.friends.some(id => id.toString() === targetUserIdStr)) {
        return 'friends';
    }

    if (currentUser.sentFriendRequests.some(id => id.toString() === targetUserIdStr)) {
        return 'request_sent';
    }

    if (currentUser.receivedFriendRequests.some(id => id.toString() === targetUserIdStr)) {
        return 'request_received';
    }

    if (currentUser.declinedFriendRequests && currentUser.declinedFriendRequests.some(id => id.toString() === targetUserIdStr)) {
        return 'request_declined';
    }

    if (currentUser.blockedUsers.some(id => id.toString() === targetUserIdStr)) {
        return 'blocked';
    }

    return 'none';
}