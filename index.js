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
        origin: 'https://chat-application-reactjs-nodejs.netlify.app/',
        pingTimeout: 10000,
        methods: ['GET', 'POST']
    }
});

const onlineUsers = new Map();
const userSocketMap = new Map();
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

    socket.on('disconnect', () => {
        if (onlineUsers.has(socket.id)) {
            const user = onlineUsers.get(socket.id);
            const roomsArray = Array.from(socket.rooms);

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