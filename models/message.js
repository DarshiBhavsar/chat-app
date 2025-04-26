const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    user: { type: String, required: true },
    senderId: { type: String, required: true },
    message: { type: String, required: true },
    time: { type: String, required: true },
    recipientId: { type: String, required: true },  
    isPrivate: { type: Boolean, default: true } 
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
