const mongoose = require('mongoose');

const replyToSchema = new mongoose.Schema({
    id: { type: String, required: true },        // Original message ID
    message: { type: String, required: true },   // Original message text
    user: { type: String, required: true },      // Username of replier
    senderId: { type: String, required: true },  // Who sent the reply
    image: [{ type: String }],
    documents: [{ type: String }],
    audio: [{ type: String }],
    video: [{ type: String }]
}, { _id: false }); // <-- no separate _id, embedded style



module.exports = mongoose.model('Reply', replyToSchema);
