const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');

const emitStatusFeedRefresh = async (io, userId, refreshData) => {
    try {
        io.to(userId).emit('status_feed_refresh', refreshData);
        console.log(`📱 Status feed refresh sent to user ${userId}:`, refreshData.reason);
    } catch (error) {
        console.error('❌ Error emitting status feed refresh:', error);
    }
};

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

        const token = jwt.sign({ id: user._id, username: user.username, email: user.email }, 'secretKey', { expiresIn: '24h' });
        res.status(200).json({ message: 'Logged in successfully', token });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.forgotPassword = (req, res) => {
    const { email } = req.body;

    User.findOne({ email: email })
        .then(user => {
            if (!user) {
                return res.send({ Status: 'User not existed' });
            }

            const token = jwt.sign({ id: user._id }, "jwt-secret-key", { expiresIn: '1d' });

            var transporter = nodemailer.createTransport({
                // service: 'gmail',
                host: 'smtp.gmail.com',
                port: 465,                     // explicit TLS port
                secure: true,
                service: 'gmail',
                auth: {
                    user: '190020107006ait@gmail.com',
                    pass: 'qixy fuup emty gvgn'
                }
            });

            var mailOptions = {
                from: '190020107006ait@gmail.com',
                to: email,
                subject: 'Reset Password Link',
                text: `https://socket-application-react-nodejs.onrender.com/api/auth/reset-password/${user._id}/${token}`
            };

            transporter.sendMail(mailOptions, function (error, info) {
                if (error) {
                    console.log(error);
                    return res.send({ Status: 'Error sending email' });
                } else {
                    return res.send({ Status: "Success" });
                }
            });
        })
        .catch(err => res.json(err));
};

exports.resetPassword = (req, res) => {
    const { id, token } = req.params;
    const { password } = req.body;

    jwt.verify(token, "jwt-secret-key", (err, decoded) => {
        if (err) {
            return res.json({ Status: "Error with token" });
        } else {
            bcrypt.hash(password, 10)
                .then(hash => {
                    User.findByIdAndUpdate(id, { password: hash })
                        .then(u => res.send({ Status: 'Success' }))
                        .catch(err => res.send({ Status: err }));
                })
                .catch(err => res.send({ Status: err }));
        }
    });
};

exports.getAllUsers = async (req, res) => {
    try {
        const currentUserId = req.user?.id;

        // Get all users except the current user, including profilePicture
        const users = await User.find(
            { _id: { $ne: currentUserId } },
            '-password -blockedUsers -blockedBy'
        );

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
                email: user.email,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen,
                // ✅ FIXED: Return direct Cloudinary URL instead of transforming it
                profilePicture: user.profilePicture || null
            }));

            res.json(transformedUsers);
        } else {
            // If no current user (shouldn't happen with auth), return all users
            const transformedUsers = users.map(user => ({
                id: user._id,
                name: user.username,
                email: user.email,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen,
                // ✅ FIXED: Return direct Cloudinary URL instead of transforming it
                profilePicture: user.profilePicture || null
            }));
            res.json(transformedUsers);
        }
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// UPDATED blockUser function with status refresh
exports.blockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const blockerId = req.user.id;

        if (userId === blockerId) {
            return res.status(400).json({ message: 'Cannot block yourself' });
        }

        const blocker = await User.findById(blockerId);
        const blockedUser = await User.findById(userId);

        if (!blockedUser || !blocker) {
            return res.status(404).json({ message: 'User not found' });
        }

        await User.findByIdAndUpdate(blockerId, {
            $addToSet: { blockedUsers: userId },
            $pull: { friends: userId }
        });

        await User.findByIdAndUpdate(userId, {
            $addToSet: { blockedBy: blockerId },
            $pull: { friends: blockerId }
        });

        const io = req.app.get('io');
        if (io) {
            // Standard blocking events
            io.emit('user_blocked_and_removed', {
                blockedUserId: userId,
                blockerUserId: blockerId,
                blockerName: blocker.username
            });

            io.emit('user_block_success', {
                blockedUserId: userId,
                blockerUserId: blockerId
            });

            // NEW: Trigger status refresh for both users
            await emitStatusFeedRefresh(io, blockerId, {
                reason: 'user_blocked',
                blockedUserId: userId,
                blockedUserName: blockedUser.username
            });

            await emitStatusFeedRefresh(io, userId, {
                reason: 'user_blocked_by',
                blockerUserId: blockerId,
                blockerUserName: blocker.username
            });
        }

        res.json({ message: 'User blocked successfully' });
    } catch (error) {
        console.error('Error blocking user:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// UPDATED unblockUser function with status refresh  
exports.unblockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const unblockerId = req.user.id;

        const unblocker = await User.findById(unblockerId);
        const unblockedUser = await User.findById(userId);

        if (!unblockedUser || !unblocker) {
            return res.status(404).json({ message: 'User not found' });
        }

        await User.findByIdAndUpdate(unblockerId, {
            $pull: { blockedUsers: userId }
        });

        await User.findByIdAndUpdate(userId, {
            $pull: { blockedBy: unblockerId }
        });

        const io = req.app.get('io');
        if (io) {
            io.emit('user_unblocked', {
                unblockedUserId: userId,
                unblockerUserId: unblockerId,
                unblockerName: unblocker.username
            });

            // Note: No automatic status refresh on unblock
            // Users need to be friends again to see each other's statuses
        }

        res.json({ message: 'User unblocked successfully' });
    } catch (error) {
        console.error('Error unblocking user:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.getBlockedUsers = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).populate('blockedUsers', 'username email profilePicture');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const blockedUsers = user.blockedUsers.map(blockedUser => ({
            id: blockedUser._id,
            name: blockedUser.username,
            email: blockedUser.email,
            // ✅ FIXED: Return direct Cloudinary URL instead of transforming it
            profilePicture: blockedUser.profilePicture || null
        }));

        res.json(blockedUsers);
    } catch (error) {
        console.error('Error fetching blocked users:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.getCurrentUser = async (req, res) => {
    try {
        const userId = req.user?.id;
        const user = await User.findById(userId).select('username email isOnline lastSeen profilePicture');

        if (!user) return res.status(404).json({ message: 'User not found' });

        res.json({
            id: user._id,
            username: user.username,
            email: user.email,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen,
            // ✅ FIXED: Return direct Cloudinary URL instead of transforming it
            profilePicture: user.profilePicture || null
        });
    } catch (error) {
        console.error('Error fetching current user:', error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

exports.updateUser = async (req, res) => {
    const userId = req.params.id;
    const { username, email, profilePicture, lastSeen, isOnline } = req.body;

    try {
        // Build the update object dynamically
        const updateFields = {};
        if (username !== undefined) updateFields.username = username;
        if (email !== undefined) updateFields.email = email;
        if (profilePicture !== undefined) updateFields.profilePicture = profilePicture;
        if (lastSeen !== undefined) updateFields.lastSeen = lastSeen;
        if (isOnline !== undefined) updateFields.isOnline = isOnline;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({
            message: 'User updated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};