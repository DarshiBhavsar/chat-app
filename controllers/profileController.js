const User = require('../models/user');
const Group = require('../models/group');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Helper function to delete image from Cloudinary
const deleteFromCloudinary = async (imageUrl) => {
    try {
        if (!imageUrl || !imageUrl.includes('cloudinary.com')) {
            console.log('Skipping Cloudinary deletion - not a Cloudinary URL:', imageUrl);
            return;
        }

        // Extract public_id from Cloudinary URL
        const parts = imageUrl.split('/');
        const publicIdWithExtension = parts[parts.length - 1];
        const publicId = publicIdWithExtension.split('.')[0];

        console.log('Extracted publicId:', publicId);
        console.log('Attempting to delete from Cloudinary:', `chat-app-uploads/${publicId}`);

        // Delete from Cloudinary
        const result = await cloudinary.uploader.destroy(`chat-app-uploads/${publicId}`);
        console.log('Cloudinary deletion result:', result);

        if (result.result === 'ok') {
            console.log('Image deleted from Cloudinary successfully');
        } else {
            console.log('Cloudinary deletion status:', result.result);
        }
    } catch (error) {
        console.error('Cloudinary deletion failed:', error.message);
        console.error('Error details:', error);
    }
};

// Upload profile picture
exports.uploadProfilePicture = async (req, res) => {
    try {
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.profilePicture) {
            await deleteFromCloudinary(user.profilePicture);
        }

        const imageUrl = req.file.path;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { profilePicture: imageUrl },
            { new: true, select: 'username email profilePicture isOnline lastSeen about phone' }
        );

        const io = req.app.get('io');
        if (io) {
            io.emit('profile_picture_updated', {
                userId: updatedUser._id.toString(),
                userName: updatedUser.username,
                userEmail: updatedUser.email,
                newProfilePicture: imageUrl,
                fullUrl: imageUrl
            });
        }

        res.json({
            message: 'Profile picture uploaded successfully',
            url: imageUrl,
            imageUrl: imageUrl,
            user: {
                id: updatedUser._id,
                name: updatedUser.username,
                username: updatedUser.username,
                email: updatedUser.email,
                profilePicture: imageUrl,
                about: updatedUser.about,
                phone: updatedUser.phone,
                isOnline: updatedUser.isOnline,
                lastSeen: updatedUser.lastSeen
            }
        });

    } catch (error) {
        console.error('Error uploading profile picture:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Remove profile picture
exports.removeProfilePicture = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.profilePicture) {
            await deleteFromCloudinary(user.profilePicture);
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $unset: { profilePicture: 1 } },
            { new: true, select: 'username email profilePicture isOnline lastSeen about phone' }
        );

        const io = req.app.get('io');
        if (io) {
            io.emit('profile_picture_updated', {
                userId: updatedUser._id.toString(),
                userName: updatedUser.username,
                userEmail: updatedUser.email,
                newProfilePicture: null
            });
        }

        res.json({
            message: 'Profile picture removed successfully',
            user: {
                id: updatedUser._id,
                name: updatedUser.username,
                username: updatedUser.username,
                email: updatedUser.email,
                profilePicture: null,
                about: updatedUser.about,
                phone: updatedUser.phone,
                isOnline: updatedUser.isOnline,
                lastSeen: updatedUser.lastSeen
            }
        });
    } catch (error) {
        console.error('Error removing profile picture:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Get user profile with picture
exports.getUserProfile = async (req, res) => {
    try {
        const userId = req.params.userId || req.user.id;

        const user = await User.findById(userId).select('username email profilePicture isOnline lastSeen about phone');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            id: user._id,
            name: user.username,
            username: user.username,
            email: user.email,
            profilePicture: user.profilePicture || null,
            about: user.about,
            phone: user.phone,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Get all users with profile pictures
exports.getAllUsers = async (req, res) => {
    try {
        const currentUserId = req.user.id;

        const users = await User.find({ _id: { $ne: currentUserId } })
            .select('username email profilePicture isOnline lastSeen about phone')
            .sort({ username: 1 });

        const usersWithFormattedPictures = users.map(user => ({
            id: user._id,
            name: user.username,
            username: user.username,
            email: user.email,
            profilePicture: user.profilePicture || null,
            about: user.about,
            phone: user.phone,
            online: user.isOnline,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen
        }));

        res.json(usersWithFormattedPictures);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Upload group picture
exports.uploadGroupPicture = async (req, res) => {
    try {
        console.log('=== UPLOAD GROUP PICTURE START ===');
        console.log('Params:', req.params);
        console.log('User:', req.user);
        console.log('File:', req.file ? { path: req.file.path, filename: req.file.filename } : 'No file');

        const { groupId } = req.params;
        const userId = req.user.id;

        if (!req.file) {
            console.error('No file uploaded');
            return res.status(400).json({ message: 'No file uploaded' });
        }

        console.log('Finding group:', groupId);
        const group = await Group.findById(groupId);
        if (!group) {
            console.error('Group not found');
            return res.status(404).json({ message: 'Group not found' });
        }

        console.log('Group members:', group.members);
        console.log('Checking membership for userId:', userId);

        const isMember = group.members.some(member => {
            const memberId = member.userId?.toString() || member.toString();
            return memberId === userId;
        });

        console.log('Is member:', isMember);

        if (!isMember) {
            console.error('User not a member');
            return res.status(403).json({ message: 'You are not a member of this group' });
        }

        // Delete old picture
        if (group.profilePicture) {
            console.log('Deleting old picture:', group.profilePicture);
            await deleteFromCloudinary(group.profilePicture);
        }

        const imageUrl = req.file.path;
        console.log('New Cloudinary URL:', imageUrl);

        // Update group
        console.log('Updating group in database...');
        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { profilePicture: imageUrl },
            { new: true }
        ).populate('members', 'username email profilePicture');

        console.log('Group updated. New profilePicture:', updatedGroup.profilePicture);

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            console.log('Emitting socket event');
            io.to(`group_${groupId}`).emit('group_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                newGroupPicture: imageUrl,
                fullUrl: imageUrl
            });
        }

        const response = {
            message: 'Group picture uploaded successfully',
            url: imageUrl,
            imageUrl: imageUrl,
            group: {
                id: updatedGroup._id,
                name: updatedGroup.name,
                profilePicture: imageUrl,
                description: updatedGroup.description,
                members: updatedGroup.members.map(member => ({
                    id: member._id,
                    username: member.username,
                    email: member.email,
                    profilePicture: member.profilePicture || null
                }))
            }
        };

        console.log('Sending response:', JSON.stringify(response, null, 2));
        console.log('=== UPLOAD GROUP PICTURE END ===');

        res.json(response);

    } catch (error) {
        console.error('Error in uploadGroupPicture:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({
            message: 'Server Error',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Remove group picture - WITH DETAILED LOGGING
exports.removeGroupPicture = async (req, res) => {
    try {
        console.log('=== REMOVE GROUP PICTURE START ===');
        const { groupId } = req.params;
        const userId = req.user.id;

        console.log('GroupId:', groupId);
        console.log('UserId:', userId);
        console.log('Timestamp:', new Date().toISOString());

        const group = await Group.findById(groupId);
        console.log('Group found:', !!group);
        console.log('Current profilePicture in DB:', group?.profilePicture);
        console.log('ProfilePicture type:', typeof group?.profilePicture);

        if (!group) {
            console.error('Group not found');
            return res.status(404).json({ message: 'Group not found' });
        }

        const isMember = group.members.some(member =>
            member.userId?.toString() === userId || member.toString() === userId
        );
        console.log('Is member:', isMember);

        if (!isMember) {
            console.error('User not a member');
            return res.status(403).json({ message: 'You are not a member of this group' });
        }

        // Delete from Cloudinary
        if (group.profilePicture) {
            console.log('Starting Cloudinary deletion...');
            await deleteFromCloudinary(group.profilePicture);
            console.log('Cloudinary deletion completed');
        } else {
            console.log('No profilePicture to delete from Cloudinary');
        }

        // Remove from database
        console.log('Updating database with $unset...');
        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $unset: { profilePicture: 1 } },
            { new: true }
        ).populate('members', 'username email profilePicture');

        console.log('Database update completed');
        console.log('Updated profilePicture in DB:', updatedGroup.profilePicture);
        console.log('Is undefined?', updatedGroup.profilePicture === undefined);
        console.log('Is null?', updatedGroup.profilePicture === null);
        console.log('Truthiness:', !!updatedGroup.profilePicture);

        // Double-check by fetching again
        const verifyGroup = await Group.findById(groupId).lean();
        console.log('Verification fetch - profilePicture:', verifyGroup.profilePicture);
        console.log('Has profilePicture field?', 'profilePicture' in verifyGroup);

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            console.log('Emitting socket event to room: group_' + groupId);
            io.to(`group_${groupId}`).emit('group_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                newGroupPicture: null
            });
            console.log('Socket event emitted');
        } else {
            console.warn('No io instance found');
        }

        const responseData = {
            message: 'Group picture removed successfully',
            group: {
                id: updatedGroup._id,
                name: updatedGroup.name,
                profilePicture: null,
                description: updatedGroup.description,
                members: updatedGroup.members.map(member => ({
                    id: member._id,
                    username: member.username,
                    email: member.email,
                    profilePicture: member.profilePicture || null
                }))
            }
        };

        console.log('Response data:', JSON.stringify(responseData, null, 2));
        console.log('=== REMOVE GROUP PICTURE END ===');

        res.json(responseData);

    } catch (error) {
        console.error('=== ERROR IN REMOVE GROUP PICTURE ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Error details:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Get group with picture
exports.getGroupProfile = async (req, res) => {
    try {
        const { groupId } = req.params;

        const group = await Group.findById(groupId)
            .populate('members', 'username email profilePicture about phone');

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        res.json({
            id: group._id,
            name: group.name,
            description: group.description,
            profilePicture: group.profilePicture || null,
            members: group.members.map(member => ({
                id: member._id,
                username: member.username,
                email: member.email,
                about: member.about,
                phone: member.phone,
                profilePicture: member.profilePicture || null
            })),
            createdAt: group.createdAt
        });
    } catch (error) {
        console.error('Error fetching group profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Update user profile
exports.updateUserProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, username, about, phone, email } = req.body;

        const updateData = {};
        if (name) updateData.username = name;
        if (username) updateData.username = username;
        if (about !== undefined) updateData.about = about;
        if (phone !== undefined) updateData.phone = phone;
        if (email) updateData.email = email;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true, select: 'username email profilePicture about phone isOnline lastSeen' }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const io = req.app.get('io');
        if (io) {
            io.emit('user_profile_updated', {
                userId: updatedUser._id.toString(),
                id: updatedUser._id.toString(),
                name: updatedUser.username,
                username: updatedUser.username,
                email: updatedUser.email,
                about: updatedUser.about,
                phone: updatedUser.phone,
                profilePicture: updatedUser.profilePicture || null
            });
        }

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: updatedUser._id,
                name: updatedUser.username,
                username: updatedUser.username,
                email: updatedUser.email,
                about: updatedUser.about,
                phone: updatedUser.phone,
                profilePicture: updatedUser.profilePicture || null,
                isOnline: updatedUser.isOnline,
                lastSeen: updatedUser.lastSeen
            }
        });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};