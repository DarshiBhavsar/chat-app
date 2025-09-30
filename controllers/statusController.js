const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Status = require('../models/status');
const User = require('../models/user');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary directly from environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('☁️ Cloudinary configured:', {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    configured: !!(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
});

const filterViewersForUser = (status, currentUser) => {
    if (!status.viewers || !currentUser.friends) {
        return status;
    }

    const allowedUserIds = [
        currentUser._id.toString(),
        ...currentUser.friends.map(id => id.toString())
    ];

    const blockedUserIds = [
        ...(currentUser.blockedUsers || []).map(id => id.toString()),
        ...(currentUser.blockedBy || []).map(id => id.toString())
    ];

    const filteredViewers = status.viewers.filter(viewer => {
        const viewerIdStr = viewer.userId._id.toString();
        return allowedUserIds.includes(viewerIdStr) && !blockedUserIds.includes(viewerIdStr);
    });

    const filteredViewedBy = status.viewedBy.filter(viewerId => {
        const viewerIdStr = viewerId.toString();
        return allowedUserIds.includes(viewerIdStr) && !blockedUserIds.includes(viewerIdStr);
    });

    return {
        ...status,
        viewers: filteredViewers,
        viewedBy: filteredViewedBy
    };
};

// Get all statuses for user's feed
exports.getAllStatuses = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        console.log('📋 Getting all statuses for user:', userId);

        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const friendIds = currentUser.friends || [];
        const blockedUserIds = [
            ...(currentUser.blockedUsers || []),
            ...(currentUser.blockedBy || [])
        ];

        console.log(`📊 User has ${friendIds.length} friends, ${blockedUserIds.length} blocked relationships`);

        const [statuses, myStatusesQuery] = await Promise.all([
            Status.find({
                userId: {
                    $in: friendIds,
                    $nin: blockedUserIds
                },
                isActive: true,
                expiresAt: { $gt: new Date() }
            })
                .populate('userId', 'username profilePicture')
                .populate({
                    path: 'viewers.userId',
                    select: 'username profilePicture'
                })
                .sort({ createdAt: -1 })
                .lean(),

            Status.find({
                userId: userId,
                isActive: true,
                expiresAt: { $gt: new Date() }
            })
                .populate('userId', 'username profilePicture')
                .populate({
                    path: 'viewers.userId',
                    select: 'username profilePicture'
                })
                .sort({ createdAt: -1 })
                .lean()
        ]);

        console.log(`📊 Found ${statuses.length} friend statuses, ${myStatusesQuery.length} my statuses`);

        const formatStatusWithViewers = (status) => {
            const filteredStatus = filterViewersForUser(status, currentUser);

            return {
                id: filteredStatus._id.toString(),
                userId: filteredStatus.userId._id.toString(),
                userName: filteredStatus.userId.username,
                profileImage: filteredStatus.userId.profilePicture || null,
                content: filteredStatus.content,
                createdAt: filteredStatus.createdAt,
                expiresAt: filteredStatus.expiresAt,
                viewedBy: filteredStatus.viewedBy.map(id => id.toString()),
                viewers: filteredStatus.viewers ? filteredStatus.viewers.map(viewer => ({
                    userId: viewer.userId._id.toString(),
                    userName: viewer.userId.username,
                    profilePicture: viewer.userId.profilePicture || null,
                    viewedAt: viewer.viewedAt
                })) : [],
                isActive: filteredStatus.isActive
            };
        };

        const myStatuses = myStatusesQuery.map(formatStatusWithViewers);

        const statusGroupsMap = new Map();

        statuses.forEach(status => {
            const statusObj = formatStatusWithViewers(status);
            const userIdStr = status.userId._id.toString();

            if (!statusGroupsMap.has(userIdStr)) {
                statusGroupsMap.set(userIdStr, {
                    userId: userIdStr,
                    userName: status.userId.username,
                    profilePicture: status.userId.profilePicture || null,
                    statuses: [],
                    hasUnviewed: false,
                    lastStatusTime: status.createdAt
                });
            }

            const group = statusGroupsMap.get(userIdStr);
            group.statuses.push(statusObj);

            if (!status.viewedBy || !status.viewedBy.some(viewerId => viewerId.toString() === userId.toString())) {
                group.hasUnviewed = true;
            }

            if (status.createdAt > group.lastStatusTime) {
                group.lastStatusTime = status.createdAt;
            }
        });

        const statusGroupsArray = Array.from(statusGroupsMap.values());

        console.log(`✅ Returning ${statusGroupsArray.length} status groups from friends`);

        res.json({
            statusGroups: statusGroupsArray,
            myStatuses: myStatuses
        });

    } catch (error) {
        console.error('❌ Error in getAllStatuses:', error);
        res.status(500).json({ message: 'Failed to fetch statuses', error: error.message });
    }
};

