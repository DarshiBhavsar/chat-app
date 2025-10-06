const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    user: { type: String },
    senderId: { type: String },
    message: { type: String },
    time: { type: String, required: true },
    recipientId: { type: String },
    image: [{ type: String }],
    video: [{ type: String }],
    documents: [{ type: String }],
    audio: [{ type: String }],
    audioDuration: { type: Number },
    groupId: { type: String },
    isPrivate: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: String }, // NEW: Track who deleted the message

    clearedBy: [{
        type: String,
        default: []
    }],

    reactions: [{
        emoji: { type: String, required: true },
        users: [{ type: String }],
        count: { type: Number, default: 0 }
    }],
    messageStatus: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    },

    deliveredAt: { type: Date },
    readAt: { type: Date },

    groupDeliveryStatus: [{
        userId: { type: String, required: true },
        deliveredAt: { type: Date },
        readAt: { type: Date }
    }],

    replyTo: {
        id: { type: String },
        message: { type: String },
        user: { type: String },
        senderId: { type: String },
        image: [{ type: String }],
        documents: [{ type: String }],
        audio: [{ type: String }],
        video: [{ type: String }]
    },

    forwardedFrom: {
        id: { type: String },
        user: { type: String },
        senderId: { type: String }
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;