const Message = require('../models/message');

exports.sendMessage = async (req, res) => {
    try {
        const {
            user,
            message,
            senderId,
            recipientId,
            isPrivate,
            image = [],
            documents = [],
            audio = [],
            audioDuration,
            video = [],
            replyTo
        } = req.body;

        const newMessage = new Message({
            userId: senderId,
            user,
            message,
            senderId,
            recipientId,
            image,
            documents,
            audio,
            audioDuration,
            replyTo: replyTo || null,
            video,
            time: new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Kolkata'
            }).toLowerCase(),
            isPrivate,
            messageStatus: 'sent', // Initialize with 'sent' status
            deliveredAt: null,
            readAt: null
        });

        const savedMessage = await newMessage.save();

        // FIXED: Return message with proper status structure
        const responseMessage = {
            ...savedMessage.toObject(),
            id: savedMessage._id,
            messageStatus: 'sent'
        };

        return res.status(201).json(responseMessage);
    } catch (error) {
        console.error('Send Message Error:', error);
        return res.status(500).json({
            message: 'Failed to send message',
            error: error.message
        });
    }
};

exports.sendGroupMessage = async (req, res) => {
    try {
        const {
            user,
            message,
            senderId,
            groupId,
            image = [],
            documents = [],
            audio = [],
            audioDuration,
            video = [],
            replyTo,
            groupMembers = [] // This might be empty/null from frontend
        } = req.body;

        console.log('📨 Group Message Request:', {
            senderId,
            groupId,
            groupMembers,
            message: message?.substring(0, 50) + '...'
        });

        if (!groupId) {
            return res.status(400).json({ message: 'groupId is required for group messages' });
        }

        // CRITICAL FIX: Fetch actual group members from database instead of relying on frontend
        const Group = require('../models/group');
        const group = await Group.findById(groupId).populate('members', '_id name');

        if (!group) {
            console.error('❌ Group not found:', groupId);
            return res.status(404).json({ message: 'Group not found' });
        }

        console.log('✅ Found group:', {
            name: group.name,
            memberCount: group.members.length,
            members: group.members.map(m => ({ id: m._id, name: m.name }))
        });

        // Extract valid member IDs (excluding sender)
        const validGroupMembers = group.members
            .map(member => {
                // Handle both populated and non-populated members
                const memberId = member._id ? member._id.toString() : member.toString();
                return memberId;
            })
            .filter(memberId => memberId && memberId !== senderId); // Exclude sender

        console.log('✅ Valid group members (excluding sender):', validGroupMembers);

        if (validGroupMembers.length === 0) {
            console.log('⚠️ No other members found in group, sending anyway');
        }

        const time = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata'
        }).toLowerCase();

        // CRITICAL FIX: Create group delivery status with valid member IDs only
        const groupDeliveryStatus = validGroupMembers.map(memberId => ({
            userId: memberId,
            deliveredAt: null,
            readAt: null
        }));

        console.log('✅ Group delivery status created:', {
            statusCount: groupDeliveryStatus.length,
            members: groupDeliveryStatus.map(s => s.userId)
        });

        const newMessage = new Message({
            userId: senderId,
            user,
            message,
            senderId,
            groupId,
            image,
            documents,
            time,
            audio,
            replyTo: replyTo || null,
            video,
            audioDuration,
            isPrivate: true, // Keep as true for group messages as per your schema
            messageStatus: 'sent',
            groupDeliveryStatus // Now contains valid user IDs
        });

        console.log('📝 Creating message with delivery status:', {
            messageId: newMessage._id,
            deliveryStatusCount: newMessage.groupDeliveryStatus.length,
            validUserIds: newMessage.groupDeliveryStatus.every(s => s.userId)
        });

        const savedMessage = await newMessage.save();

        console.log('✅ Group message saved successfully:', {
            messageId: savedMessage._id,
            groupId: savedMessage.groupId,
            deliveryStatusLength: savedMessage.groupDeliveryStatus.length
        });

        // Return the message with actual group member data
        const responseMessage = {
            ...savedMessage.toObject(),
            id: savedMessage._id,
            groupMembers: validGroupMembers // Send back the actual member IDs
        };

        return res.status(201).json(responseMessage);

    } catch (error) {
        console.error('❌ Send Group Message Error:', error);
        console.error('❌ Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack?.split('\n')?.slice(0, 3)
        });

        return res.status(500).json({
            message: 'Failed to send group message',
            error: error.message
        });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const senderId = req.query.senderId || req.params.senderId;
        const recipientId = req.query.recipientId || req.params.recipientId;
        const isPrivate = req.query.isPrivate;
        const currentUserId = req.user.id;

        console.log('📩 Fetching private messages:', { senderId, recipientId, isPrivate });

        if (isPrivate !== 'true' || !senderId || !recipientId) {
            return res.status(400).json({ message: 'Invalid query parameters for private chat' });
        }

        // ✅ FIXED: Use $nin to check if userId is NOT in the clearedBy array
        const messages = await Message.find({
            $or: [
                { senderId, recipientId },
                { senderId: recipientId, recipientId: senderId }
            ],
            isDeleted: false,
            groupId: { $exists: false },
            clearedBy: { $nin: [currentUserId] } // Changed from $ne to $nin
        })
            .populate('userId', 'name profilePicture')
            .sort({ createdAt: 1 })
            .lean();

        const processedMessages = messages.map(msg => ({
            ...msg,
            id: msg._id.toString(),
            _id: msg._id,
            messageStatus: msg.messageStatus || 'sent',
            deliveredAt: msg.deliveredAt || null,
            readAt: msg.readAt || null,
            profilePicture: msg.userId?.profilePicture || null
        }));

        return res.status(200).json(processedMessages);
    } catch (error) {
        console.error('❌ Get private messages error:', error);
        return res.status(500).json({ message: 'Failed to fetch private messages', error: error.message });
    }
};

