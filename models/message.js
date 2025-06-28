const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    user: { type: String, },
    senderId: { type: String, },
    message: { type: String },
    time: { type: String, required: true },
    recipientId: { type: String, },
    image: [{ type: String }],
    groupId: { type: String },
    isPrivate: { type: Boolean, default: true },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
