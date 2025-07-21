require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const groupRoutes = require('./routes/groupRoutes');
const messageRoutes = require('./routes/messageRoutes');
const User = require('./models/user');
const verifyToken = require('./middleware/authMiddleware');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

connectDB();

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/messages', messageRoutes);

const io = new Server(server, {
    cors: {
        origin: 'https://chat-application-reactjs-nodejs.netlify.app',
        // origin: 'http://localhost:5173',
        pingTimeout: 10000,
        methods: ['GET', 'POST']
    }
});

const onlineUsers = new Map();
const userSocketMap = new Map();
// Add last seen tracking
const userLastSeen = new Map(); // userId -> timestamp
const activeGroupCalls = new Map(); // groupId -> { participants: Set, callType: 'voice'|'video' }

// Helper function to update last seen
const updateLastSeen = async (userId) => {
    const timestamp = new Date();
    userLastSeen.set(userId, timestamp);

    // Optionally persist to database
    try {
        await User.findByIdAndUpdate(userId, {
            lastSeen: timestamp,
            isOnline: true
        });
    } catch (error) {
        console.error('Error updating last seen in database:', error);
    }
};

// Helper function to set user offline
const setUserOffline = async (userId) => {
    const timestamp = new Date();
    userLastSeen.set(userId, timestamp);

    try {
        await User.findByIdAndUpdate(userId, {
            lastSeen: timestamp,
            isOnline: false
        });
    } catch (error) {
        console.error('Error setting user offline in database:', error);
    }
};

// Helper function to get user's last seen info
const getUserLastSeen = (userId) => {
    return userLastSeen.get(userId) || null;
};

// Helper function to format last seen text
const formatLastSeen = (lastSeenTime) => {
    if (!lastSeenTime) return 'Never';

    const now = new Date();
    const diffMs = now - lastSeenTime;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return lastSeenTime.toLocaleDateString();
};

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/documents', express.static('documents'));
app.use('/audio', express.static(path.join(__dirname, 'audio')));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

