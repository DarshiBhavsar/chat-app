const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    user: { type: String, required: true },
    senderId: { type: String, required: true },
    message: { type: String, required: true },
    time: { type: String, required: true },
    recipientId: { type: String, required: true },  // For private messages
    isPrivate: { type: Boolean, default: true }  // To distinguish between private and global messages
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
