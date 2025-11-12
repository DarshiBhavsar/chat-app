const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        username: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },

        // Friend system fields
        friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        sentFriendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        receivedFriendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        declinedFriendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // New field for tracking declined requests

        // Existing blocking system
        blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

        profilePicture: {
            type: String,
            default: null
        },
        about: { type: String, default: '' },
        phone: { type: String, default: '' },
        lastSeen: { type: Date, default: Date.now },
        isOnline: { type: Boolean, default: false },
        resetPasswordToken: { type: String, default: null },
        resetPasswordExpires: { type: Date, default: null }
    },
    { timestamps: true }
);

// Index for better search performance
userSchema.index({ username: 'text', email: 'text' });

module.exports = mongoose.model('User', userSchema);