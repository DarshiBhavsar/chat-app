const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        username: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        lastSeen: { type: Date, default: Date.now },
        isOnline: { type: Boolean, default: false }
    },
    { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);