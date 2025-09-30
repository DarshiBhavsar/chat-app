const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Status = require('../models/status');
const User = require('../models/user');

const filterViewersForUser = (status, currentUser) => {
    if (!status.viewers || !currentUser.friends) {
        return status;
    }

    // Get list of users who are still friends and not blocked
    const allowedUserIds = [
        currentUser._id.toString(), // Include self
        ...currentUser.friends.map(id => id.toString())
    ];

    // Get blocked users list
    const blockedUserIds = [
        ...(currentUser.blockedUsers || []).map(id => id.toString()),
        ...(currentUser.blockedBy || []).map(id => id.toString())
    ];

    // Filter viewers to only include friends who are not blocked
    const filteredViewers = status.viewers.filter(viewer => {
        const viewerIdStr = viewer.userId._id.toString();
        return allowedUserIds.includes(viewerIdStr) && !blockedUserIds.includes(viewerIdStr);
    });

    // Also filter viewedBy array
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


// Get all statuses for user's feed - UPDATED with friend/block filtering
exports.getAllStatuses = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        console.log('📋 Getting all statuses for user:', userId);

        // First, get the current user with their friends and blocked users
        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Get list of users whose statuses we should show (friends only)
        const friendIds = currentUser.friends || [];

        // Get list of users we should exclude (blocked users and users who blocked us)
        const blockedUserIds = [
            ...(currentUser.blockedUsers || []),
            ...(currentUser.blockedBy || [])
        ];

        console.log(`📊 User has ${friendIds.length} friends, ${blockedUserIds.length} blocked relationships`);

        // Use parallel queries for better performance
        const [statuses, myStatusesQuery] = await Promise.all([
            // Get statuses only from friends, excluding blocked users
            Status.find({
                userId: {
                    $in: friendIds,  // Only friends
                    $nin: blockedUserIds  // Exclude blocked users
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

            // Get user's own statuses
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

        // Helper function to format status with enhanced viewer details
        const formatStatusWithViewers = (status) => {
            // Filter viewers based on current friend/block status
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
        };
        // Process my statuses with enhanced viewer data
        const myStatuses = myStatusesQuery.map(formatStatusWithViewers);

        // Group other users' statuses (only friends now)
        const statusGroupsMap = new Map();

        statuses.forEach(status => {
            const statusObj = formatStatusWithViewers(status);
            const userIdStr = status.userId._id.toString();

            if (!statusGroupsMap.has(userIdStr)) {
                statusGroupsMap.set(userIdStr, {
                    userId: userIdStr,
                    userName: status.userId.username,
                    profilePicture: status.userId.profilePicture ? `/uploads/${path.basename(status.userId.profilePicture)}` : null,
                    statuses: [],
                    hasUnviewed: false,
                    lastStatusTime: status.createdAt
                });
            }

            const group = statusGroupsMap.get(userIdStr);
            group.statuses.push(statusObj);

            // Check if user has viewed this status
            if (!status.viewedBy || !status.viewedBy.some(viewerId => viewerId.toString() === userId.toString())) {
                group.hasUnviewed = true;
            }

            // Update last status time if more recent
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

// Create new status
exports.createStatus = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user._id || req.user.id);
        const { text, backgroundColor, content } = req.body;

        console.log('📤 Creating new status for user:', userId);

        let statusContent = {};

        if (req.file) {
            const fileUrl = `/story/${req.file.filename}`;
            const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

            statusContent = {
                type: fileType,
                url: fileUrl,
                text: text || '',
                backgroundColor: backgroundColor || '#000000'
            };
        } else if (content) {
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

        const newStatus = new Status({
            userId,
            content: statusContent,
            viewedBy: [],
            isActive: true,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hrs
        });

        await newStatus.save();
        await newStatus.populate('userId', 'username profilePicture');

        const responseStatus = {
            id: newStatus._id.toString(),
            userId: newStatus.userId._id.toString(),
            userName: newStatus.userId.username,
            profilePicture: newStatus.userId.profilePicture ? `/uploads/${path.basename(newStatus.userId.profilePicture)}` : null,
            content: newStatus.content,
            createdAt: newStatus.createdAt,
            expiresAt: newStatus.expiresAt,
            viewedBy: [],
            isActive: newStatus.isActive
        };

        // ✅ Emit socket events BEFORE sending response
        const currentUser = await User.findById(userId).select('friends').lean();
        const io = req.app.get('io');

        if (io) {
            // Emit to the uploader (yourself)
            io.to(userId.toString()).emit('status_uploaded', responseStatus);
            console.log('✅ Emitted status to uploader:', userId.toString());

            // Emit to friends
            if (currentUser && currentUser.friends) {
                currentUser.friends.forEach(friendId => {
                    io.to(friendId.toString()).emit('status_uploaded', responseStatus);
                });
                console.log(`✅ Emitted status to ${currentUser.friends.length} friends`);
            }
        }

        console.log('✅ Status created:', responseStatus.id);

        // Send response last
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

        // Validate statusId format
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

        // Delete associated file if exists
        if (status.content.url && (status.content.type === 'image' || status.content.type === 'video')) {
            const filePath = path.join(__dirname, '..', status.content.url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('🗑️ Associated file deleted:', filePath);
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

// Mark single status as viewed - UPDATED with friend/block check
exports.markAsViewed = async (req, res) => {
    try {
        const { statusId } = req.params;
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        console.log(`👁️ Marking status ${statusId} as viewed by user ${userId}`);

        if (!mongoose.Types.ObjectId.isValid(statusId)) {
            return res.status(400).json({ message: 'Invalid status ID format' });
        }

        // Get current user's friend and block lists
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

        // Don't mark own status as viewed
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

        // FIXED: Use helper function to get arrays with proper defaults
        const { friends: userFriends, blockedUsers: userBlockedUsers, blockedBy: userBlockedBy } = getUserArrays(currentUser);

        // Check if status owner is a friend and not blocked
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

            // Emit real-time update to status owner
            const io = req.app.get('io');
            if (io) {
                io.to(updatedStatus.userId._id.toString()).emit('status_viewed', {
                    statusId: updatedStatus._id.toString(),
                    viewerName: updatedStatus.viewers[updatedStatus.viewers.length - 1].userId.username,
                    totalViews: updatedStatus.viewers.length,
                    viewedAt: new Date()
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

// Mark multiple statuses as viewed (bulk operation) - UPDATED with friend/block check
exports.markMultipleAsViewed = async (req, res) => {
    try {
        const { statusIds } = req.body;
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        if (!Array.isArray(statusIds) || statusIds.length === 0) {
            return res.status(400).json({ message: 'statusIds must be a non-empty array' });
        }

        // Validate all statusIds
        const validStatusIds = statusIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validStatusIds.length === 0) {
            return res.status(400).json({ message: 'No valid status IDs provided' });
        }

        console.log(`📦 Bulk viewing ${validStatusIds.length} statuses by user ${userId}`);

        // Get current user's friend and block lists
        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Use MongoDB's bulk operations for better performance
        const objectIds = validStatusIds.map(id => new mongoose.Types.ObjectId(id));

        // Find statuses that are from friends, not blocked, and user hasn't viewed yet
        const statusesToUpdate = await Status.find({
            _id: { $in: objectIds },
            userId: {
                $ne: userId,  // Not own status
                $in: currentUser.friends,  // Only friends
                $nin: [...(currentUser.blockedUsers || []), ...(currentUser.blockedBy || [])]  // Not blocked
            },
            viewedBy: { $ne: userId },
            isActive: true,
            expiresAt: { $gt: new Date() }
        }).populate('userId', 'username profilePicture');

        const updatedStatuses = [];

        if (statusesToUpdate.length > 0) {
            // Use bulk update operation
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

            // Get updated statuses with new view counts
            const updatedStatusDocs = await Status.find({
                _id: { $in: statusesToUpdate.map(s => s._id) }
            }).populate('userId', 'username profilePicture');

            // Format response data
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

// Get all users (for displaying in UI) - UPDATED to only show friends
exports.getAllUsers = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        // Get current user with friends list
        const currentUser = await User.findById(userId)
            .select('friends blockedUsers blockedBy')
            .lean();

        if (!currentUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Only return friends, excluding blocked users
        const users = await User.find({
            _id: {
                $in: currentUser.friends,  // Only friends
                $nin: [...(currentUser.blockedUsers || []), ...(currentUser.blockedBy || [])]  // Exclude blocked
            }
        }, 'username email _id isOnline lastSeen profilePicture').lean();

        // Format users with proper profile picture URLs
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

        // Get current user with friends and blocked users
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
            // Filter viewers for each status
            const filteredStatus = filterViewersForUser(status, currentUser);

            return {
                id: filteredStatus._id.toString(),
                userId: filteredStatus.userId._id.toString(),
                userName: filteredStatus.userId.username,
                profilePicture: filteredStatus.userId.profilePicture ? `/uploads/${path.basename(filteredStatus.userId.profilePicture)}` : null,
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

// Get specific status by ID - UPDATED with friend/block check
exports.getStatusById = async (req, res) => {
    try {
        const { statusId } = req.params;
        const userId = new mongoose.Types.ObjectId(req.user.id || req.user._id);

        if (!mongoose.Types.ObjectId.isValid(statusId)) {
            return res.status(400).json({ message: 'Invalid status ID format' });
        }

        // Get current user's friend and block lists
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

        // Check if it's own status or if status owner is a friend and not blocked
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