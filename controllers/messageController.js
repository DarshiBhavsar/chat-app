const Message = require('../models/message');


exports.sendMessage = async (req, res) => {
    try {
        const { user, message, senderId, recipientId, isPrivate, image = [] } = req.body;

        const newMessage = new Message({
            user,
            message,
            senderId,
            recipientId,
            image,
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
        const { user, message, senderId, groupId, image } = req.body;

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
            time,
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