// Create new status - FIXED to emit to uploader too
exports.createStatus = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user._id || req.user.id);
        const { text, backgroundColor, content } = req.body;

        console.log('📤 Creating new status for user:', userId);

        let statusContent = {};
        let uploadedFileUrl = null;

        // Handle file upload (image or video)
        if (req.file) {
            console.log('📁 File detected:', req.file.originalname, req.file.mimetype);

            try {
                // Upload to Cloudinary
                const result = await new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        {
                            folder: 'chat-app-uploads',
                            resource_type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
                            transformation: req.file.mimetype.startsWith('video/')
                                ? [{ quality: 'auto', fetch_format: 'auto' }]
                                : [{ quality: 'auto:good', fetch_format: 'auto' }]
                        },
                        (error, result) => {
                            if (error) reject(error);
                            else resolve(result);
                        }
                    );
                    uploadStream.end(req.file.buffer);
                });

                uploadedFileUrl = result.secure_url;
                console.log('☁️ File uploaded to Cloudinary:', uploadedFileUrl);

                // Delete local file if it exists
                if (req.file.path && fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                    console.log('🗑️ Local file deleted');
                }

                const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
                statusContent = {
                    type: fileType,
                    url: uploadedFileUrl,
                    text: text || '',
                    backgroundColor: backgroundColor || '#000000'
                };

            } catch (uploadError) {
                console.error('❌ Cloudinary upload failed:', uploadError);
                return res.status(500).json({
                    message: 'Failed to upload file to cloud storage',
                    error: uploadError.message
                });
            }

        } else if (content) {
            // Handle text/JSON content
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;

            statusContent = {
                type: parsed.type || 'text',
                text: parsed.text || '',
                backgroundColor: parsed.backgroundColor || '#000000',
                url: parsed.url || ''
            };
        } else {
            return res.status(400).json({ message: 'No content or file provided' });
        }

        // Create status in database
        const newStatus = new Status({
            userId,
            content: statusContent,
            viewedBy: [],
            isActive: true,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });

        await newStatus.save();
        await newStatus.populate('userId', 'username profilePicture');

        const responseStatus = {
            id: newStatus._id.toString(),
            userId: newStatus.userId._id.toString(),
            userName: newStatus.userId.username,
            profileImage: newStatus.userId.profilePicture || null,
            content: newStatus.content,
            createdAt: newStatus.createdAt,
            expiresAt: newStatus.expiresAt,
            viewedBy: [],
            viewers: [],
            isActive: newStatus.isActive
        };

        // ✅ CRITICAL FIX: Emit to uploader FIRST, then to friends
        const currentUser = await User.findById(userId).select('friends').lean();
        const io = req.app.get('io');

        if (io) {
            // 1. Emit to yourself (the uploader) FIRST
            io.to(userId.toString()).emit('status_uploaded', responseStatus);
            console.log('✅ Emitted status to uploader (yourself):', userId.toString());

            // 2. Then emit to friends
            if (currentUser && currentUser.friends) {
                currentUser.friends.forEach(friendId => {
                    io.to(friendId.toString()).emit('status_uploaded', responseStatus);
                });
                console.log(`✅ Emitted status to ${currentUser.friends.length} friends`);
            }
        }

        console.log('✅ Status created:', responseStatus.id);

        // Send response
        res.status(201).json(responseStatus);

    } catch (error) {
        console.error('❌ Error creating status:', error);
        res.status(500).json({ message: 'Failed to upload status', error: error.message });
    }
};

