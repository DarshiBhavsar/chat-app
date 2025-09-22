const jwt = require('jsonwebtoken');
const User = require('../models/user');

const verifyToken = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, 'secretKey');
        const user = await User.findById(decoded.id); // ✅ Use 'id' now

        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }

        req.user = user; // Attach full user object
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token is not valid' });
    }
};

module.exports = verifyToken;
