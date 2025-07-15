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
        // origin: 'https://chat-application-reactjs-nodejs.netlify.app',
        origin: 'http://localhost:5173',
        pingTimeout: 10000,
        methods: ['GET', 'POST']
    }
});

const onlineUsers = new Map();
const userSocketMap = new Map();
// Add group call tracking
const activeGroupCalls = new Map(); // groupId -> { participants: Set, callType: 'voice'|'video' }

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/documents', express.static('uploads/documents'));

io.on('connection', socket => {
    console.log(`✅ Socket connected: ${socket.id}`);

    socket.on('user-joined', async ({ token }) => {
        try {
            const user = jwt.decode(token);

            onlineUsers.set(socket.id, { id: user.id, name: user.username });
            userSocketMap.set(user.id, socket.id);

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

            io.emit('user-joined-broadcast', { id: user.id, name: user.username });
            io.emit('online-users', Array.from(onlineUsers.values()));
        } catch (error) {
            console.error('❌ Error processing user-joined event:', error);
        }
    });

    socket.on('get-online-users', () => {
        socket.emit('online-users', Array.from(onlineUsers.values()));
    });

    socket.on('send-private-message', ({ payload, recipientId }) => {
        const recipientSocketId = userSocketMap.get(recipientId);

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('received-message', payload);
            console.log(`Private message sent to ${recipientId} (Socket: ${recipientSocketId})`);
        } else {
            console.log(`Recipient ${recipientId} is offline or not found`);
        }
    });

    socket.on('send-message', message => {
        socket.broadcast.emit('received-message', message);
    });

    socket.on('typing', ({ from, to }) => {
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

    socket.on('user-left', ({ userId }, callback) => {
        if (userId) {
            const socketId = userSocketMap.get(userId);
            if (socketId) {
                onlineUsers.delete(socketId);
            }
            userSocketMap.delete(userId);

            io.emit('user-left-broadcast', userId);
            io.emit('online-users', Array.from(onlineUsers.values()));

            console.log(`User explicitly left: ${userId}`);

            if (callback) callback();
        }
    });

    socket.on('join-group', (data) => {
        const { groupId, userId } = data;
        socket.join(groupId);
        console.log(`✅ User ${userId} joined group room ${groupId}`);

        // Confirm the socket is in the room
        console.log(`✅ Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms));
    });

    socket.on('create-group', (group) => {
        console.log(`Group created: ${group.name} (ID: ${group.id})`);

        if (!group.id) {
            console.log('Group creation failed. Group ID is missing.');
            return;
        }

        // Join the creator to the group room
        socket.join(group.id);
        console.log(`Creator joined group room: ${group.id}`);

        // Notify all members about the new group and make them join the room
        if (group.members && Array.isArray(group.members)) {
            group.members.forEach(memberId => {
                const memberSocketId = userSocketMap.get(memberId);
                if (memberSocketId) {
                    io.to(memberSocketId).emit('group-created', group);

                    // Make other sockets join this group room too
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

    socket.on('send-group-message', (payload) => {
        console.log('Sending message to group:', payload.groupId);

        // Make sure the sender socket is in the group room
        if (!socket.rooms.has(payload.groupId)) {
            socket.join(payload.groupId);
            console.log(`Added sender to group room: ${payload.groupId}`);
        }

        // Broadcast to everyone in the room INCLUDING the sender
        io.to(payload.groupId).emit('received-group-message', payload);
        console.log(`Message broadcast in group ${payload.groupId} by ${payload.senderId}: ${payload.message}`);
    });

    socket.on('group-typing', ({ groupId, userId, userName }) => {
        console.log(`🟢 Server: User ${userName} (${userId}) is typing in group ${groupId}`);
        console.log(`🟢 Socket ${socket.id} is in rooms:`, Array.from(socket.rooms));

        // Ensure the socket is in the group room
        if (!socket.rooms.has(groupId)) {
            socket.join(groupId);
            console.log(`🟢 Added socket ${socket.id} to group room ${groupId}`);
        }

        // Broadcast to all other users in the group (exclude sender)
        socket.to(groupId).emit('group-typing', {
            groupId,
            id: userId,
            username: userName
        });

        console.log(`🟢 Broadcasted group-typing to group ${groupId} from user ${userName}`);
    });

    socket.on('group-stop-typing', ({ groupId, userId, userName }) => {
        console.log(`🟡 Server: User ${userName} (${userId}) stopped typing in group ${groupId}`);

        // Ensure the socket is in the group room
        if (!socket.rooms.has(groupId)) {
            socket.join(groupId);
            console.log(`🟡 Added socket ${socket.id} to group room ${groupId}`);
        }

        // Broadcast to all other users in the group (exclude sender)  
        socket.to(groupId).emit('group-stop-typing', {
            groupId,
            id: userId,
            username: userName
        });

        console.log(`🟡 Broadcasted group-stop-typing to group ${groupId} from user ${userName}`);
    });

    // Individual call handlers (existing)
    socket.on('call-request', ({ to, from, fromName, type, offer }) => {
        console.log(`📞 Call request from ${fromName} to ${to} (Type: ${type})`);

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
            // Notify caller that recipient is offline
            socket.emit('call-failed', { reason: 'User is offline' });
            console.log(`📞 Call request failed - recipient ${to} is offline`);
        }
    });

    socket.on('call-answer', ({ to, answer }) => {
        console.log(`📞 Call answer from socket ${socket.id} to ${to}`);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-answer', {
                from: onlineUsers.get(socket.id)?.id,
                answer
            });
            console.log(`📞 Call answer relayed to ${to} (Socket: ${recipientSocketId})`);
        }
    });

    socket.on('call-accepted', ({ to }) => {
        console.log(`✅ Call accepted by socket ${socket.id}, notifying ${to}`);

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

    socket.on('call-declined', ({ to }) => {
        console.log(`❌ Call declined by socket ${socket.id}, notifying ${to}`);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-declined');
            console.log(`❌ Call declined notification sent to ${to}`);
        }
    });

    socket.on('call-ended', ({ to }) => {
        console.log(`📞 Call ended by socket ${socket.id}, notifying ${to}`);

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

    // ========== GROUP CALL HANDLERS ==========

    // Group call request - initiator starts a group call

    socket.on('group-call-request', ({ groupId, groupName, members, from, fromName, type }) => {
        console.log(`📞 Group call request from ${fromName} to group ${groupName} (Type: ${type})`);
        console.log('📞 Members array received:', members);
        console.log('📞 Current online users:', Array.from(onlineUsers.values()));
        console.log('📞 Current user socket map:', Array.from(userSocketMap.entries()));

        // Initialize group call tracking
        if (!activeGroupCalls.has(groupId)) {
            activeGroupCalls.set(groupId, {
                participants: new Set([from]),
                callType: type,
                initiator: from
            });
        }

        // ENHANCED VALIDATION: Clean and validate members array
        if (!members || !Array.isArray(members)) {
            console.error('❌ Invalid members array:', members);
            socket.emit('group-call-error', {
                message: 'No group members found. Please refresh and try again.'
            });
            return;
        }

        // Clean the members array - remove null/undefined values and extract IDs
        const cleanMembers = members
            .map(member => {
                // Handle different member formats
                if (typeof member === 'string') return member; // Already an ID
                if (typeof member === 'object' && member?.id) return member.id; // User object
                if (typeof member === 'object' && member?._id) return member._id; // MongoDB object
                return null; // Invalid member
            })
            .filter(memberId => memberId != null && memberId !== ''); // Remove null/undefined/empty

        console.log('📞 Cleaned members array:', cleanMembers);

        if (cleanMembers.length === 0) {
            console.error('❌ No valid members found after cleaning');
            socket.emit('group-call-error', {
                message: 'No valid group members found. Please check the group configuration.'
            });
            return;
        }

        console.log(`📞 Processing ${cleanMembers.length} members for group call`);

        // Notify all group members except the initiator
        let notificationsSent = 0;
        const offlineMembers = [];

        cleanMembers.forEach((memberId, index) => {
            console.log(`📞 Processing member ${index + 1}/${cleanMembers.length}:`, {
                memberId,
                isInitiator: memberId === from
            });

            // Skip the initiator
            if (memberId === from) {
                console.log(`📞 Skipping member: ${memberId} (is initiator)`);
                return;
            }

            const memberSocketId = userSocketMap.get(memberId);
            if (memberSocketId) {
                io.to(memberSocketId).emit('group-call-request', {
                    groupId,
                    groupName,
                    members: cleanMembers, // Send cleaned members array
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

        console.log(`📞 Group call notifications sent: ${notificationsSent}/${cleanMembers.length - 1} (excluding initiator)`);

        if (offlineMembers.length > 0) {
            console.log(`📞 Offline members: ${offlineMembers.join(', ')}`);
        }

        // Enhanced feedback to initiator
        if (notificationsSent === 0) {
            socket.emit('group-call-error', {
                message: 'No group members are currently online.'
            });
        } else if (offlineMembers.length > 0) {
            // Inform about offline members but continue with online ones
            socket.emit('group-call-partial', {
                message: `${offlineMembers.length} member(s) are offline and won't receive the call.`,
                onlineCount: notificationsSent,
                offlineCount: offlineMembers.length
            });
        }
    });
    // User joins a group call
    socket.on('group-call-join', ({ groupId, userId, userName }) => {
        console.log(`✅ ${userName} joining group call: ${groupId}`);

        const groupCall = activeGroupCalls.get(groupId);
        if (!groupCall) {
            console.log(`❌ Group call ${groupId} not found`);
            socket.emit('group-call-error', { message: 'Group call not found' });
            return;
        }

        // Add user to participants
        groupCall.participants.add(userId);

        // Join the group call room
        const groupCallRoom = `group-call-${groupId}`;
        socket.join(groupCallRoom);

        // Get current participants info
        const participants = Array.from(groupCall.participants).map(participantId => {
            const user = Array.from(onlineUsers.values()).find(u => u.id === participantId);
            return {
                id: participantId,
                name: user ? user.name : 'Unknown'
            };
        });

        // Notify the joining user about existing participants
        socket.emit('group-call-joined', {
            groupId,
            participants: participants.filter(p => p.id !== userId) // Exclude self
        });

        // Notify existing participants about the new joiner
        socket.to(groupCallRoom).emit('group-participant-joined', {
            userId,
            userName
        });

        console.log(`✅ ${userName} joined group call ${groupId}. Total participants: ${groupCall.participants.size}`);
    });

    // Group call offer (WebRTC signaling)
    socket.on('group-call-offer', ({ groupId, to, from, offer }) => {
        console.log(`📨 Group call offer from ${from} to ${to} in group ${groupId}`);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            const senderUser = Array.from(onlineUsers.values()).find(u => u.id === from);
            io.to(recipientSocketId).emit('group-call-offer', {
                from,
                fromName: senderUser ? senderUser.name : 'Unknown',
                offer
            });
            console.log(`📨 Group call offer relayed to ${to}`);
        }
    });

    // Group call answer (WebRTC signaling)
    socket.on('group-call-answer', ({ groupId, to, from, answer }) => {
        console.log(`📨 Group call answer from ${from} to ${to} in group ${groupId}`);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('group-call-answer', {
                from,
                answer
            });
            console.log(`📨 Group call answer relayed to ${to}`);
        }
    });

    // Group call ICE candidate (WebRTC signaling)
    socket.on('group-ice-candidate', ({ groupId, to, from, candidate }) => {
        console.log(`🧊 Group ICE candidate from ${from} to ${to} in group ${groupId}`);

        const recipientSocketId = userSocketMap.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('group-ice-candidate', {
                from,
                candidate
            });
            console.log(`🧊 Group ICE candidate relayed to ${to}`);
        }
    });

    // User declines group call
    socket.on('group-call-declined', ({ groupId, userId }) => {
        console.log(`❌ ${userId} declined group call: ${groupId}`);

        const groupCall = activeGroupCalls.get(groupId);
        if (groupCall) {
            groupCall.participants.delete(userId);

            // Notify other participants
            const groupCallRoom = `group-call-${groupId}`;
            socket.to(groupCallRoom).emit('group-participant-declined', {
                userId
            });
        }
    });

    // User leaves group call
    socket.on('group-call-left', ({ groupId, userId }) => {
        console.log(`👋 ${userId} left group call: ${groupId}`);

        const groupCall = activeGroupCalls.get(groupId);
        if (groupCall) {
            groupCall.participants.delete(userId);

            // Leave the group call room
            const groupCallRoom = `group-call-${groupId}`;
            socket.leave(groupCallRoom);

            // Notify other participants
            socket.to(groupCallRoom).emit('group-participant-left', {
                userId
            });

            // If no participants left, clean up the group call
            if (groupCall.participants.size === 0) {
                activeGroupCalls.delete(groupId);
                console.log(`🧹 Cleaned up empty group call: ${groupId}`);
            } else {
                console.log(`👋 ${userId} left group call ${groupId}. Remaining participants: ${groupCall.participants.size}`);
            }
        }
    });

    // Group call ended by initiator
    socket.on('group-call-ended', ({ groupId }) => {
        console.log(`🔚 Group call ended: ${groupId}`);

        const groupCall = activeGroupCalls.get(groupId);
        if (groupCall) {
            // Notify all participants
            const groupCallRoom = `group-call-${groupId}`;
            io.to(groupCallRoom).emit('group-call-ended', { groupId });

            // Clean up
            activeGroupCalls.delete(groupId);
            console.log(`🧹 Group call ${groupId} ended and cleaned up`);
        }
    });

    socket.on('disconnect', () => {
        if (onlineUsers.has(socket.id)) {
            const user = onlineUsers.get(socket.id);
            const roomsArray = Array.from(socket.rooms);

            // Clean up typing indicators
            roomsArray.forEach(roomId => {
                if (roomId !== socket.id) {
                    socket.to(roomId).emit('group-stop-typing', {
                        groupId: roomId,
                        id: user.id,
                        username: user.name
                    });
                    console.log(`🟡 Cleaned up typing indicator for user ${user.name} in group ${roomId}`);
                }
            });

            // Clean up group calls
            activeGroupCalls.forEach((groupCall, groupId) => {
                if (groupCall.participants.has(user.id)) {
                    groupCall.participants.delete(user.id);

                    // Notify other participants
                    const groupCallRoom = `group-call-${groupId}`;
                    socket.to(groupCallRoom).emit('group-participant-left', {
                        userId: user.id
                    });

                    // If no participants left, clean up the group call
                    if (groupCall.participants.size === 0) {
                        activeGroupCalls.delete(groupId);
                        console.log(`🧹 Cleaned up empty group call: ${groupId} after user disconnect`);
                    }

                    console.log(`👋 ${user.name} disconnected from group call ${groupId}`);
                }
            });

            onlineUsers.delete(socket.id);
            userSocketMap.delete(user.id);

            io.emit('user-left-broadcast', user.id);
            io.emit('online-users', Array.from(onlineUsers.values()));

            console.log(`❌ User disconnected: ${user.name} (ID: ${user.id})`);
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});