// Delete status
exports.deleteStatus = async (req, res) => {
    try {
        const { statusId } = req.params;
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        console.log(`🗑️ Deleting status ${statusId} by user ${userId}`);

        if (!mongoose.Types.ObjectId.isValid(statusId)) {
            return res.status(400).json({ message: 'Invalid status ID format' });
        }

        const status = await Status.findOne({
            _id: new mongoose.Types.ObjectId(statusId),
            userId: userId
        });

        if (!status) {
            return res.status(404).json({ message: 'Status not found or unauthorized' });
        }

        // Delete from Cloudinary if it's a cloud-hosted file
        if (status.content.url && (status.content.type === 'image' || status.content.type === 'video')) {
            if (status.content.url.includes('cloudinary.com')) {
                try {
                    // Extract public ID from Cloudinary URL
                    const urlParts = status.content.url.split('/');
                    const fileWithExt = urlParts[urlParts.length - 1];
                    const publicId = `chat-app-uploads/${fileWithExt.split('.')[0]}`;

                    await cloudinary.uploader.destroy(publicId, {
                        resource_type: status.content.type
                    });
                    console.log('☁️ Cloudinary file deleted:', publicId);
                } catch (cloudError) {
                    console.error('⚠️ Failed to delete from Cloudinary:', cloudError);
                }
            } else {
                // Delete local file if it exists
                const filePath = path.join(__dirname, '..', status.content.url);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log('🗑️ Local file deleted:', filePath);
                }
            }
        }

        await Status.findByIdAndDelete(statusId);
        console.log('✅ Status deleted successfully:', statusId);

        // Emit deletion to friends
        const currentUser = await User.findById(userId).select('friends').lean();
        const io = req.app.get('io');
        if (io && currentUser.friends) {
            currentUser.friends.forEach(friendId => {
                io.to(friendId.toString()).emit('status_deleted', {
                    statusId: statusId,
                    userId: userId.toString()
                });
            });
        }

        res.json({
            success: true,
            message: 'Status deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error deleting status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete status',
            error: error.message
        });
    }
};

// Additional helper function for safer array access
const getUserArrays = (user) => {
    return {
        friends: Array.isArray(user.friends) ? user.friends : [],
        blockedUsers: Array.isArray(user.blockedUsers) ? user.blockedUsers : [],
        blockedBy: Array.isArray(user.blockedBy) ? user.blockedBy : []
    };
};