exports.getGroupMessages = async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const currentUserId = req.user.id;

        console.log("📥 Group Message API Hit");
        console.log("✅ groupId:", groupId);
        console.log("✅ currentUserId:", currentUserId);

        if (!groupId) {
            console.log("❌ Missing groupId in request params");
            return res.status(400).json({ message: "Group ID is required" });
        }

        // ✅ FIXED: Use $nin to check if userId is NOT in the clearedBy array
        const messages = await Message.find({
            groupId: groupId,
            isDeleted: false,
            clearedBy: { $nin: [currentUserId] } // Changed from $ne to $nin
        })
            .populate("userId", "name profilePicture")
            .sort({ createdAt: 1 })
            .lean();

        console.log(`✅ Found ${messages.length} messages for group ${groupId}`);

        const processedMessages = messages.map(msg => ({
            ...msg,
            id: msg._id.toString(),
            _id: msg._id,
            isGroup: true,
            messageStatus: msg.messageStatus || "sent",
            groupDeliveryStatus: msg.groupDeliveryStatus || [],
            profilePicture: msg.userId?.profilePicture || null,
            userProfileImage: msg.userId?.profilePicture || null
        }));

        return res.status(200).json(processedMessages);
    } catch (error) {
        console.error("❌ Get group messages error:", error);
        return res.status(500).json({
            message: "Failed to fetch group messages",
            error: error.message
        });
    }
};

// New delete message controller
exports.deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { deleteType } = req.body; // 'delete_for_me' or 'delete_for_everyone'
        const currentUserId = req.user.id;

        console.log(`🗑️ Delete request: messageId=${messageId}, deleteType=${deleteType}, userId=${currentUserId}`);

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        if (deleteType === 'delete_for_me') {
            // Delete for me: Add userId to clearedBy array
            const result = await Message.findByIdAndUpdate(
                messageId,
                { $addToSet: { clearedBy: currentUserId } },
                { new: true }
            );

            console.log(`✅ Message ${messageId} deleted for user ${currentUserId} only`);

            return res.status(200).json({
                success: true,
                message: 'Message deleted for you',
                deletedMessageId: messageId,
                deleteType: 'delete_for_me'
            });

        } else if (deleteType === 'delete_for_everyone') {
            // Delete for everyone: Only sender can do this
            if (message.senderId !== currentUserId) {
                return res.status(403).json({ message: 'Only the sender can delete for everyone' });
            }

            // Mark as deleted for everyone
            const result = await Message.findByIdAndUpdate(
                messageId,
                {
                    isDeleted: true,
                    deletedAt: new Date(),
                    message: 'This message was deleted'
                },
                { new: true }
            );

            console.log(`✅ Message ${messageId} deleted for everyone by ${currentUserId}`);

            return res.status(200).json({
                success: true,
                message: 'Message deleted for everyone',
                deletedMessageId: messageId,
                deleteType: 'delete_for_everyone',
                updatedMessage: result
            });

        } else {
            return res.status(400).json({ message: 'Invalid deleteType. Use "delete_for_me" or "delete_for_everyone"' });
        }

    } catch (error) {
        console.error('❌ Delete message error:', error);
        return res.status(500).json({ message: 'Failed to delete message', error: error.message });
    }
};

