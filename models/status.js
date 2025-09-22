const mongoose = require('mongoose');

const statusSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        content: {
            type: {
                type: String,
                enum: ['text', 'image', 'video'],
                required: true
            },
            text: {
                type: String,
                default: ''
            },
            url: {
                type: String,
                default: ''
            },
            backgroundColor: {
                type: String,
                default: '#000000'
            }
        },
        viewedBy: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }],
        viewers: [{
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                required: true
            },
            viewedAt: {
                type: Date,
                default: Date.now
            }
        }],
        isActive: {
            type: Boolean,
            default: true
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expireAfterSeconds: 0 } // MongoDB TTL index for automatic deletion
        }
    },
    {
        timestamps: true
    }
);

// Index for efficient queries
statusSchema.index({ userId: 1, createdAt: -1 });
statusSchema.index({ expiresAt: 1 });
statusSchema.index({ isActive: 1, expiresAt: 1 });

// Pre-save middleware to set expiration time if not provided
statusSchema.pre('save', function (next) {
    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    }
    next();
});

// Method to check if status has expired
statusSchema.methods.isExpired = function () {
    return new Date() > this.expiresAt;
};

// Method to check if user has viewed the status
statusSchema.methods.hasUserViewed = function (userId) {
    return this.viewedBy.includes(userId);
};

// Static method to clean up expired statuses (optional, as MongoDB TTL handles this)
statusSchema.statics.cleanupExpired = async function () {
    const now = new Date();
    const result = await this.deleteMany({ expiresAt: { $lt: now } });
    return result.deletedCount;
};

// Static method to get user's active statuses
statusSchema.statics.getUserActiveStatuses = function (userId) {
    return this.find({
        userId: userId,
        isActive: true,
        expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });
};

// Static method to get feed statuses for a user
statusSchema.statics.getFeedStatuses = function (userIds) {
    return this.find({
        userId: { $in: userIds },
        isActive: true,
        expiresAt: { $gt: new Date() }
    })
        .populate('userId', 'username')
        .sort({ createdAt: -1 });
};

module.exports = mongoose.model('Status', statusSchema);