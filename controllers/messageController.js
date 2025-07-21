const Message = require('../models/message');

exports.sendMessage = async (req, res) => {
    try {
        const { user, message, senderId, recipientId, isPrivate, image = [], documents = [], audio = [],
            audioDuration, video = [] } = req.body;

        const newMessage = new Message({
            user,
            message,
            senderId,
            recipientId,
            image,
            documents,
            audio,
            audioDuration,
            video,
            time: new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Kolkata'
            }).toLowerCase(),
            isPrivate
        });

        const savedMessage = await newMessage.save();
        return res.status(201).json(savedMessage);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Failed to send message' });
    }
};

exports.sendGroupMessage = async (req, res) => {
    try {
        const { user, message, senderId, groupId, image, documents, audio = [],
            audioDuration, video = [] } = req.body;

        if (!groupId) {
            return res.status(400).json({ message: 'groupId is required for group messages' });
        }

        const time = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata'
        }).toLowerCase();

        const newMessage = new Message({
            user,
            message,
            senderId,
            groupId,
            image,
            documents,
            time,
            audio,
            video,
            audioDuration,
            isPrivate: true
        });

        const savedMessage = await newMessage.save();
        return res.status(201).json(savedMessage);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Failed to send group message' });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const { senderId, recipientId, isPrivate } = req.query;

        let messages;

        if (isPrivate === 'true' && recipientId) {
            messages = await Message.find({
                $or: [
                    { senderId, recipientId },
                    { senderId: recipientId, recipientId: senderId }
                ]
            });
        } else {
            messages = await Message.find({ isPrivate: true });
        }

        return res.status(200).json(messages);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Failed to fetch messages' });
    }
};

exports.getGroupMessages = async (req, res) => {
    try {
        const { groupId } = req.params;

        const messages = await Message.find({ groupId, isPrivate: true });
        return res.status(200).json(messages);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Failed to fetch group messages' });
    }
};

// New delete message controller
exports.deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { senderId } = req.body; // For authorization

        // Find the message first
        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        // Check if the user is authorized to delete this message
        if (message.senderId !== senderId) {
            return res.status(403).json({ message: 'Not authorized to delete this message' });
        }

        // Delete the message
        await Message.findByIdAndDelete(messageId);

        return res.status(200).json({
            message: 'Message deleted successfully',
            deletedMessageId: messageId
        });
    } catch (error) {
        console.error('Delete message error:', error);
        return res.status(500).json({ message: 'Failed to delete message' });
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