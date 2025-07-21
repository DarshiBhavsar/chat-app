const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    user: { type: String, },
    senderId: { type: String, },
    message: { type: String },
    time: { type: String, required: true },
    recipientId: { type: String, },
    image: [{ type: String }],
    video: [{ type: String }],
    documents: [{ type: String }],
    audio: [{ type: String }],
    audioDuration: { type: Number },
    groupId: { type: String },
    isPrivate: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false }, // For soft delete
    deletedAt: { type: Date }, // When message was deleted
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;