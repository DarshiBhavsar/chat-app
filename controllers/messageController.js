const Message = require('../models/message');

// Send a new message (either private or global)
exports.sendMessage = async (req, res) => {
    try {
        const { user, message, senderId, recipientId, isPrivate } = req.body;

        const newMessage = new Message({
            user,
            message,
            senderId,
            recipientId: isPrivate ? recipientId : undefined,  // Only add recipientId for private messages
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isPrivate
        });

        // Save the message to the DB
        const savedMessage = await newMessage.save();

        return res.status(201).json(savedMessage);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Failed to send message' });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const { senderId, recipientId, isPrivate } = req.query;

        let messages;

        if (isPrivate === 'true' && recipientId) {
            // Private messages between two users
            messages = await Message.find({
                $or: [
                    { senderId, recipientId },
                    { senderId: recipientId, recipientId: senderId }
                ]
            });
        } else {
            // Public messages (global)
            messages = await Message.find({ isPrivate: true });
        }

        return res.status(200).json(messages);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Failed to fetch messages' });
    }
};

