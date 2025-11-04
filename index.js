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
const statusRoutes = require('./routes/statusRoutes')
const profileRoutes = require('./routes/profileRoutes')
const friendRoutes = require('./routes/friendRoutes'); // Add friend routes
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
app.use('/api/status', statusRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/friends', friendRoutes);

const io = new Server(server, {
    cors: {
        origin: 'https://chat-application-reactjs-nodejs.netlify.app',
        // origin: 'http://localhost:5173',
        pingTimeout: 10000,
        methods: ['GET', 'POST']
    }
});
app.set('io', io);
const onlineUsers = new Map();
const userSocketMap = new Map();
// Add last seen tracking
const userLastSeen = new Map(); // userId -> timestamp
const activeGroupCalls = new Map(); // groupId -> { participants: Map, callType: 'voice'|'video', initiator: string }
const groupTypingUsers = new Map(); // Map<groupId, Set<userId>>
const groupTypingTimeouts = new Map();
const userHeartbeats = new Map();
const TYPING_TIMEOUT_DURATION = 6000;

// Helper function to update last seen
// const updateLastSeen = async (userId) => {
//     const timestamp = new Date();
//     userLastSeen.set(userId, timestamp);
//     try {
//         await User.findByIdAndUpdate(userId, {
//             lastSeen: timestamp,
//             isOnline: true
//         });
//     } catch (error) {
//         console.error('Error updating last seen in database:', error);
//     }
// };

const updateLastSeen = async (userId) => {
    const timestamp = new Date();
    userLastSeen.set(userId, timestamp);
    userHeartbeats.set(userId, timestamp);

    try {
        await User.findByIdAndUpdate(userId, {
            lastSeen: timestamp,
            isOnline: true
        });
    } catch (error) {
        console.error('Error updating last seen in DB:', error);
    }
};

const isUserTrulyOnline = (userId) => {
    const socketId = userSocketMap.get(userId);
    const hasSocket = socketId && onlineUsers.has(socketId);
    const lastHeartbeat = userHeartbeats.get(userId);
    const heartbeatRecent = lastHeartbeat && (Date.now() - lastHeartbeat.getTime() < 45000);
    return hasSocket && heartbeatRecent;
};

// Helper function to set user offline
const setUserOffline = async (userId) => {
    const timestamp = new Date();
    userLastSeen.set(userId, timestamp);
    userHeartbeats.delete(userId);

    try {
        const user = await User.findByIdAndUpdate(userId, {
            lastSeen: timestamp,
            isOnline: false
        }).select('lastSeen');

        const dbLastSeen = user?.lastSeen || timestamp;

        io.emit('user-status-updated', {
            userId,
            isOnline: false,
            lastSeen: dbLastSeen,
            lastSeenText: formatLastSeen(dbLastSeen)
        });
    } catch (error) {
        console.error('Error setting user offline:', error);
    }
};

// Helper function to get user's last seen info
const getUserLastSeen = async (userId) => {
    const inMemory = userLastSeen.get(userId);
    if (inMemory) return inMemory;

    try {
        const user = await User.findById(userId).select('lastSeen');
        return user?.lastSeen || null;
    } catch (error) {
        return null;
    }
};

// Helper function to format last seen text
const formatLastSeen = (lastSeenTime) => {
    if (!lastSeenTime || isNaN(new Date(lastSeenTime).getTime())) return 'Never';

    const now = new Date();
    const last = new Date(lastSeenTime);
    const diffMs = now - last;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

    // Yesterday check
    const isYesterday =
        now.getDate() === last.getDate() + 1 &&
        now.getMonth() === last.getMonth() &&
        now.getFullYear() === last.getFullYear();
    if (isYesterday) return 'Yesterday';

    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return last.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

const getUserFriends = async (userId) => {
    try {
        const user = await User.findById(userId).select('friends').lean();
        return user ? user.friends.map(id => id.toString()) : [];
    } catch (error) {
        console.error('Error fetching user friends:', error);
        return [];
    }
};

// Helper function to emit to specific users only
const emitToUsers = (io, userIds, event, data) => {
    userIds.forEach(userId => {
        io.to(userId).emit(event, data);
    });
};
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/documents', express.static('documents'));
app.use('/audio', express.static(path.join(__dirname, 'audio')));
app.use('/videos', express.static(path.join(__dirname, 'videos')));
app.use('/story', express.static(path.join(__dirname, 'story')));

// Add endpoint to get user's last seen
app.get('/api/users/:userId/last-seen', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId).select('lastSeen isOnline');
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isOnline = isUserTrulyOnline(userId);
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

            // onlineUsers.set(socket.id, { id: user.id, name: user.username });
            // userSocketMap.set(user.id, socket.id);
            // await updateLastSeen(user.id);

            // console.log(`✅ User joined: ${user.username} (UserID: ${user.id}, SocketID: ${socket.id})`);


            const existingSocketId = userSocketMap.get(user.id);
            if (existingSocketId && existingSocketId !== socket.id) {
                onlineUsers.delete(existingSocketId);
                console.log(`🔄 Replacing old socket connection for user ${user.id}`);
            }

            onlineUsers.set(socket.id, { id: user.id, name: user.username });
            userSocketMap.set(user.id, socket.id);
            await updateLastSeen(user.id);

            console.log(`✅ User joined: ${user.username} (UserID: ${user.id}, SocketID: ${socket.id})`);

            // Broadcast online status to all clients
            io.emit('user-status-updated', {
                userId: user.id,
                isOnline: true,
                lastSeen: new Date(),
                lastSeenText: 'Online'
            });

            // CRITICAL FIX: Process undelivered GROUP messages with immediate sender notification
            try {
                const Message = require('./models/message');
                const Group = require('./models/group');

                // Get user's groups
                const userGroups = await Group.find({ members: user.id }, '_id');
                const userGroupIds = userGroups.map(group => group._id);

                // Find undelivered GROUP messages in user's groups
                const undeliveredGroupMessages = await Message.find({
                    groupId: { $in: userGroupIds },
                    messageStatus: 'sent',
                    senderId: { $ne: user.id }
                }).populate('senderId', 'name');

                console.log(`📬 Found ${undeliveredGroupMessages.length} undelivered group messages for user ${user.id}`);

                if (undeliveredGroupMessages.length > 0) {
                    // Process each message
                    for (const message of undeliveredGroupMessages) {
                        // Update message status to delivered
                        await Message.findByIdAndUpdate(message._id, {
                            messageStatus: 'delivered',
                            deliveredAt: new Date()
                        });

                        // CRITICAL: Notify the message sender immediately
                        const senderSocketId = userSocketMap.get(message.senderId);
                        if (senderSocketId) {
                            io.to(senderSocketId).emit('group-message-delivered', {
                                messageId: message._id,
                                userId: user.id,
                                groupId: message.groupId,
                                deliveredAt: new Date(),
                                messageStatus: 'delivered'
                            });
                            console.log(`📬 ✅ Notified sender ${message.senderId} about delivery to ${user.id}`);
                        }
                    }

                    console.log(`📬 ✅ Processed ${undeliveredGroupMessages.length} group messages for delivery`);
                }

                // Also handle private messages (existing logic)
                const undeliveredPrivateMessages = await Message.find({
                    recipientId: user.id,
                    messageStatus: 'sent',
                    senderId: { $ne: user.id }
                });

                for (const message of undeliveredPrivateMessages) {
                    await Message.findByIdAndUpdate(message._id, {
                        messageStatus: 'delivered',
                        deliveredAt: new Date()
                    });

                    const senderSocketId = userSocketMap.get(message.senderId);
                    if (senderSocketId) {
                        io.to(senderSocketId).emit('message-delivered', {
                            messageId: message._id,
                            userId: user.id,
                            deliveredAt: new Date(),
                            messageStatus: 'delivered'
                        });
                    }
                }

            } catch (error) {
                console.error('❌ Error processing undelivered messages:', error);
            }

            // Rest of existing user-joined logic...
            // (Join groups, broadcast online status, etc.)

        } catch (error) {
            console.error('❌ Error processing user-joined event:', error);
        }
    });


    socket.on('heartbeat', async ({ userId }) => {
        if (userId) {
            await updateLastSeen(userId);

            // Emit updated status to all connected clients
            io.emit('user-status-updated', {
                userId,
                isOnline: true,
                lastSeen: new Date(),
                lastSeenText: 'Online'
            });

            console.log(`💓 Heartbeat received from user ${userId}`);
        }
    });

    // Add this event to manually request online status
    socket.on('request-online-status', ({ userId }) => {
        const isOnline = isUserTrulyOnline(userId);
        const lastSeen = userLastSeen.get(userId) || new Date();

        socket.emit('user-status-response', {
            userId,
            isOnline,
            lastSeen,
            lastSeenText: isOnline ? 'Online' : formatLastSeen(lastSeen)
        });
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

    socket.on('send-private-message', async ({ payload, recipientId }) => {
        try {
            const senderUser = onlineUsers.get(socket.id);
            if (!senderUser) {
                socket.emit('message_send_error', { error: 'User not authenticated' });
                return;
            }

            // Check friend relationship first
            const sender = await User.findById(senderUser.id).populate('friends');
            const recipient = await User.findById(recipientId);

            if (!sender || !recipient) {
                socket.emit('message_send_error', { error: 'User not found' });
                return;
            }

            // Check if they are friends
            const areFriends = sender.friends.some(friend => friend._id.toString() === recipientId);
            if (!areFriends) {
                socket.emit('message_send_error', {
                    error: 'You can only send messages to friends',
                    reason: 'not_friends'
                });
                return;
            }

            // Check blocking logic
            if (recipient.blockedUsers && recipient.blockedUsers.includes(senderUser.id)) {
                socket.emit('message_send_error', {
                    error: 'Cannot send message to this user',
                    reason: 'blocked'
                });
                return;
            }

            if (sender.blockedUsers && sender.blockedUsers.includes(recipientId)) {
                socket.emit('message_send_error', {
                    error: 'Cannot send message to this user',
                    reason: 'blocked'
                });
                return;
            }

            const recipientSocketId = userSocketMap.get(recipientId);
            await updateLastSeen(senderUser.id);

            console.log(`📨 Sending private message from ${senderUser.id} to ${recipientId}`);
            console.log(`📊 Recipient online status: ${recipientSocketId ? 'ONLINE' : 'OFFLINE'}`);

            if (recipientSocketId) {
                // Recipient is ONLINE - send message and auto-mark as delivered
                console.log(`✅ Recipient ${recipientId} is ONLINE, delivering message immediately`);

                // Send the message to recipient
                io.to(recipientSocketId).emit('received-message', {
                    ...payload,
                    replyTo: payload.replyTo || null
                });

                // CRITICAL FIX: Automatically mark as delivered since recipient is online
                const messageId = payload.id || payload._id;
                if (messageId) {
                    try {
                        const Message = require('./models/message');
                        await Message.findByIdAndUpdate(messageId, {
                            messageStatus: 'delivered',
                            deliveredAt: new Date()
                        });

                        // Notify sender immediately about delivery
                        socket.emit('message-delivered', {
                            messageId,
                            userId: recipientId,
                            deliveredAt: new Date(),
                            messageStatus: 'delivered'
                        });

                        console.log(`📬 ✅ Message ${messageId} auto-marked as DELIVERED (recipient online)`);
                    } catch (error) {
                        console.error('❌ Error auto-marking message as delivered:', error);
                    }
                }

                console.log(`📨 ✅ Private message sent to ${recipientId} (Socket: ${recipientSocketId})`);
            } else {
                // Recipient is OFFLINE - message stays as 'sent' 
                console.log(`📱 ❌ Recipient ${recipientId} is OFFLINE, message remains as 'sent'`);
            }

            if (payload.replyTo) {
                console.log(`📝 Message with reply sent - Reply to: ${payload.replyTo.message}`);
            }

        } catch (error) {
            console.error('❌ Error sending private message:', error);
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
        console.log(`🟢 User ${from} is typing to ${to}`);

        await updateLastSeen(from);

        if (to) {
            const recipientSocketId = userSocketMap.get(to);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('user-typing', { from, to });
                console.log(`✅ Typing event delivered to ${to}`);
            } else {
                console.log(`❌ Recipient ${to} is offline`);
            }
        }
    });

    socket.on('stop-typing', async ({ from, to }) => {
        console.log(`🔴 User ${from} stopped typing to ${to}`);

        await updateLastSeen(from);

        if (to) {
            const recipientSocketId = userSocketMap.get(to);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('user-stop-typing', { from, to });
                console.log(`✅ Stop-typing event delivered to ${to}`);
            } else {
                console.log(`❌ Recipient ${to} is offline`);
            }
        }
    });

    socket.on('user-typing', ({ from, to }) => {
        if (meRef.current && selectedUserRef.current && to === meRef.current.id && from === selectedUserRef.current.id) {
            console.log(`🟢 Received typing from ${from}`);
            setTypingUsers(prev => new Set(prev).add(from));
        }
    });

    socket.on('user-stop-typing', ({ from, to }) => {
        if (meRef.current && to === meRef.current.id) {
            console.log(`🔴 Received stop-typing from ${from}`);
            setTypingUsers(prev => {
                const updatedSet = new Set(prev);
                updatedSet.delete(from);
                return updatedSet;
            });
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
        console.log('📨 Sending message to group:', payload.groupId);

        const sender = onlineUsers.get(socket.id);
        if (sender) {
            await updateLastSeen(sender.id);
        }

        if (!socket.rooms.has(payload.groupId)) {
            socket.join(payload.groupId);
            console.log(`Added sender to group room: ${payload.groupId}`);
        }

        const messageId = payload.id || payload._id;
        console.log(`📊 Group message ID: ${messageId}`);

        // Send message to all group members
        const completePayload = {
            ...payload,
            replyTo: payload.replyTo || null
        };

        // CRITICAL FIX: Emit to group members EXCEPT sender to avoid duplicate messages
        socket.to(payload.groupId).emit('received-group-message', completePayload);

        // CRITICAL FIX: Enhanced auto-delivery logic for online group members
        if (messageId && sender) {
            try {
                const Group = require('./models/group');
                const group = await Group.findById(payload.groupId).populate('members', '_id name');

                if (group) {
                    const onlineMembers = group.members.filter(member =>
                        member._id.toString() !== sender.id && // Exclude sender
                        userSocketMap.has(member._id.toString()) // Only online members
                    );

                    console.log(`📊 Group has ${group.members.length} total members, ${onlineMembers.length} are online (excluding sender)`);

                    if (onlineMembers.length > 0) {
                        // CRITICAL: Update message status to delivered in database
                        const Message = require('./models/message');
                        await Message.findByIdAndUpdate(messageId, {
                            messageStatus: 'delivered',
                            deliveredAt: new Date()
                        });

                        // CRITICAL: Immediately notify sender about delivery status
                        socket.emit('group-message-delivered', {
                            messageId,
                            userId: 'auto_delivery', // Special indicator for auto-delivery
                            groupId: payload.groupId,
                            deliveredAt: new Date(),
                            messageStatus: 'delivered',
                            onlineMembersCount: onlineMembers.length
                        });

                        console.log(`📬 ✅ Group message ${messageId} auto-marked as DELIVERED and sender notified`);

                        // CRITICAL: Set up auto-read logic after 3 seconds
                        // setTimeout(async () => {
                        //     try {
                        //         await Message.findByIdAndUpdate(messageId, {
                        //             messageStatus: 'read',
                        //             readAt: new Date()
                        //         });

                        //         socket.emit('group-message-read', {
                        //             messageId,
                        //             userId: 'auto_read',
                        //             groupId: payload.groupId,
                        //             readAt: new Date(),
                        //             messageStatus: 'read'
                        //         });

                        //         console.log(`👁️ ✅ Group message ${messageId} auto-marked as READ and sender notified`);
                        //     } catch (error) {
                        //         console.error('❌ Error auto-marking message as read:', error);
                        //     }
                        // }, 3000);
                        console.log(`📬 ✅ Group message ${messageId} auto-marked as DELIVERED and sender notified`);
                    } else {
                        console.log(`📱 ❌ No online members in group, message remains as 'sent'`);
                    }
                }
            } catch (error) {
                console.error('❌ Error processing group message delivery:', error);
            }
        }

        console.log(`📨 ✅ Message broadcast in group ${payload.groupId} by ${payload.senderId}`);
    });


    // socket.on('group-typing', async ({ groupId, userId, userName }) => {
    //     console.log(`🟢 Server: User ${userName} (${userId}) is typing in group ${groupId}`);

    //     // Update last seen on typing activity
    //     await updateLastSeen(userId);

    //     if (!socket.rooms.has(groupId)) {
    //         socket.join(groupId);
    //         console.log(`🟢 Added socket ${socket.id} to group room ${groupId}`);
    //     }

    //     socket.to(groupId).emit('group-typing', {
    //         groupId,
    //         id: userId,
    //         username: userName
    //     });

    //     console.log(`🟢 Broadcasted group-typing to group ${groupId} from user ${userName}`);
    // });

    // socket.on('group-stop-typing', ({ groupId, userId, userName }) => {
    //     console.log(`🟡 Server: User ${userName} (${userId}) stopped typing in group ${groupId}`);

    //     if (!socket.rooms.has(groupId)) {
    //         socket.join(groupId);
    //         console.log(`🟡 Added socket ${socket.id} to group room ${groupId}`);
    //     }

    //     socket.to(groupId).emit('group-stop-typing', {
    //         groupId,
    //         id: userId,
    //         username: userName
    //     });

    //     console.log(`🟡 Broadcasted group-stop-typing to group ${groupId} from user ${userName}`);
    // });

    socket.on('group-typing', async ({ groupId, userId, userName }) => {
        console.log(`🟢 Server: User ${userName} (${userId}) is typing in group ${groupId}`);

        await updateLastSeen(userId);

        // CRITICAL FIX: Track typing users per group on the server
        if (!groupTypingUsers.has(groupId)) {
            groupTypingUsers.set(groupId, new Set());
        }

        const typersInGroup = groupTypingUsers.get(groupId);
        typersInGroup.add(userId);

        console.log(`📊 Current typers in group ${groupId}:`, Array.from(typersInGroup));

        // Ensure socket is in the group room
        if (!socket.rooms.has(groupId)) {
            socket.join(groupId);
            console.log(`🔄 Added socket ${socket.id} to group room ${groupId}`);
        }

        // CRITICAL: Broadcast to ALL group members INCLUDING sender for consistency
        io.to(groupId).emit('group-typing', {
            groupId,
            id: userId,
            username: userName
        });

        console.log(`✅ Group-typing broadcasted to ALL members in group ${groupId}`);

        // CRITICAL FIX: Auto-clear typing after timeout
        const timeoutKey = `${groupId}-${userId}`;

        // Clear existing timeout for this user
        if (groupTypingTimeouts.has(timeoutKey)) {
            clearTimeout(groupTypingTimeouts.get(timeoutKey));
        }

        // Set new timeout
        const timeout = setTimeout(() => {
            console.log(`⏰ Auto-clearing typing for ${userName} in group ${groupId}`);

            const typersInGroup = groupTypingUsers.get(groupId);
            if (typersInGroup) {
                typersInGroup.delete(userId);

                if (typersInGroup.size === 0) {
                    groupTypingUsers.delete(groupId);
                }
            }

            // Broadcast stop-typing to all group members
            io.to(groupId).emit('group-stop-typing', {
                groupId,
                id: userId,
                username: userName
            });

            groupTypingTimeouts.delete(timeoutKey);
            console.log(`✅ Auto-cleared typing for ${userName} in group ${groupId}`);
        }, TYPING_TIMEOUT_DURATION);

        groupTypingTimeouts.set(timeoutKey, timeout);
    });

    socket.on('group-stop-typing', async ({ groupId, userId, userName }) => {
        console.log(`🔴 Server: User ${userName} (${userId}) stopped typing in group ${groupId}`);

        await updateLastSeen(userId);

        // CRITICAL FIX: Remove user from server-side typing tracking
        const typersInGroup = groupTypingUsers.get(groupId);
        if (typersInGroup) {
            typersInGroup.delete(userId);

            if (typersInGroup.size === 0) {
                groupTypingUsers.delete(groupId);
            }

            console.log(`📊 Remaining typers in group ${groupId}:`, Array.from(typersInGroup || []));
        }

        // Clear the auto-timeout
        const timeoutKey = `${groupId}-${userId}`;
        const existingTimeout = groupTypingTimeouts.get(timeoutKey);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            groupTypingTimeouts.delete(timeoutKey);
            console.log(`🧹 Cleared timeout for ${userName} in group ${groupId}`);
        }

        // Ensure socket is in the group room
        if (!socket.rooms.has(groupId)) {
            socket.join(groupId);
            console.log(`🔄 Added socket ${socket.id} to group room ${groupId}`);
        }

        // CRITICAL: Broadcast to ALL group members INCLUDING sender
        io.to(groupId).emit('group-stop-typing', {
            groupId,
            id: userId,
            username: userName
        });

        console.log(`✅ Group-stop-typing broadcasted to ALL members in group ${groupId}`);
    });

    // Individual call handlers (existing) - with last seen updates
    socket.on('call-request', async ({ to, from, fromName, type, offer }) => {
        console.log(`📞 ${fromName} calling ${to} (${type})`);

        await updateLastSeen(from);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-request', {
                from,
                fromName,
                type,
                offer
            });
            console.log(`✅ Call request sent`);
        } else {
            socket.emit('call-failed', { reason: 'User is offline' });
            console.log(`❌ User offline`);
        }
    });

    socket.on('call-answer', async ({ to, answer }) => {
        console.log(`📞 Sending answer to ${to}`);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            const answererUser = onlineUsers.get(socket.id);

            io.to(recipientSocketId).emit('call-answer', {
                from: answererUser?.id,
                answer
            });
            console.log(`✅ Answer sent`);
        } else {
            console.log(`❌ Recipient not found`);
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

    // FIXED GROUP CALL HANDLERS - COMPLETE IMPLEMENTATIONS
    socket.on('group-call-request', async ({ groupId, groupName, members, from, fromName, type }) => {
        console.log(`📞 Group call request from ${fromName} to group ${groupName} (Type: ${type})`);

        // Update initiator's last seen
        await updateLastSeen(from);

        // Initialize group call if it doesn't exist
        if (!activeGroupCalls.has(groupId)) {
            activeGroupCalls.set(groupId, {
                participants: new Map(),
                callType: type,
                initiator: from
            });
        }

        const groupCall = activeGroupCalls.get(groupId);

        // CRITICAL FIX: Add the initiator to the call immediately
        groupCall.participants.set(from, {
            userId: from,
            userName: fromName,
            socketId: socket.id
        });

        // Join the initiator to the call room
        const callRoom = `group-call-${groupId}`;
        socket.join(callRoom);

        // CRITICAL FIX: Activate the interface for the initiator immediately
        socket.emit('group-call-joined', {
            participants: [{ userId: from, userName: fromName }],
            callType: type
        });

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

        cleanMembers.forEach((memberId) => {
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

    socket.on('group-call-join', async ({ groupId, userId, userName }) => {
        console.log(`📞 User ${userName} (${userId}) joining group call ${groupId}`);

        await updateLastSeen(userId);

        const groupCall = activeGroupCalls.get(groupId);
        if (!groupCall) {
            socket.emit('group-call-error', { message: 'Group call not found' });
            return;
        }

        // Join the call room
        const callRoom = `group-call-${groupId}`;
        socket.join(callRoom);

        // Add participant to active call
        groupCall.participants.set(userId, {
            userId,
            userName,
            socketId: socket.id
        });

        // Get current participants for ALL users
        const currentParticipants = Array.from(groupCall.participants.entries())
            .map(([id, participant]) => ({
                userId: id,
                userName: participant.userName
            }));

        // CRITICAL FIX: Notify ALL participants in the call room about the current state
        // This ensures everyone's interface stays active and shows all participants
        io.to(callRoom).emit('group-call-joined', {
            participants: currentParticipants,
            callType: groupCall.callType,
            newJoiner: { userId, userName } // Info about who just joined
        });

        // Also notify existing participants specifically about the new joiner
        socket.to(callRoom).emit('group-participant-joined', {
            userId,
            userName
        });

        console.log(`✅ User ${userName} joined group call ${groupId}, total participants: ${groupCall.participants.size}`);
    });

    socket.on('group-call-offer', async ({ groupId, to, from, fromName, offer }) => {
        console.log(`📞 Relaying offer from ${fromName} (${from}) to ${to} in group ${groupId}`);

        await updateLastSeen(from);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('group-call-offer', {
                from,
                fromName,
                offer,
                groupId
            });
            console.log(`✅ Offer relayed to ${to}`);
        } else {
            console.log(`❌ Recipient ${to} not found for offer`);
        }
    });

    socket.on('group-call-answer', async ({ groupId, to, from, fromName, answer }) => {
        console.log(`📞 Relaying answer from ${fromName || from} (${from}) to ${to} in group ${groupId}`);

        await updateLastSeen(from);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('group-call-answer', {
                from,
                fromName,
                answer,
                groupId
            });
            console.log(`✅ Answer relayed to ${to}`);
        } else {
            console.log(`❌ Recipient ${to} not found for answer`);
        }
    });

    socket.on('group-ice-candidate', async ({ groupId, to, from, candidate }) => {
        console.log(`🧊 Relaying ICE candidate from ${from} to ${to} in group ${groupId}`);

        const senderUser = onlineUsers.get(socket.id);
        if (senderUser) {
            await updateLastSeen(senderUser.id);
        }

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('group-ice-candidate', {
                from,
                candidate,
                groupId
            });
            console.log(`✅ ICE candidate relayed to ${to}`);
        } else {
            console.log(`❌ Recipient ${to} not found for ICE candidate`);
        }
    });

    socket.on('group-call-declined', async ({ groupId, userId }) => {
        console.log(`❌ User ${userId} declined group call ${groupId}`);

        await updateLastSeen(userId);

        const groupCall = activeGroupCalls.get(groupId);
        if (groupCall) {
            groupCall.participants.delete(userId);

            // Notify other participants
            const callRoom = `group-call-${groupId}`;
            socket.to(callRoom).emit('group-participant-left', { userId });

            // CRITICAL FIX: Update remaining participants with current participant list
            const remainingParticipants = Array.from(groupCall.participants.entries())
                .map(([id, participant]) => ({
                    userId: id,
                    userName: participant.userName
                }));

            if (remainingParticipants.length > 0) {
                io.to(callRoom).emit('group-call-joined', {
                    participants: remainingParticipants,
                    callType: groupCall.callType
                });
            }

            // If no participants left, end the call
            if (groupCall.participants.size === 0) {
                activeGroupCalls.delete(groupId);
                io.to(callRoom).emit('group-call-ended');
                console.log(`🔚 Group call ${groupId} ended (no participants)`);
            }
        }
    });

    socket.on('group-call-left', async ({ groupId, userId }) => {
        console.log(`👋 User ${userId} left group call ${groupId}`);

        await updateLastSeen(userId);

        const groupCall = activeGroupCalls.get(groupId);
        if (groupCall) {
            groupCall.participants.delete(userId);

            // Leave the call room
            socket.leave(`group-call-${groupId}`);

            // Notify other participants
            const callRoom = `group-call-${groupId}`;
            socket.to(callRoom).emit('group-participant-left', { userId });

            // CRITICAL FIX: Update remaining participants with current participant list
            const remainingParticipants = Array.from(groupCall.participants.entries())
                .map(([id, participant]) => ({
                    userId: id,
                    userName: participant.userName
                }));

            if (remainingParticipants.length > 0) {
                io.to(callRoom).emit('group-call-joined', {
                    participants: remainingParticipants,
                    callType: groupCall.callType
                });
            }

            console.log(`✅ User ${userId} left group call, remaining participants: ${groupCall.participants.size}`);

            // If no participants left, end the call
            if (groupCall.participants.size === 0) {
                activeGroupCalls.delete(groupId);
                io.to(callRoom).emit('group-call-ended');
                console.log(`🔚 Group call ${groupId} ended (no participants)`);
            }
        }
    });

    // socket.on('message-deleted', (data) => {
    //     const { messageId, senderId, recipientId, isPrivate, deleteType } = data;

    //     console.log(`🗑️ Message deletion event: ${deleteType}`, { messageId, senderId, recipientId });

    //     if (deleteType === 'delete_for_everyone') {

    //         if (isPrivate && recipientId) {
    //             const recipientSocketId = userSocketMap.get(recipientId);
    //             if (recipientSocketId) {
    //                 io.to(recipientSocketId).emit('message-deleted', {
    //                     messageId,
    //                     senderId,
    //                     deleteType: 'delete_for_everyone'
    //                 });
    //                 console.log(`✅ Delete for everyone broadcasted to recipient ${recipientId}`);
    //             } else {
    //                 console.log(`📱 Recipient ${recipientId} is offline - will see deleted message when they come online`);
    //             }
    //         }
    //     } else {

    //         console.log(`✅ Delete for me: no broadcast needed for message ${messageId}`);
    //     }
    // });

    // socket.on('group-message-deleted', (data) => {
    //     const { messageId, senderId, groupId, deleteType } = data;

    //     console.log(`🗑️ Group message deletion event: ${deleteType}`, { messageId, senderId, groupId });

    //     if (deleteType === 'delete_for_everyone') {

    //         socket.to(groupId).emit('group-message-deleted', {
    //             messageId,
    //             senderId,
    //             groupId,
    //             deleteType: 'delete_for_everyone'
    //         });
    //         console.log(`✅ Group delete for everyone broadcasted to group ${groupId}`);
    //     } else {
    //         console.log(`✅ Group delete for me: no broadcast needed for message ${messageId}`);
    //     }
    // });

    socket.on('message-deleted-for-everyone', (data) => {
        const { messageId, senderId, recipientId, isPrivate, updatedMessage } = data;

        console.log(`🗑️ Message deleted for everyone (private):`, { messageId, senderId, recipientId });

        if (isPrivate && recipientId) {
            const recipientSocketId = userSocketMap.get(recipientId);
            if (recipientSocketId) {
                // Send the updated message data to recipient
                io.to(recipientSocketId).emit('message-deleted-for-everyone', {
                    messageId,
                    senderId,
                    updatedMessage: {
                        id: messageId,
                        _id: messageId,
                        isDeleted: true,
                        message: 'This message was deleted',
                        deletedAt: updatedMessage.deletedAt,
                        deletedBy: senderId
                    }
                });
                console.log(`✅ Delete for everyone broadcasted to recipient ${recipientId}`);
            } else {
                console.log(`📱 Recipient ${recipientId} is offline - will see deleted message when they come online`);
            }
        }
    });

    // FIXED: Handle delete for everyone - Group messages
    socket.on('group-message-deleted-for-everyone', (data) => {
        const { messageId, senderId, groupId, updatedMessage } = data;

        console.log(`🗑️ Group message deleted for everyone:`, { messageId, senderId, groupId });

        // Broadcast to all group members EXCEPT the sender
        socket.to(groupId).emit('group-message-deleted-for-everyone', {
            messageId,
            senderId,
            groupId,
            updatedMessage: {
                id: messageId,
                _id: messageId,
                isDeleted: true,
                message: 'This message was deleted',
                deletedAt: updatedMessage.deletedAt,
                deletedBy: senderId
            }
        });

        console.log(`✅ Group delete for everyone broadcasted to group ${groupId}`);
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
    socket.on('clear-private-chat', async ({ userId, recipientId }) => {
        try {
            console.log(`🧹 Clearing private chat for user ${userId} with ${recipientId}`);

            await updateLastSeen(userId);

            const Message = require('./models/message');

            // ✅ FIXED: Use updateMany with $addToSet instead of deleteMany
            const result = await Message.updateMany(
                {
                    $or: [
                        { senderId: userId, recipientId: recipientId },
                        { senderId: recipientId, recipientId: userId }
                    ],
                    groupId: { $exists: false }
                },
                { $addToSet: { clearedBy: userId } }
            );

            // Only notify the user who cleared (not the recipient)
            socket.emit('chat-cleared', {
                type: 'private',
                chatId: recipientId,
                modifiedCount: result.modifiedCount,
                clearedBy: userId
            });

            console.log(`✅ Private chat cleared for user ${userId}: ${result.modifiedCount} messages marked as cleared`);

        } catch (error) {
            console.error('❌ Error clearing private chat:', error);
            socket.emit('chat-clear-error', {
                error: 'Failed to clear chat history',
                details: error.message
            });
        }
    });

    // Handle clear group chat request
    socket.on('clear-group-chat', async ({ groupId, userId }) => {
        try {
            console.log(`🧹 Clearing group chat ${groupId} for user ${userId}`);

            await updateLastSeen(userId);

            // Just acknowledge - no need to emit to other group members since it's user-specific
            socket.emit('chat-cleared', {
                type: 'group',
                chatId: groupId,
                clearedBy: userId
            });

            console.log(`✅ Group chat cleared for user ${userId}`);

        } catch (error) {
            console.error('❌ Error clearing group chat:', error);
            socket.emit('chat-clear-error', {
                error: 'Failed to clear group chat history',
                details: error.message
            });
        }
    });

    socket.on('status_uploaded', async (status) => {
        try {
            console.log(`📸 Status uploaded event received:`, status);

            // Update user's last seen
            if (status.userId) {
                await updateLastSeen(status.userId);
            }

            // Get uploader's friends list
            const uploaderFriends = await getUserFriends(status.userId);

            if (uploaderFriends.length > 0) {
                console.log(`📡 Broadcasting status to ${uploaderFriends.length} friends`);

                // Emit to friends only
                emitToUsers(io, uploaderFriends, 'status_uploaded', status);

                console.log(`✅ Status upload broadcasted to friends only`);
            } else {
                console.log(`📭 No friends found for user ${status.userId}, not broadcasting`);
            }

        } catch (error) {
            console.error('❌ Error handling status_uploaded:', error);
        }
    });

    // 2. STATUS DELETED - When a user deletes their status
    socket.on('status_deleted', async ({ statusId, userId }) => {
        try {
            console.log(`🗑️ Status deleted:`, { statusId, userId });

            // Get user's friends list
            const userFriends = await getUserFriends(userId);

            if (userFriends.length > 0) {
                console.log(`📡 Broadcasting status deletion to ${userFriends.length} friends`);

                // Emit to friends only
                emitToUsers(io, userFriends, 'status_deleted', { statusId, userId });

                console.log(`✅ Status deletion broadcasted to friends only`);
            } else {
                console.log(`📭 No friends found for user ${userId}, not broadcasting deletion`);
            }

        } catch (error) {
            console.error('❌ Error handling status_deleted:', error);
        }
    });

    // 3. STATUS VIEWED - When a user views a single status
    socket.on('status_viewed', async ({ statusId, viewerId, updatedStatus }) => {
        try {
            console.log(`👁️ Status viewed:`, {
                statusId,
                viewerId,
                totalViews: updatedStatus?.viewedBy?.length || 0
            });

            if (!updatedStatus || !updatedStatus.userId) {
                console.error('❌ Invalid updatedStatus data');
                return;
            }

            const statusOwnerId = updatedStatus.userId.toString();

            // Only notify the status owner about the view
            io.to(statusOwnerId).emit('status_viewed', {
                statusId,
                viewerId,
                updatedStatus
            });

            console.log(`✅ Status view notification sent to owner: ${statusOwnerId}`);

        } catch (error) {
            console.error('❌ Error handling status_viewed:', error);
            socket.emit('error', {
                message: 'Failed to process status view',
                statusId,
                error: error.message
            });
        }
    });

    // 4. STATUS BULK VIEWED - When a user views multiple statuses at once
    socket.on('status_bulk_viewed', async ({ statusIds, viewerId, updatedStatuses }) => {
        try {
            console.log(`📦 Bulk status viewed:`, {
                statusIds: statusIds?.length || 0,
                viewerId,
                updatedCount: updatedStatuses?.length || 0
            });

            if (!updatedStatuses || updatedStatuses.length === 0) {
                console.log('📭 No updated statuses to broadcast');
                return;
            }

            // Group statuses by owner and notify each owner
            const statusesByOwner = {};

            updatedStatuses.forEach(status => {
                const ownerId = status.userId.toString();
                if (!statusesByOwner[ownerId]) {
                    statusesByOwner[ownerId] = [];
                }
                statusesByOwner[ownerId].push(status);
            });

            // Notify each status owner
            Object.keys(statusesByOwner).forEach(ownerId => {
                io.to(ownerId).emit('status_bulk_viewed', {
                    statusIds: statusesByOwner[ownerId].map(s => s.id),
                    viewerId,
                    updatedStatuses: statusesByOwner[ownerId]
                });
            });

            console.log(`✅ Bulk status view notifications sent to ${Object.keys(statusesByOwner).length} owners`);

        } catch (error) {
            console.error('❌ Error handling status_bulk_viewed:', error);
            socket.emit('error', {
                message: 'Failed to process bulk status views',
                statusIds,
                error: error.message
            });
        }
    });

    // Server-side socket event handler (replace your existing one)
    socket.on('profile_picture_updated', ({ userId, userName, profilePicture }) => {
        console.log(`🖼️ Profile picture updated for user: ${userId}`, { userName, profilePicture });

        // Broadcast to all connected clients (including the sender for consistency)
        io.emit('profile_picture_updated', {
            userId,
            userName,
            profilePicture // Make sure this matches the client expectation
        });

        console.log(`✅ Profile picture update broadcasted to all clients`);
    });

    // Add this NEW handler for general profile updates (name, email, etc.)
    socket.on('user_profile_updated', (updatedUserData) => {
        console.log(`👤 User profile updated for user: ${updatedUserData.id}`, updatedUserData);

        io.emit('user_profile_updated', {
            userId: updatedUserData.id,
            ...updatedUserData
        });

        console.log(`✅ User profile update broadcasted to all clients`);
    });

    socket.on('group_profile_picture_updated', ({ groupId, groupName, profilePicture }) => {
        console.log(`🖼️ Group picture updated: ${groupName}`, profilePicture);

        // Broadcast to everyone including sender
        io.emit('group_profile_picture_updated', {
            groupId,
            groupName,
            profilePicture
        });
    });

    socket.on('group_updated', ({ groupId, name, description, profilePicture }) => {
        console.log(`📝 Group updated: ${name}`, { groupId, description, profilePicture });

        // Broadcast to everyone including sender
        io.emit('group_updated', {
            groupId,
            name,
            description,
            profilePicture
        });
    });

    socket.on('group-message-reaction', async (data) => {
        const {
            messageId,
            emoji,
            userId,
            userName,
            action,
            updatedReaction,
            allReactions,
            groupId,
            isGroup
        } = data;

        console.log(`🎭 Group reaction ${action}: ${emoji} on message ${messageId} by ${userName} in group ${groupId}`);

        // Update user's last seen
        await updateLastSeen(userId);

        // CRITICAL FIX: Broadcast the reaction to ALL users in the group room
        if (groupId) {
            // Make sure the sender is in the group room
            if (!socket.rooms.has(groupId)) {
                socket.join(groupId);
                console.log(`🎭 Added socket ${socket.id} to group room ${groupId} for reaction`);
            }

            // Broadcast to all group members INCLUDING the sender for consistency
            io.to(groupId).emit('group-message-reaction', {
                messageId,
                emoji,
                userId,
                userName,
                action,
                updatedReaction,
                allReactions,
                groupId
            });

            console.log(`✅ Group reaction broadcasted to group ${groupId} from ${userName}`);
        } else {
            console.error(`❌ Group ID missing for group reaction from ${userName}`);
        }
    });

    // Also fix the message-reaction handler for private messages
    socket.on('message-reaction', async (data) => {
        const {
            messageId,
            emoji,
            userId,
            userName,
            action,
            updatedReaction,
            allReactions,
            recipientId,
            isPrivate
        } = data;

        console.log(`🎭 Reaction ${action}: ${emoji} on message ${messageId} by ${userName}`);

        // Update user's last seen
        await updateLastSeen(userId);

        if (isPrivate && recipientId) {
            const recipientSocketId = userSocketMap.get(recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('message-reaction', {
                    messageId,
                    emoji,
                    userId,
                    userName,
                    action,
                    updatedReaction,
                    allReactions
                });
                console.log(`✅ Private message reaction sent to ${recipientId}`);
            } else {
                console.log(`❌ Recipient ${recipientId} is offline for reaction`);
            }
        }
    });

    socket.on('message-delivered', async (data) => {
        const { messageId, userId, deliveredAt, messageStatus } = data;
        console.log(`📬 Received message-delivered event: ${messageId} by ${userId}`);

        // Find the message sender and notify them
        const Message = require('./models/message');
        const message = await Message.findById(messageId);

        if (message && message.senderId) {
            const senderSocketId = userSocketMap.get(message.senderId);
            if (senderSocketId) {
                io.to(senderSocketId).emit('message-delivered', {
                    messageId,
                    userId,
                    deliveredAt,
                    messageStatus
                });
                console.log(`📬 ✅ Delivered status sent to sender ${message.senderId}`);
            }
        }
    });

    socket.on('group-message-delivered', async (data) => {
        const { messageId, userId, groupId, deliveredAt, messageStatus } = data;
        console.log(`📬 Group message delivered event: ${messageId} by ${userId} in group ${groupId}`);

        try {
            const Message = require('./models/message');
            const Group = require('./models/group');

            const message = await Message.findById(messageId);
            if (!message) {
                console.error(`❌ Message ${messageId} not found`);
                return;
            }

            // Update message status in database if it's still 'sent'
            if (message.messageStatus === 'sent') {
                await Message.findByIdAndUpdate(messageId, {
                    messageStatus: 'delivered',
                    deliveredAt: new Date(deliveredAt)
                });
                console.log(`📬 Updated message ${messageId} status to delivered in database`);
            }

            // CRITICAL: Always notify the message sender immediately
            if (message.senderId && message.senderId !== userId) {
                const senderSocketId = userSocketMap.get(message.senderId);
                if (senderSocketId) {
                    io.to(senderSocketId).emit('group-message-delivered', {
                        messageId,
                        userId,
                        groupId,
                        deliveredAt: new Date(deliveredAt),
                        messageStatus: 'delivered'
                    });
                    console.log(`📬 ✅ Delivery notification sent to sender ${message.senderId}`);
                } else {
                    console.log(`📬 ❌ Sender ${message.senderId} is offline, cannot notify`);
                }
            }

            // Update user's last seen
            await updateLastSeen(userId);

        } catch (error) {
            console.error('❌ Error handling group message delivered:', error);
        }
    });

    socket.on('group-message-read', async (data) => {
        const { messageId, userId, groupId, readAt, messageStatus } = data;
        console.log(`👁️ Group message read event: ${messageId} by ${userId} in group ${groupId}`);

        try {
            const Message = require('./models/message');
            const message = await Message.findById(messageId);

            if (!message) {
                console.error(`❌ Message ${messageId} not found`);
                return;
            }

            // CRITICAL FIX: Immediately notify the sender
            if (message.senderId && message.senderId !== userId) {
                const senderSocketId = userSocketMap.get(message.senderId);

                if (senderSocketId) {
                    // Emit IMMEDIATELY to sender's socket
                    io.to(senderSocketId).emit('group-message-read', {
                        messageId,
                        userId,
                        groupId,
                        readAt: readAt || new Date().toISOString(),
                        messageStatus: 'read'
                    });

                    console.log(`👁️ ✅ IMMEDIATE group read notification sent to sender ${message.senderId}`);
                } else {
                    console.log(`👁️ ❌ Sender ${message.senderId} is offline`);
                }
            }

            // Update message status in database (async, don't block socket notification)
            Message.findByIdAndUpdate(messageId, {
                messageStatus: 'read',
                readAt: new Date(readAt || Date.now()),
                deliveredAt: message.deliveredAt || new Date(readAt || Date.now())
            }).catch(err => console.error('Error updating message in DB:', err));

            // Update user's last seen
            await updateLastSeen(userId);

        } catch (error) {
            console.error('❌ Error handling group message read:', error);
        }
    });

    // Listen for message read events from clients
    socket.on('message-read', async (data) => {
        const { messageId, userId, readAt, messageStatus } = data;
        console.log(`👁️ Received message-read event: ${messageId} by ${userId}`);

        try {
            const Message = require('./models/message');
            const message = await Message.findById(messageId);

            if (!message) {
                console.error(`❌ Message ${messageId} not found`);
                return;
            }

            // CRITICAL FIX: Immediately notify the sender via socket
            if (message.senderId && message.senderId !== userId) {
                const senderSocketId = userSocketMap.get(message.senderId);

                if (senderSocketId) {
                    // Emit IMMEDIATELY to sender's socket
                    io.to(senderSocketId).emit('message-read', {
                        messageId,
                        userId,
                        readAt: readAt || new Date().toISOString(),
                        messageStatus: 'read'
                    });

                    console.log(`👁️ ✅ IMMEDIATE read notification sent to sender ${message.senderId}`);
                } else {
                    console.log(`👁️ ❌ Sender ${message.senderId} is offline`);
                }
            }

            // Update last seen
            await updateLastSeen(userId);

        } catch (error) {
            console.error('❌ Error handling message-read:', error);
        }
    });

    socket.on('disconnect', async () => {
        if (onlineUsers.has(socket.id)) {
            const user = onlineUsers.get(socket.id);
            const roomsArray = Array.from(socket.rooms);

            // Wait a bit before marking offline (grace period for reconnection)
            setTimeout(async () => {
                // Check if user has reconnected
                const currentSocketId = userSocketMap.get(user.id);

                // Only mark offline if they haven't reconnected
                if (!currentSocketId || currentSocketId === socket.id) {
                    await setUserOffline(user.id);

                    onlineUsers.delete(socket.id);
                    userSocketMap.delete(user.id);
                    userHeartbeats.delete(user.id); // Clear heartbeat

                    const lastSeen = getUserLastSeen(user.id);

                    // Broadcast offline status
                    io.emit('user-status-updated', {
                        userId: user.id,
                        isOnline: false,
                        lastSeen,
                        lastSeenText: formatLastSeen(lastSeen)
                    });

                    io.emit('online-users', Array.from(onlineUsers.values()));

                    console.log(`❌ User disconnected: ${user.name} (ID: ${user.id})`);
                } else {
                    console.log(`✅ User ${user.id} reconnected, keeping online status`);
                }
            }, 3000); // 3 second grace period

            // Clean up typing indicators immediately
            roomsArray.forEach(roomId => {
                if (roomId !== socket.id) {
                    socket.to(roomId).emit('group-stop-typing', {
                        groupId: roomId,
                        id: user.id,
                        username: user.name
                    });
                }
            });

            // Clean up group calls immediately
            activeGroupCalls.forEach((groupCall, groupId) => {
                if (groupCall.participants.has(user.id)) {
                    groupCall.participants.delete(user.id);

                    const groupCallRoom = `group-call-${groupId}`;
                    socket.to(groupCallRoom).emit('group-participant-left', {
                        userId: user.id
                    });

                    console.log(`🔚 User ${user.id} removed from group call ${groupId} due to disconnect`);

                    if (groupCall.participants.size === 0) {
                        activeGroupCalls.delete(groupId);
                        io.to(groupCallRoom).emit('group-call-ended');
                        console.log(`🔚 Group call ${groupId} ended (no participants after disconnect)`);
                    }
                }
            });
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});