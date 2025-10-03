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

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'profile_pictures',
            width: 500,
            height: 500,
            crop: 'fill'
        });

        // Update user's profile picture in database
        const user = await User.findByIdAndUpdate(
            userId,
            { profilePicture: result.secure_url },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // ✅ CRITICAL FIX: Emit socket event to notify all connected users
        const io = req.app.get('io');
        if (io) {
            // Emit to all users who are friends with this user
            io.emit('profile_picture_updated', {
                userId: user._id.toString(),
                userName: user.username,
                profilePicture: result.secure_url,
                email: user.email
            });

            console.log(`📸 Profile picture update broadcasted for user ${user.username}`);
        }

        res.json({
            message: 'Profile picture uploaded successfully',
            imageUrl: result.secure_url,
            url: result.secure_url, // For backward compatibility
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture,
                about: user.about,
                phone: user.phone
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

        const user = await User.findByIdAndUpdate(
            userId,
            { $unset: { profilePicture: "" } },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // ✅ CRITICAL FIX: Emit socket event to notify all connected users
        const io = req.app.get('io');
        if (io) {
            io.emit('profile_picture_updated', {
                userId: user._id.toString(),
                userName: user.username,
                profilePicture: null,
                email: user.email
            });

            console.log(`📸 Profile picture removal broadcasted for user ${user.username}`);
        }

        res.json({
            message: 'Profile picture removed successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                profilePicture: null,
                about: user.about,
                phone: user.phone
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

        // Emit socket events with correct event names
        const io = req.app.get('io');
        if (io) {
            console.log('Emitting socket events for group picture update');

            // Emit group_profile_picture_updated event
            io.emit('group_profile_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                profilePicture: imageUrl
            });

            // Also emit general group_updated event
            io.emit('group_updated', {
                groupId: updatedGroup._id.toString(),
                name: updatedGroup.name,
                description: updatedGroup.description,
                profilePicture: imageUrl
            });

            console.log('Socket events emitted successfully');
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

        // Emit socket events with correct event names
        const io = req.app.get('io');
        if (io) {
            console.log('Emitting socket events for group picture removal');

            // Emit group_profile_picture_updated event with null
            io.emit('group_profile_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                profilePicture: null
            });

            // Also emit general group_updated event with null
            io.emit('group_updated', {
                groupId: updatedGroup._id.toString(),
                name: updatedGroup.name,
                description: updatedGroup.description,
                profilePicture: null
            });

            console.log('Socket events emitted successfully');
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
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, username, email, about, phone } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (username !== undefined) updates.username = username;
        if (email !== undefined) updates.email = email;
        if (about !== undefined) updates.about = about;
        if (phone !== undefined) updates.phone = phone;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: 'No updates provided' });
        }

        // Check if username/email already exists (if being updated)
        if (username || email) {
            const existingUser = await User.findOne({
                _id: { $ne: userId },
                $or: [
                    ...(username ? [{ username }] : []),
                    ...(email ? [{ email }] : [])
                ]
            });

            if (existingUser) {
                return res.status(400).json({
                    message: existingUser.username === username
                        ? 'Username already taken'
                        : 'Email already registered'
                });
            }
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // ✅ Emit socket event for profile updates
        const io = req.app.get('io');
        if (io) {
            io.emit('user_profile_updated', {
                userId: user._id.toString(),
                id: user._id.toString(),
                name: user.username,
                username: user.username,
                email: user.email,
                about: user.about,
                phone: user.phone,
                profilePicture: user.profilePicture || null
            });

            console.log(`👤 Profile update broadcasted for user ${user.username}`);
        }

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture || null,
                about: user.about,
                phone: user.phone
            }
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            id: user._id,
            username: user.username,
            email: user.email,
            profilePicture: user.profilePicture || null,
            about: user.about,
            phone: user.phone,
            createdAt: user.createdAt
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};