// Add endpoint to get user's last seen
app.get('/api/users/:userId/last-seen', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId).select('lastSeen isOnline');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const isOnline = onlineUsers.has(userSocketMap.get(userId));
        const lastSeen = isOnline ? new Date() : (user.lastSeen || null);

        res.json({
            userId,
            isOnline,
            lastSeen,
            lastSeenText: isOnline ? 'Online' : formatLastSeen(lastSeen)
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

io.on('connection', socket => {
    console.log(`✅ Socket connected: ${socket.id}`);

    socket.on('user-joined', async ({ token }) => {
        try {
            const user = jwt.decode(token);

            onlineUsers.set(socket.id, { id: user.id, name: user.username });
            userSocketMap.set(user.id, socket.id);

            // Update last seen when user comes online
            await updateLastSeen(user.id);

            console.log(`✅ User joined: ${user.username} (UserID: ${user.id}, SocketID: ${socket.id})`);

            // Join user to all their groups
            try {
                const Group = require('./models/group');
                const groups = await Group.find({ members: user.id });

                for (const group of groups) {
                    const groupId = group._id.toString();
                    socket.join(groupId);
                    console.log(`✅ User ${user.id} auto-joined group room: ${groupId}`);
                }

                console.log(`✅ Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms));
            } catch (err) {
                console.error('❌ Error joining user to groups:', err);
            }

            io.emit('user-joined-broadcast', {
                id: user.id,
                name: user.username,
                isOnline: true,
                lastSeen: new Date()
            });

            // Send updated online users with last seen info
            const onlineUsersWithLastSeen = Array.from(onlineUsers.values()).map(u => ({
                ...u,
                isOnline: true,
                lastSeen: new Date(),
                lastSeenText: 'Online'
            }));

            io.emit('online-users', onlineUsersWithLastSeen);
        } catch (error) {
            console.error('❌ Error processing user-joined event:', error);
        }
    });

    socket.on('get-online-users', () => {
        const onlineUsersWithLastSeen = Array.from(onlineUsers.values()).map(u => ({
            ...u,
            isOnline: true,
            lastSeen: new Date(),
            lastSeenText: 'Online'
        }));

        socket.emit('online-users', onlineUsersWithLastSeen);
    });

    // Add event to request specific user's last seen
    socket.on('get-user-last-seen', ({ userId }) => {
        const isOnline = userSocketMap.has(userId);
        const lastSeen = isOnline ? new Date() : getUserLastSeen(userId);

        socket.emit('user-last-seen', {
            userId,
            isOnline,
            lastSeen,
            lastSeenText: isOnline ? 'Online' : formatLastSeen(lastSeen)
        });
    });

    // Update last seen on user activity
    socket.on('user-activity', async ({ userId }) => {
        if (userId) {
            await updateLastSeen(userId);
        }
    });

    // socket.on('send-private-message', async ({ payload, recipientId }) => {
    //     const recipientSocketId = userSocketMap.get(recipientId);

    //     // Update sender's last seen
    //     const senderUser = onlineUsers.get(socket.id);
    //     if (senderUser) {
    //         await updateLastSeen(senderUser.id);
    //     }

    //     if (recipientSocketId) {
    //         io.to(recipientSocketId).emit('received-message', payload);
    //         console.log(`Private message sent to ${recipientId} (Socket: ${recipientSocketId})`);
    //     } else {
    //         console.log(`Recipient ${recipientId} is offline or not found`);
    //     }
    // });

    socket.on('send-private-message', async ({ payload, recipientId }) => {
        try {
            const senderUser = onlineUsers.get(socket.id);
            if (!senderUser) {
                socket.emit('message_send_error', { error: 'User not authenticated' });
                return;
            }

            // Check if sender is blocked by recipient
            const recipient = await User.findById(recipientId);
            if (recipient && recipient.blockedUsers && recipient.blockedUsers.includes(senderUser.id)) {
                socket.emit('message_send_error', {
                    error: 'Cannot send message to this user',
                    reason: 'blocked'
                });
                return;
            }

            // Check if recipient is blocked by sender
            const sender = await User.findById(senderUser.id);
            if (sender && sender.blockedUsers && sender.blockedUsers.includes(recipientId)) {
                socket.emit('message_send_error', {
                    error: 'Cannot send message to this user',
                    reason: 'blocked'
                });
                return;
            }

            const recipientSocketId = userSocketMap.get(recipientId);

            // Update sender's last seen
            await updateLastSeen(senderUser.id);

            if (recipientSocketId) {
                io.to(recipientSocketId).emit('received-message', payload);
                console.log(`Private message sent to ${recipientId} (Socket: ${recipientSocketId})`);
            } else {
                console.log(`Recipient ${recipientId} is offline or not found`);
            }

        } catch (error) {
            console.error('Error sending private message:', error);
            socket.emit('message_send_error', { error: 'Failed to send message' });
        }
    });
    socket.on('send-message', async message => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            await updateLastSeen(user.id);
        }

        socket.broadcast.emit('received-message', message);
    });

    socket.on('typing', async ({ from, to }) => {
        // Update last seen on typing activity
        await updateLastSeen(from);

        if (to) {
            const recipientSocketId = userSocketMap.get(to);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('user-typing', { from, to });
            }
        } else {
            socket.broadcast.emit('user-typing', { from });
        }
    });

    socket.on('stop-typing', ({ from, to }) => {
        if (to) {
            const recipientSocketId = userSocketMap.get(to);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('user-stop-typing', { from, to });
            }
        } else {
            socket.broadcast.emit('user-stop-typing', { from });
        }
    });

    socket.on('user-left', async ({ userId }, callback) => {
        if (userId) {
            const socketId = userSocketMap.get(userId);
            if (socketId) {
                onlineUsers.delete(socketId);
            }
            userSocketMap.delete(userId);

            // Set user offline and update last seen
            await setUserOffline(userId);

            const lastSeen = getUserLastSeen(userId);
            io.emit('user-left-broadcast', {
                userId,
                isOnline: false,
                lastSeen,
                lastSeenText: formatLastSeen(lastSeen)
            });

            io.emit('online-users', Array.from(onlineUsers.values()));

            console.log(`User explicitly left: ${userId}`);

            if (callback) callback();
        }
    });

    socket.on('join-group', async (data) => {
        const { groupId, userId } = data;
        socket.join(groupId);

        // Update last seen on group activity
        await updateLastSeen(userId);

        console.log(`✅ User ${userId} joined group room ${groupId}`);
        console.log(`✅ Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms));
    });

    socket.on('create-group', async (group) => {
        console.log(`Group created: ${group.name} (ID: ${group.id})`);

        if (!group.id) {
            console.log('Group creation failed. Group ID is missing.');
            return;
        }

        // Update creator's last seen
        const creator = onlineUsers.get(socket.id);
        if (creator) {
            await updateLastSeen(creator.id);
        }

        socket.join(group.id);
        console.log(`Creator joined group room: ${group.id}`);

        if (group.members && Array.isArray(group.members)) {
            group.members.forEach(memberId => {
                const memberSocketId = userSocketMap.get(memberId);
                if (memberSocketId) {
                    io.to(memberSocketId).emit('group-created', group);

                    const memberSocket = io.sockets.sockets.get(memberSocketId);
                    if (memberSocket) {
                        memberSocket.join(group.id);
                        console.log(`User ${memberId} auto-joined group ${group.id}`);
                    }

                    console.log(`Group notification sent to user ${memberId} (Socket: ${memberSocketId})`);
                }
            });
        }
    });

    socket.on('send-group-message', async (payload) => {
        console.log('Sending message to group:', payload.groupId);

        // Update sender's last seen
        const sender = onlineUsers.get(socket.id);
        if (sender) {
            await updateLastSeen(sender.id);
        }

        if (!socket.rooms.has(payload.groupId)) {
            socket.join(payload.groupId);
            console.log(`Added sender to group room: ${payload.groupId}`);
        }

        io.to(payload.groupId).emit('received-group-message', payload);
        console.log(`Message broadcast in group ${payload.groupId} by ${payload.senderId}: ${payload.message}`);
    });

    socket.on('group-typing', async ({ groupId, userId, userName }) => {
        console.log(`🟢 Server: User ${userName} (${userId}) is typing in group ${groupId}`);

        // Update last seen on typing activity
        await updateLastSeen(userId);

        if (!socket.rooms.has(groupId)) {
            socket.join(groupId);
            console.log(`🟢 Added socket ${socket.id} to group room ${groupId}`);
        }

        socket.to(groupId).emit('group-typing', {
            groupId,
            id: userId,
            username: userName
        });

        console.log(`🟢 Broadcasted group-typing to group ${groupId} from user ${userName}`);
    });

    socket.on('group-stop-typing', ({ groupId, userId, userName }) => {
        console.log(`🟡 Server: User ${userName} (${userId}) stopped typing in group ${groupId}`);

        if (!socket.rooms.has(groupId)) {
            socket.join(groupId);
            console.log(`🟡 Added socket ${socket.id} to group room ${groupId}`);
        }

        socket.to(groupId).emit('group-stop-typing', {
            groupId,
            id: userId,
            username: userName
        });

        console.log(`🟡 Broadcasted group-stop-typing to group ${groupId} from user ${userName}`);
    });

    // Individual call handlers (existing) - with last seen updates
    socket.on('call-request', async ({ to, from, fromName, type, offer }) => {
        console.log(`📞 Call request from ${fromName} to ${to} (Type: ${type})`);

        // Update caller's last seen
        await updateLastSeen(from);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-request', {
                from,
                fromName,
                type,
                offer
            });
            console.log(`📞 Call request relayed to ${to} (Socket: ${recipientSocketId})`);
        } else {
            socket.emit('call-failed', { reason: 'User is offline' });
            console.log(`📞 Call request failed - recipient ${to} is offline`);
        }
    });

    socket.on('call-answer', async ({ to, answer }) => {
        console.log(`📞 Call answer from socket ${socket.id} to ${to}`);

        const user = onlineUsers.get(socket.id);
        if (user) {
            await updateLastSeen(user.id);
        }

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-answer', {
                from: onlineUsers.get(socket.id)?.id,
                answer
            });
            console.log(`📞 Call answer relayed to ${to} (Socket: ${recipientSocketId})`);
        }
    });

    socket.on('call-accepted', async ({ to }) => {
        console.log(`✅ Call accepted by socket ${socket.id}, notifying ${to}`);

        const user = onlineUsers.get(socket.id);
        if (user) {
            await updateLastSeen(user.id);
        }

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-accepted', {
                from: onlineUsers.get(socket.id)?.id
            });
            console.log(`✅ Call accepted notification sent to ${to}`);
        }
    });

    socket.on('call-failed', ({ to, reason, message }) => {
        io.to(to).emit('call-failed', { reason, message });
    });

    socket.on('call-declined', async ({ to }) => {
        console.log(`❌ Call declined by socket ${socket.id}, notifying ${to}`);

        const user = onlineUsers.get(socket.id);
        if (user) {
            await updateLastSeen(user.id);
        }

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-declined');
            console.log(`❌ Call declined notification sent to ${to}`);
        }
    });

    socket.on('call-ended', async ({ to }) => {
        console.log(`📞 Call ended by socket ${socket.id}, notifying ${to}`);

        const user = onlineUsers.get(socket.id);
        if (user) {
            await updateLastSeen(user.id);
        }

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-ended');
            console.log(`📞 Call ended notification sent to ${to}`);
        }
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        console.log(`🧊 ICE candidate from socket ${socket.id} to ${to}`);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('ice-candidate', {
                from: onlineUsers.get(socket.id)?.id,
                candidate
            });
            console.log(`🧊 ICE candidate relayed to ${to}`);
        }
    });

    // Group call handlers (existing) - with last seen updates
    socket.on('group-call-request', async ({ groupId, groupName, members, from, fromName, type }) => {
        console.log(`📞 Group call request from ${fromName} to group ${groupName} (Type: ${type})`);

        // Update initiator's last seen
        await updateLastSeen(from);

        if (!activeGroupCalls.has(groupId)) {
            activeGroupCalls.set(groupId, {
                participants: new Set([from]),
                callType: type,
                initiator: from
            });
        }

        if (!members || !Array.isArray(members)) {
            console.error('❌ Invalid members array:', members);
            socket.emit('group-call-error', {
                message: 'No group members found. Please refresh and try again.'
            });
            return;
        }

        const cleanMembers = members
            .map(member => {
                if (typeof member === 'string') return member;
                if (typeof member === 'object' && member?.id) return member.id;
                if (typeof member === 'object' && member?._id) return member._id;
                return null;
            })
            .filter(memberId => memberId != null && memberId !== '');

        if (cleanMembers.length === 0) {
            console.error('❌ No valid members found after cleaning');
            socket.emit('group-call-error', {
                message: 'No valid group members found. Please check the group configuration.'
            });
            return;
        }

        let notificationsSent = 0;
        const offlineMembers = [];

        cleanMembers.forEach((memberId, index) => {
            if (memberId === from) {
                return;
            }

            const memberSocketId = userSocketMap.get(memberId);
            if (memberSocketId) {
                io.to(memberSocketId).emit('group-call-request', {
                    groupId,
                    groupName,
                    members: cleanMembers,
                    from,
                    fromName,
                    type
                });
                notificationsSent++;
                console.log(`📞 ✅ Group call request sent to ${memberId} (Socket: ${memberSocketId})`);
            } else {
                offlineMembers.push(memberId);
                console.log(`📞 ❌ Group member ${memberId} is offline or not found in userSocketMap`);
            }
        });

        if (notificationsSent === 0) {
            socket.emit('group-call-error', {
                message: 'No group members are currently online.'
            });
        } else if (offlineMembers.length > 0) {
            socket.emit('group-call-partial', {
                message: `${offlineMembers.length} member(s) are offline and won't receive the call.`,
                onlineCount: notificationsSent,
                offlineCount: offlineMembers.length
            });
        }
    });

    // Other group call handlers remain the same but add last seen updates...
    socket.on('group-call-join', async ({ groupId, userId, userName }) => {
        await updateLastSeen(userId);
        // ... rest of existing code
    });

    socket.on('message-deleted', (data) => {
        const { messageId, senderId, recipientId, isPrivate } = data;

        if (isPrivate && recipientId) {
            socket.to(recipientId).emit('message-deleted', { messageId, senderId });
        }

        console.log(`Message ${messageId} deleted by ${senderId}`);
    });

    socket.on('group-message-deleted', (data) => {
        const { messageId, senderId, groupId } = data;

        socket.to(groupId).emit('group-message-deleted', { messageId, senderId, groupId });

        console.log(`Group message ${messageId} deleted by ${senderId} in group ${groupId}`);
    });

    socket.on('block_user', async ({ userId, blockedBy }) => {
        try {
            console.log(`🚫 User ${blockedBy} is blocking user ${userId}`);

            // Update blocker's last seen
            await updateLastSeen(blockedBy);

            // Update database - add userId to blockedBy's blocked list
            await User.findByIdAndUpdate(blockedBy, {
                $addToSet: { blockedUsers: userId }
            });

            // Optionally, you can also add the blocker to the blocked user's blockedBy list
            await User.findByIdAndUpdate(userId, {
                $addToSet: { blockedBy: blockedBy }
            });

            // Emit to the blocked user that they've been blocked (optional)
            const blockedUserSocketId = userSocketMap.get(userId);
            if (blockedUserSocketId) {
                io.to(blockedUserSocketId).emit('user_blocked_you', {
                    blockedBy: blockedBy
                });
            }

            // Confirm to the blocker that the action was successful
            socket.emit('user_blocked_success', {
                blockedUserId: userId
            });

            console.log(`✅ User ${userId} has been blocked by ${blockedBy}`);

        } catch (error) {
            console.error('❌ Error blocking user:', error);
            socket.emit('user_blocked_error', {
                error: 'Failed to block user',
                details: error.message
            });
        }
    });

    socket.on('leave_group', async ({ groupId, userId }) => {
        try {
            console.log(`🚪 User ${userId} is leaving group ${groupId}`);

            // Update user's last seen
            await updateLastSeen(userId);

            // Remove user from group in database
            const Group = require('./models/group');
            const group = await Group.findByIdAndUpdate(
                groupId,
                { $pull: { members: userId } },
                { new: true }
            ).populate('members', 'name email');

            if (!group) {
                socket.emit('leave_group_error', {
                    error: 'Group not found'
                });
                return;
            }

            // Leave the socket room
            socket.leave(groupId);

            // Notify remaining group members
            socket.to(groupId).emit('user_left_group', {
                groupId: groupId,
                userId: userId,
                userName: onlineUsers.get(socket.id)?.name || 'Unknown User',
                updatedGroup: group
            });

            // Confirm to the user that they left successfully
            socket.emit('left_group_success', {
                groupId: groupId
            });

            console.log(`✅ User ${userId} has left group ${groupId}`);

            // If group is empty, optionally delete it
            if (group.members.length === 0) {
                await Group.findByIdAndDelete(groupId);
                console.log(`🗑️ Empty group ${groupId} has been deleted`);
            }

        } catch (error) {
            console.error('❌ Error leaving group:', error);
            socket.emit('leave_group_error', {
                error: 'Failed to leave group',
                details: error.message
            });
        }
    });

    // Add handler for unblocking user (optional)
    socket.on('unblock_user', async ({ userId, unblockedBy }) => {
        try {
            console.log(`✅ User ${unblockedBy} is unblocking user ${userId}`);

            // Update unblocker's last seen
            await updateLastSeen(unblockedBy);

            // Remove userId from unblockedBy's blocked list
            await User.findByIdAndUpdate(unblockedBy, {
                $pull: { blockedUsers: userId }
            });

            // Remove the unblocker from the user's blockedBy list
            await User.findByIdAndUpdate(userId, {
                $pull: { blockedBy: unblockedBy }
            });

            // Emit to the unblocked user (optional)
            const unblockedUserSocketId = userSocketMap.get(userId);
            if (unblockedUserSocketId) {
                io.to(unblockedUserSocketId).emit('user_unblocked_you', {
                    unblockedBy: unblockedBy
                });
            }

            // Confirm to the unblocker
            socket.emit('user_unblocked_success', {
                unblockedUserId: userId
            });

            console.log(`✅ User ${userId} has been unblocked by ${unblockedBy}`);

        } catch (error) {
            console.error('❌ Error unblocking user:', error);
            socket.emit('user_unblocked_error', {
                error: 'Failed to unblock user',
                details: error.message
            });
        }
    });

    socket.on('disconnect', async () => {
        if (onlineUsers.has(socket.id)) {
            const user = onlineUsers.get(socket.id);
            const roomsArray = Array.from(socket.rooms);

            // Set user offline and update last seen
            await setUserOffline(user.id);

            // Clean up typing indicators
            roomsArray.forEach(roomId => {
                if (roomId !== socket.id) {
                    socket.to(roomId).emit('group-stop-typing', {
                        groupId: roomId,
                        id: user.id,
                        username: user.name
                    });
                }
            });

            // Clean up group calls
            activeGroupCalls.forEach((groupCall, groupId) => {
                if (groupCall.participants.has(user.id)) {
                    groupCall.participants.delete(user.id);

                    const groupCallRoom = `group-call-${groupId}`;
                    socket.to(groupCallRoom).emit('group-participant-left', {
                        userId: user.id
                    });

                    if (groupCall.participants.size === 0) {
                        activeGroupCalls.delete(groupId);
                    }
                }
            });

            onlineUsers.delete(socket.id);
            userSocketMap.delete(user.id);

            const lastSeen = getUserLastSeen(user.id);
            io.emit('user-left-broadcast', {
                userId: user.id,
                isOnline: false,
                lastSeen,
                lastSeenText: formatLastSeen(lastSeen)
            });

            io.emit('online-users', Array.from(onlineUsers.values()));

            console.log(`❌ User disconnected: ${user.name} (ID: ${user.id})`);
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});