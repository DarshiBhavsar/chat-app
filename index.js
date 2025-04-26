require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
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
app.use('/api/messages', messageRoutes);

const io = new Server(server, {
    cors: {
        // origin: 'http://localhost:5173',
        pingTimeout: 10000,
        origin: 'https://socket-application.netlify.app',
        methods: ['GET', 'POST']
    }
});

const onlineUsers = new Map();
const userSocketMap = new Map();

io.on('connection', socket => {
    console.log(`✅ Socket connected: ${socket.id}`);

    socket.on('user-joined', ({ token }) => {
        try {
            const user = jwt.decode(token);

            onlineUsers.set(socket.id, { id: user.id, name: user.username });

            userSocketMap.set(user.id, socket.id);

            console.log(`✅ User joined: ${user.username} (UserID: ${user.id}, SocketID: ${socket.id})`);


            io.emit('user-joined-broadcast', { id: user.id, name: user.username });


            io.emit('online-users', Array.from(onlineUsers.values()));
        } catch (error) {
            console.error('Error processing user-joined event:', error);
        }
    });

    socket.on('get-online-users', () => {
        socket.emit('online-users', Array.from(onlineUsers.values()));
    });

    socket.on('send-private-message', ({ payload, recipientId }) => {
        const recipientSocketId = userSocketMap.get(recipientId);

        if (recipientSocketId) {
            // Send to recipient
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
            // Private stop typing notification
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

    socket.on('disconnect', () => {
        if (onlineUsers.has(socket.id)) {
            const user = onlineUsers.get(socket.id);
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