// Mark single status as viewed
exports.markAsViewed = async (req, res) => {
    try {
        const { statusId } = req.params;
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        console.log(`👁️ Marking status ${statusId} as viewed by user ${userId}`);

        if (!mongoose.Types.ObjectId.isValid(statusId)) {
            return res.status(400).json({ message: 'Invalid status ID format' });
        }

        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const status = await Status.findById(statusId)
            .populate('userId', 'username profilePicture')
            .populate({
                path: 'viewers.userId',
                select: 'username profilePicture'
            });

        if (!status) {
            return res.status(404).json({ message: 'Status not found' });
        }

        const statusOwnerId = status.userId._id.toString();
        const currentUserIdStr = userId.toString();

        if (statusOwnerId === currentUserIdStr) {
            const statusData = {
                id: status._id.toString(),
                userId: statusOwnerId,
                userName: status.userId.username,
                profileImage: status.userId.profilePicture ? `/uploads/${path.basename(status.userId.profilePicture)}` : null,
                content: status.content,
                createdAt: status.createdAt,
                expiresAt: status.expiresAt,
                viewedBy: status.viewedBy.map(id => id.toString()),
                viewers: (status.viewers || []).map(viewer => ({
                    userId: viewer.userId._id.toString(),
                    userName: viewer.userId.username,
                    profilePicture: viewer.userId.profilePicture ? `/uploads/${path.basename(viewer.userId.profilePicture)}` : null,
                    viewedAt: viewer.viewedAt
                })),
                isActive: status.isActive
            };

            return res.json({
                success: true,
                message: 'Cannot view own status',
                wasNewView: false,
                totalViews: status.viewers ? status.viewers.length : 0,
                updatedStatus: statusData
            });
        }

        const { friends: userFriends, blockedUsers: userBlockedUsers, blockedBy: userBlockedBy } = getUserArrays(currentUser);

        const isStatusOwnerFriend = userFriends.some(friendId =>
            friendId.toString() === statusOwnerId
        );

        const isBlocked = userBlockedUsers.some(blockedId =>
            blockedId.toString() === statusOwnerId
        ) || userBlockedBy.some(blockedById =>
            blockedById.toString() === statusOwnerId
        );

        if (!isStatusOwnerFriend || isBlocked) {
            return res.status(403).json({
                message: 'Cannot view this status - user is not a friend or is blocked'
            });
        }

        let wasNewView = false;
        const hasViewed = status.viewers && status.viewers.some(viewer =>
            viewer.userId._id.toString() === currentUserIdStr
        );

        if (!hasViewed) {
            const updatedStatus = await Status.findByIdAndUpdate(
                statusId,
                {
                    $addToSet: { viewedBy: userId },
                    $push: {
                        viewers: {
                            userId: userId,
                            viewedAt: new Date()
                        }
                    }
                },
                { new: true }
            )
                .populate('userId', 'username profilePicture')
                .populate({
                    path: 'viewers.userId',
                    select: 'username profilePicture'
                });

            wasNewView = true;
            console.log(`✅ Status ${statusId} viewed by ${userId} - Total views: ${updatedStatus.viewers.length}`);

            const updatedStatusData = {
                id: updatedStatus._id.toString(),
                userId: updatedStatus.userId._id.toString(),
                userName: updatedStatus.userId.username,
                profileImage: updatedStatus.userId.profilePicture ? `/uploads/${path.basename(updatedStatus.userId.profilePicture)}` : null,
                content: updatedStatus.content,
                createdAt: updatedStatus.createdAt,
                expiresAt: updatedStatus.expiresAt,
                viewedBy: updatedStatus.viewedBy.map(id => id.toString()),
                viewers: (updatedStatus.viewers || []).map(viewer => ({
                    userId: viewer.userId._id.toString(),
                    userName: viewer.userId.username,
                    profilePicture: viewer.userId.profilePicture ? `/uploads/${path.basename(viewer.userId.profilePicture)}` : null,
                    viewedAt: viewer.viewedAt
                })),
                isActive: updatedStatus.isActive
            };

            const io = req.app.get('io');
            if (io) {
                io.to(updatedStatus.userId._id.toString()).emit('status_viewed', {
                    statusId: updatedStatus._id.toString(),
                    viewerId: userId.toString(),
                    updatedStatus: updatedStatusData
                });
            }

            return res.json({
                success: true,
                message: 'Status marked as viewed',
                wasNewView,
                totalViews: updatedStatus.viewers.length,
                statusOwnerId: updatedStatus.userId._id.toString(),
                updatedStatus: updatedStatusData
            });
        } else {
            console.log(`🔄 Status ${statusId} already viewed by user ${userId}`);

            const statusData = {
                id: status._id.toString(),
                userId: status.userId._id.toString(),
                userName: status.userId.username,
                profileImage: status.userId.profilePicture ? `/uploads/${path.basename(status.userId.profilePicture)}` : null,
                content: status.content,
                createdAt: status.createdAt,
                expiresAt: status.expiresAt,
                viewedBy: status.viewedBy.map(id => id.toString()),
                viewers: (status.viewers || []).map(viewer => ({
                    userId: viewer.userId._id.toString(),
                    userName: viewer.userId.username,
                    profilePicture: viewer.userId.profilePicture ? `/uploads/${path.basename(viewer.userId.profilePicture)}` : null,
                    viewedAt: viewer.viewedAt
                })),
                isActive: status.isActive
            };

            return res.json({
                success: true,
                message: 'Status already viewed',
                wasNewView,
                totalViews: status.viewers ? status.viewers.length : 0,
                statusOwnerId: status.userId._id.toString(),
                updatedStatus: statusData
            });
        }

    } catch (error) {
        console.error('❌ Error marking status as viewed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark status as viewed',
            error: error.message
        });
    }
};