// Alternative: Soft delete (marks as deleted but doesn't remove from DB)
exports.softDeleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { senderId } = req.body;

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        if (message.senderId !== senderId) {
            return res.status(403).json({ message: 'Not authorized to delete this message' });
        }

        // Mark as deleted instead of removing
        const updatedMessage = await Message.findByIdAndUpdate(
            messageId,
            {
                message: 'This message was deleted',
                isDeleted: true,
                deletedAt: new Date()
            },
            { new: true }
        );

        return res.status(200).json({
            message: 'Message deleted successfully',
            updatedMessage
        });
    } catch (error) {
        console.error('Soft delete message error:', error);
        return res.status(500).json({ message: 'Failed to delete message' });
    }
};

// Clear private chat messages between two users
exports.clearPrivateChat = async (req, res) => {
    try {
        const { recipientId } = req.params;
        const currentUserId = req.user.id;

        // ✅ FIXED: Use updateMany with $addToSet instead of deleteMany
        const result = await Message.updateMany(
            {
                $or: [
                    { senderId: currentUserId, recipientId: recipientId },
                    { senderId: recipientId, recipientId: currentUserId }
                ],
                groupId: { $exists: false }
            },
            { $addToSet: { clearedBy: currentUserId } }
        );

        console.log(`✅ Private chat cleared for user ${currentUserId}: ${result.modifiedCount} messages`);

        return res.status(200).json({
            success: true,
            modifiedCount: result.modifiedCount,
            message: 'Private chat history cleared successfully'
        });

    } catch (error) {
        console.error('Error clearing private chat:', error);
        return res.status(500).json({ message: 'Failed to clear chat history' });
    }
};

// Clear group chat messages
exports.clearGroupChat = async (req, res) => {
    try {
        const { groupId } = req.params;
        const currentUserId = req.user.id;

        // Mark messages as cleared for this user only
        const result = await Message.updateMany(
            { groupId: groupId },
            { $addToSet: { clearedBy: currentUserId } }
        );

        console.log(`✅ Group chat cleared for user ${currentUserId} in group ${groupId}: ${result.modifiedCount} messages`);

        return res.status(200).json({
            success: true,
            modifiedCount: result.modifiedCount,
            message: 'Group chat history cleared successfully'
        });

    } catch (error) {
        console.error('Error clearing group chat:', error);
        return res.status(500).json({ message: 'Failed to clear group chat history' });
    }
};

// Alternative: Soft clear - mark messages as deleted instead of removing them
exports.softClearPrivateChat = async (req, res) => {
    try {
        const { senderId, recipientId } = req.params;

        // Mark all messages as deleted between these two users
        const result = await Message.updateMany(
            {
                $or: [
                    { senderId: senderId, recipientId: recipientId },
                    { senderId: recipientId, recipientId: senderId }
                ]
            },
            {
                isDeleted: true,
                deletedAt: new Date(),
                message: 'This message was deleted'
            }
        );

        return res.status(200).json({
            success: true,
            modifiedCount: result.modifiedCount,
            message: 'Private chat history cleared successfully'
        });

    } catch (error) {
        console.error('Error soft clearing private chat:', error);
        return res.status(500).json({ message: 'Failed to clear chat history' });
    }
};

exports.softClearGroupChat = async (req, res) => {
    try {
        const { groupId } = req.params;

        // Mark all group messages as deleted
        const result = await Message.updateMany(
            { groupId: groupId },
            {
                isDeleted: true,
                deletedAt: new Date(),
                message: 'This message was deleted'
            }
        );

        return res.status(200).json({
            success: true,
            modifiedCount: result.modifiedCount,
            message: 'Group chat history cleared successfully'
        });

    } catch (error) {
        console.error('Error soft clearing group chat:', error);
        return res.status(500).json({ message: 'Failed to clear group chat history' });
    }
};

