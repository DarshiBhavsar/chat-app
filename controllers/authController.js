const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

exports.registerUser = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({ username, email, password: hashedPassword });

        await newUser.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Register Error:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user._id, username: user.username }, 'secretKey', { expiresIn: '24h' });
        res.status(200).json({ message: 'Logged in successfully', token });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const currentUserId = req.user?.id;

        // Get all users except the current user
        const users = await User.find({ _id: { $ne: currentUserId } }, '-password -blockedUsers -blockedBy');

        // If we have a current user, filter out blocked users
        if (currentUserId) {
            const currentUser = await User.findById(currentUserId);
            const blockedUserIds = currentUser?.blockedUsers || [];

            const filteredUsers = users.filter(user =>
                !blockedUserIds.includes(user._id.toString())
            );

            const transformedUsers = filteredUsers.map(user => ({
                id: user._id,
                name: user.username,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen
            }));

            res.json(transformedUsers);
        } else {
            // If no current user (shouldn't happen with auth), return all users
            const transformedUsers = users.map(user => ({
                id: user._id,
                name: user.username,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen
            }));
            res.json(transformedUsers);
        }
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.blockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const blockerId = req.user.id;

        if (userId === blockerId) {
            return res.status(400).json({ message: 'Cannot block yourself' });
        }

        // Add the user to the blocker's blocked list
        await User.findByIdAndUpdate(blockerId, {
            $addToSet: { blockedUsers: userId }
        });

        // Add the blocker to the user's blockedBy list
        await User.findByIdAndUpdate(userId, {
            $addToSet: { blockedBy: blockerId }
        });

        res.json({ message: 'User blocked successfully' });
    } catch (error) {
        console.error('Error blocking user:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.unblockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const unblockerId = req.user.id;

        // Remove the user from the unblocker's blocked list
        await User.findByIdAndUpdate(unblockerId, {
            $pull: { blockedUsers: userId }
        });

        // Remove the unblocker from the user's blockedBy list
        await User.findByIdAndUpdate(userId, {
            $pull: { blockedBy: unblockerId }
        });

        res.json({ message: 'User unblocked successfully' });
    } catch (error) {
        console.error('Error unblocking user:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.getBlockedUsers = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).populate('blockedUsers', 'username email');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const blockedUsers = user.blockedUsers.map(blockedUser => ({
            id: blockedUser._id,
            name: blockedUser.username,
            email: blockedUser.email
        }));

        res.json(blockedUsers);
    } catch (error) {
        console.error('Error fetching blocked users:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};