// Mark multiple statuses as viewed (bulk operation)
exports.markMultipleAsViewed = async (req, res) => {
    try {
        const { statusIds } = req.body;
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        if (!Array.isArray(statusIds) || statusIds.length === 0) {
            return res.status(400).json({ message: 'statusIds must be a non-empty array' });
        }

        const validStatusIds = statusIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validStatusIds.length === 0) {
            return res.status(400).json({ message: 'No valid status IDs provided' });
        }

        console.log(`📦 Bulk viewing ${validStatusIds.length} statuses by user ${userId}`);

        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const objectIds = validStatusIds.map(id => new mongoose.Types.ObjectId(id));

        const statusesToUpdate = await Status.find({
            _id: { $in: objectIds },
            userId: {
                $ne: userId,
                $in: currentUser.friends,
                $nin: [...(currentUser.blockedUsers || []), ...(currentUser.blockedBy || [])]
            },
            viewedBy: { $ne: userId },
            isActive: true,
            expiresAt: { $gt: new Date() }
        }).populate('userId', 'username profilePicture');

        const updatedStatuses = [];

        if (statusesToUpdate.length > 0) {
            const bulkOps = statusesToUpdate.map(status => ({
                updateOne: {
                    filter: { _id: status._id },
                    update: {
                        $addToSet: { viewedBy: userId },
                        $push: {
                            viewers: {
                                userId: userId,
                                viewedAt: new Date()
                            }
                        }
                    }
                }
            }));

            await Status.bulkWrite(bulkOps);

            const updatedStatusDocs = await Status.find({
                _id: { $in: statusesToUpdate.map(s => s._id) }
            }).populate('userId', 'username profilePicture');

            updatedStatusDocs.forEach(status => {
                updatedStatuses.push({
                    id: status._id.toString(),
                    userId: status.userId._id.toString(),
                    userName: status.userId.username,
                    profilePicture: status.userId.profilePicture ? `/uploads/${path.basename(status.userId.profilePicture)}` : null,
                    content: status.content,
                    createdAt: status.createdAt,
                    expiresAt: status.expiresAt,
                    viewedBy: status.viewedBy.map(id => id.toString()),
                    isActive: status.isActive
                });
            });

            console.log(`✅ Bulk view completed: ${updatedStatuses.length}/${validStatusIds.length} statuses updated`);
        }

        res.json({
            success: true,
            message: 'Bulk view update completed',
            processedCount: updatedStatuses.length,
            totalRequested: validStatusIds.length,
            updatedStatuses
        });

    } catch (error) {
        console.error('❌ Error in bulk status view:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process bulk status views',
            error: error.message
        });
    }
};