exports.toggleReaction = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { emoji, userId, userName } = req.body;

        if (!emoji || !userId) {
            return res.status(400).json({
                message: 'Emoji and userId are required'
            });
        }

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        const existingReactionIndex = message.reactions.findIndex(
            reaction => reaction.emoji === emoji
        );

        let action = 'added';
        let updatedReaction = null;

        if (existingReactionIndex !== -1) {
            const userIndex = message.reactions[existingReactionIndex].users.indexOf(userId);

            if (userIndex !== -1) {
                message.reactions[existingReactionIndex].users.splice(userIndex, 1);
                message.reactions[existingReactionIndex].count -= 1;
                action = 'removed';

                if (message.reactions[existingReactionIndex].count === 0) {
                    message.reactions.splice(existingReactionIndex, 1);
                } else {
                    updatedReaction = message.reactions[existingReactionIndex];
                }
            } else {
                message.reactions[existingReactionIndex].users.push(userId);
                message.reactions[existingReactionIndex].count += 1;
                updatedReaction = message.reactions[existingReactionIndex];
            }
        } else {
            const newReaction = {
                emoji,
                users: [userId],
                count: 1
            };
            message.reactions.push(newReaction);
            updatedReaction = newReaction;
        }

        const savedMessage = await message.save();

        return res.status(200).json({
            success: true,
            action,
            messageId,
            emoji,
            userId,
            userName,
            updatedReaction,
            allReactions: savedMessage.reactions
        });

    } catch (error) {
        console.error('Toggle reaction error:', error);
        return res.status(500).json({
            message: 'Failed to toggle reaction',
            error: error.message
        });
    }
};

// Get all reactions for a specific message
exports.getMessageReactions = async (req, res) => {
    try {
        const { messageId } = req.params;

        const message = await Message.findById(messageId).select('reactions');
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        return res.status(200).json({
            messageId,
            reactions: message.reactions || []
        });

    } catch (error) {
        console.error('Get reactions error:', error);
        return res.status(500).json({
            message: 'Failed to get reactions',
            error: error.message
        });
    }
};

// Get detailed reaction info (who reacted with what)
exports.getReactionDetails = async (req, res) => {
    try {
        const { messageId, emoji } = req.params;

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        const reaction = message.reactions.find(r => r.emoji === emoji);
        if (!reaction) {
            return res.status(404).json({ message: 'Reaction not found' });
        }

        // You might want to populate user details here
        // For now, returning user IDs
        return res.status(200).json({
            messageId,
            emoji,
            users: reaction.users,
            count: reaction.count
        });

    } catch (error) {
        console.error('Get reaction details error:', error);
        return res.status(500).json({
            message: 'Failed to get reaction details',
            error: error.message
        });
    }
};

// FIXED: Mark message as delivered (single tick -> double tick)
exports.markMessageDelivered = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId } = req.body;

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        let updated = false;

        // For private messages
        if (message.recipientId && message.recipientId === userId) {
            if (message.messageStatus === 'sent') {
                message.messageStatus = 'delivered';
                message.deliveredAt = new Date();
                updated = true;
                console.log(`📬 Private message ${messageId} marked as delivered for user ${userId}`);
            }
        }
        // For group messages
        else if (message.groupId) {
            const userDeliveryStatus = message.groupDeliveryStatus.find(
                status => status.userId === userId
            );

            if (userDeliveryStatus && !userDeliveryStatus.deliveredAt) {
                userDeliveryStatus.deliveredAt = new Date();
                updated = true;
                console.log(`📬 Group message ${messageId} marked as delivered for user ${userId}`);

                // FIXED: Update overall message status for groups based on delivery count
                const totalMembers = message.groupDeliveryStatus.length;
                const deliveredCount = message.groupDeliveryStatus.filter(s => s.deliveredAt).length;

                // If all members have received it, update main status
                if (deliveredCount === totalMembers && message.messageStatus === 'sent') {
                    message.messageStatus = 'delivered';
                }
            }
        }

        if (updated) {
            await message.save();
        }

        return res.status(200).json({
            success: true,
            messageId,
            messageStatus: message.messageStatus,
            deliveredAt: message.deliveredAt || new Date(),
            groupDeliveryStatus: message.groupDeliveryStatus
        });
    } catch (error) {
        console.error('Mark delivered error:', error);
        return res.status(500).json({ message: 'Failed to mark message as delivered' });
    }
};

