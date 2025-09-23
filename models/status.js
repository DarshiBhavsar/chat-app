const mongoose = require('mongoose');

/* ---------- Status Schema ---------- */
const statusSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        content: {
            type: {
                type: String,
                enum: ['text', 'image', 'video'],
                required: true,
            },
            text: {
                type: String,
                default: '',
            },
            url: {
                type: String,
                default: '',
            },
            backgroundColor: {
                type: String,
                default: '#000000',
            },
        },
        viewedBy: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        viewers: [
            {
                userId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User',
                    required: true,
                },
                viewedAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],
        isActive: {
            type: Boolean,
            default: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expireAfterSeconds: 0 }, // TTL index, remove schema.index({expiresAt: 1}) to avoid duplicates
        },
    },
    {
        timestamps: true,
    }
);

/* ---------- Additional Indexes ---------- */
// Compound indexes for efficient queries
statusSchema.index({ userId: 1, createdAt: -1 });
statusSchema.index({ isActive: 1, expiresAt: 1 });

/* ---------- Pre-save Middleware ---------- */
statusSchema.pre('save', function (next) {
    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    }
    next();
});

/* ---------- Instance Methods ---------- */
statusSchema.methods.isExpired = function () {
    return new Date() > this.expiresAt;
};

statusSchema.methods.hasUserViewed = function (userId) {
    return this.viewedBy.includes(userId);
};

/* ---------- Static Methods ---------- */
statusSchema.statics.cleanupExpired = async function () {
    const now = new Date();
    const result = await this.deleteMany({ expiresAt: { $lt: now } });
    return result.deletedCount;
};

statusSchema.statics.getUserActiveStatuses = function (userId) {
    return this.find({
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
};

statusSchema.statics.getFeedStatuses = function (userIds) {
    return this.find({
        userId: { $in: userIds },
        isActive: true,
        expiresAt: { $gt: new Date() },
    })
        .populate('userId', 'username')
        .sort({ createdAt: -1 });
};

/* ---------- Export Model ---------- */
module.exports = mongoose.model('Status', statusSchema);