// Get all users (only friends)
exports.getAllUsers = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const users = await User.find({
            _id: {
                $in: currentUser.friends,
                $nin: [...(currentUser.blockedUsers || []), ...(currentUser.blockedBy || [])]
            }
        }, 'username email _id isOnline lastSeen profilePicture').lean();

        const formattedUsers = users.map(user => ({
            ...user,
            profilePicture: user.profilePicture ? `/uploads/${path.basename(user.profilePicture)}` : null
        }));

        res.json(formattedUsers);

    } catch (error) {
        console.error('❌ Error getting users:', error);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
};

// Get user's own statuses
exports.getMyStatuses = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const myStatuses = await Status.find({
            userId: userId,
            isActive: true,
            expiresAt: { $gt: new Date() }
        })
            .populate('userId', 'username profilePicture')
            .populate({
                path: 'viewers.userId',
                select: 'username profilePicture'
            })
            .lean();

        const formattedStatuses = myStatuses.map(status => {
            const filteredStatus = filterViewersForUser(status, currentUser);

            return {
                id: filteredStatus._id.toString(),
                userId: filteredStatus.userId._id.toString(),
                userName: filteredStatus.userId.username,
                profileImage: filteredStatus.userId.profilePicture ? `/uploads/${path.basename(filteredStatus.userId.profilePicture)}` : null,
                content: filteredStatus.content,
                createdAt: filteredStatus.createdAt,
                expiresAt: filteredStatus.expiresAt,
                viewedBy: filteredStatus.viewedBy.map(id => id.toString()),
                viewers: filteredStatus.viewers ? filteredStatus.viewers.map(viewer => ({
                    userId: viewer.userId._id.toString(),
                    userName: viewer.userId.username,
                    profilePicture: viewer.userId.profilePicture ? `/uploads/${path.basename(viewer.userId.profilePicture)}` : null,
                    viewedAt: viewer.viewedAt
                })) : [],
                isActive: filteredStatus.isActive
            };
        });

        res.json({
            success: true,
            statuses: formattedStatuses,
            count: formattedStatuses.length
        });

    } catch (error) {
        console.error('❌ Error getting my statuses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch your statuses'
        });
    }
};

// Get specific status by ID
exports.getStatusById = async (req, res) => {
    try {
        const { statusId } = req.params;
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        if (!mongoose.Types.ObjectId.isValid(statusId)) {
            return res.status(400).json({ message: 'Invalid status ID format' });
        }

        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const status = await Status.findOne({
            _id: new mongoose.Types.ObjectId(statusId),
            isActive: true,
            expiresAt: { $gt: new Date() }
        }).populate('userId', 'username profilePicture');

        if (!status) {
            return res.status(404).json({ message: 'Status not found or expired' });
        }

        const statusOwnerId = status.userId._id.toString();
        const currentUserIdStr = userId.toString();

        const isOwnStatus = statusOwnerId === currentUserIdStr;
        const isStatusOwnerFriend = currentUser.friends.some(friendId =>
            friendId.toString() === statusOwnerId
        );
        const isBlocked = currentUser.blockedUsers.some(blockedId =>
            blockedId.toString() === statusOwnerId
        ) || currentUser.blockedBy.some(blockedById =>
            blockedById.toString() === statusOwnerId
        );

        if (!isOwnStatus && (!isStatusOwnerFriend || isBlocked)) {
            return res.status(403).json({
                message: 'Cannot view this status - user is not a friend or is blocked'
            });
        }

        const formattedStatus = {
            id: status._id.toString(),
            userId: statusOwnerId,
            userName: status.userId.username,
            profilePicture: status.userId.profilePicture ? `/uploads/${path.basename(status.userId.profilePicture)}` : null,
            content: status.content,
            createdAt: status.createdAt,
            expiresAt: status.expiresAt,
            viewedBy: status.viewedBy.map(id => id.toString()),
            isActive: status.isActive,
            hasUserViewed: status.hasUserViewed(userId),
            isExpired: status.isExpired()
        };

        res.json({
            success: true,
            status: formattedStatus
        });

    } catch (error) {
        console.error('❌ Error getting status by ID:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch status'
        });
    }
};