// FIXED: Mark message as read (double tick -> blue tick/seen)
exports.markMessageRead = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId } = req.body;

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        let updated = false;

        // For private messages
        if (message.recipientId && message.recipientId === userId) {
            if (message.messageStatus !== 'read') {
                message.messageStatus = 'read';
                message.readAt = new Date();

                // Ensure it's also marked as delivered if not already
                if (!message.deliveredAt) {
                    message.deliveredAt = new Date();
                }

                updated = true;
                console.log(`👁️ Private message ${messageId} marked as read by user ${userId}`);
            }
        }
        // For group messages
        else if (message.groupId) {
            const userDeliveryStatus = message.groupDeliveryStatus.find(
                status => status.userId === userId
            );

            if (userDeliveryStatus && !userDeliveryStatus.readAt) {
                userDeliveryStatus.readAt = new Date();

                // Ensure it's also marked as delivered for this user
                if (!userDeliveryStatus.deliveredAt) {
                    userDeliveryStatus.deliveredAt = new Date();
                }

                updated = true;
                console.log(`👁️ Group message ${messageId} marked as read by user ${userId}`);

                // FIXED: Update overall message status for groups based on read count
                const totalMembers = message.groupDeliveryStatus.length;
                const readCount = message.groupDeliveryStatus.filter(s => s.readAt).length;

                // If all members have read it, update main status
                if (readCount === totalMembers && message.messageStatus !== 'read') {
                    message.messageStatus = 'read';
                    message.readAt = new Date();
                }
            }
        }

        if (updated) {
            await message.save();
        }

        return res.status(200).json({
            success: true,
            messageId,
            messageStatus: message.messageStatus,
            readAt: message.readAt || new Date(),
            groupDeliveryStatus: message.groupDeliveryStatus
        });
    } catch (error) {
        console.error('Mark read error:', error);
        return res.status(500).json({ message: 'Failed to mark message as read' });
    }
};

// Mark multiple messages as read (when user opens chat)
exports.markMultipleMessagesRead = async (req, res) => {
    try {
        const { messageIds, userId } = req.body;

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
            return res.status(400).json({ message: 'messageIds array is required' });
        }

        const messages = await Message.find({ _id: { $in: messageIds } });
        const updatedMessages = [];

        for (const message of messages) {
            let updated = false;

            // For private messages
            if (message.recipientId === userId && message.messageStatus !== 'read') {
                message.messageStatus = 'read';
                message.readAt = new Date();

                if (!message.deliveredAt) {
                    message.deliveredAt = new Date();
                }
                updated = true;
                console.log(`👁️ Bulk read: Private message ${message._id} marked as read`);
            }
            // For group messages
            else if (message.groupId) {
                const userDeliveryStatus = message.groupDeliveryStatus.find(
                    status => status.userId === userId
                );

                if (userDeliveryStatus && !userDeliveryStatus.readAt) {
                    userDeliveryStatus.readAt = new Date();

                    if (!userDeliveryStatus.deliveredAt) {
                        userDeliveryStatus.deliveredAt = new Date();
                    }

                    // Check if all members have read it
                    const totalMembers = message.groupDeliveryStatus.length;
                    const readCount = message.groupDeliveryStatus.filter(s => s.readAt).length;

                    if (readCount === totalMembers && message.messageStatus !== 'read') {
                        message.messageStatus = 'read';
                        message.readAt = new Date();
                    }

                    updated = true;
                    console.log(`👁️ Bulk read: Group message ${message._id} marked as read`);
                }
            }

            if (updated) {
                await message.save();
                updatedMessages.push({
                    messageId: message._id,
                    messageStatus: message.messageStatus
                });
            }
        }

        return res.status(200).json({
            success: true,
            updatedMessages,
            totalUpdated: updatedMessages.length
        });
    } catch (error) {
        console.error('Mark multiple read error:', error);
        return res.status(500).json({ message: 'Failed to mark messages as read' });
    }
};


exports.getMessageStatus = async (req, res) => {
    try {
        const { messageId } = req.params;

        const message = await Message.findById(messageId).select(
            'messageStatus deliveredAt readAt groupDeliveryStatus senderId recipientId groupId'
        );

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        return res.status(200).json({
            messageId,
            messageStatus: message.messageStatus,
            deliveredAt: message.deliveredAt,
            readAt: message.readAt,
            groupDeliveryStatus: message.groupDeliveryStatus,
            isPrivate: !!message.recipientId,
            isGroup: !!message.groupId
        });
    } catch (error) {
        console.error('Get message status error:', error);
        return res.status(500).json({ message: 'Failed to get message status' });
    }
};

exports.batchStatusCheck = async (req, res) => {
    try {
        const { messageIds, groupId } = req.body;
        const userId = req.user.id;

        console.log(`📊 Batch status check requested by ${userId}`, { messageIds, groupId });

        if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
            return res.status(400).json({ error: 'Invalid messageIds array' });
        }

        // Find all messages by IDs that belong to the requesting user
        const messages = await Message.find({
            _id: { $in: messageIds },
            senderId: userId, // Only allow checking status of own messages
            ...(groupId && { groupId }) // Filter by group if specified
        }).select('_id messageStatus deliveredAt readAt groupDeliveryStatus groupId');

        console.log(`📊 Found ${messages.length} messages for status check`);

        // Prepare status updates
        const updates = messages.map(message => ({
            messageId: message._id.toString(),
            status: message.messageStatus,
            deliveredAt: message.deliveredAt,
            readAt: message.readAt,
            groupDeliveryStatus: message.groupDeliveryStatus || [],
            isGroupMessage: !!message.groupId
        }));

        console.log(`📊 Sending ${updates.length} status updates`);

        res.json({
            success: true,
            updates,
            totalChecked: messageIds.length,
            totalFound: messages.length
        });

    } catch (error) {
        console.error('Error in batch status check:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check message statuses',
            details: error.message
        });
    }
};

// Optional: Add real-time status update endpoint
exports.updateMessageStatusRealTime = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { status, userId, timestamp, groupId } = req.body;

        console.log('📊 Real-time status update request:', { messageId, status, userId, groupId });

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        let updated = false;
        const updateTime = new Date(timestamp || Date.now());

        // Handle different status updates
        switch (status) {
            case 'delivered':
                if (message.groupId && groupId) {
                    // Group message delivery
                    const userStatus = message.groupDeliveryStatus.find(s => s.userId === userId);
                    if (userStatus && !userStatus.deliveredAt) {
                        userStatus.deliveredAt = updateTime;
                        updated = true;
                    }

                    // Update main message status if this is first delivery
                    if (message.messageStatus === 'sent') {
                        message.messageStatus = 'delivered';
                        message.deliveredAt = updateTime;
                    }
                } else if (message.recipientId === userId) {
                    // Private message delivery
                    if (message.messageStatus === 'sent') {
                        message.messageStatus = 'delivered';
                        message.deliveredAt = updateTime;
                        updated = true;
                    }
                }
                break;

            case 'read':
                if (message.groupId && groupId) {
                    // Group message read
                    const userStatus = message.groupDeliveryStatus.find(s => s.userId === userId);
                    if (userStatus && !userStatus.readAt) {
                        userStatus.readAt = updateTime;
                        if (!userStatus.deliveredAt) {
                            userStatus.deliveredAt = updateTime;
                        }
                        updated = true;
                    }

                    // Update main message status
                    message.messageStatus = 'read';
                    message.readAt = updateTime;
                } else if (message.recipientId === userId) {
                    // Private message read
                    message.messageStatus = 'read';
                    message.readAt = updateTime;
                    if (!message.deliveredAt) {
                        message.deliveredAt = updateTime;
                    }
                    updated = true;
                }
                break;
        }

        if (updated) {
            await message.save();
            console.log(`📊 ✅ Message ${messageId} status updated to ${status}`);
        }

        return res.json({
            success: true,
            messageId,
            status: message.messageStatus,
            deliveredAt: message.deliveredAt,
            readAt: message.readAt,
            groupDeliveryStatus: message.groupDeliveryStatus,
            updated
        });

    } catch (error) {
        console.error('Real-time status update error:', error);
        return res.status(500).json({
            message: 'Failed to update message status',
            error: error.message
        });
    }
};
