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
        if (!imageUrl || !imageUrl.includes('cloudinary.com')) return;

        // Extract public_id from Cloudinary URL
        const parts = imageUrl.split('/');
        const publicIdWithExtension = parts[parts.length - 1];
        const publicId = publicIdWithExtension.split('.')[0];

        // Delete from Cloudinary
        await cloudinary.uploader.destroy(`chat-app-uploads/${publicId}`);
        console.log('Image deleted from Cloudinary successfully');
    } catch (error) {
        console.log('Cloudinary deletion failed:', error.message);
    }
};

// Upload profile picture
exports.uploadProfilePicture = async (req, res) => {
    try {
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Get current user to check for existing profile picture
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Delete old profile picture from Cloudinary if it exists
        if (user.profilePicture) {
            await deleteFromCloudinary(user.profilePicture);
        }

        // The file URL is automatically provided by Cloudinary via multer-storage-cloudinary
        const imageUrl = req.file.path; // This is the full Cloudinary URL

        console.log('Full Cloudinary URL:', imageUrl); // Debug log

        // Ensure URL is not truncated - validate length
        if (imageUrl.length < 50) {
            console.error('URL appears truncated:', imageUrl);
            return res.status(500).json({ message: 'Image URL generation failed' });
        }

        // Update user in database with full Cloudinary URL
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { profilePicture: imageUrl },
            { new: true, select: 'username email profilePicture isOnline lastSeen about phone' }
        );

        // Emit socket event
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

        // Return response with full Cloudinary URL
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

        // Delete profile picture from Cloudinary if it exists
        if (user.profilePicture) {
            await deleteFromCloudinary(user.profilePicture);
        }

        // Remove profile picture from database
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $unset: { profilePicture: 1 } },
            { new: true, select: 'username email profilePicture isOnline lastSeen about phone' }
        );

        // Emit socket event
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
        // Use userId from params if available, otherwise use current user
        const userId = req.params.userId || req.user.id;

        console.log('Getting profile for userId:', userId); // Debug log

        const user = await User.findById(userId).select('username email profilePicture isOnline lastSeen about phone');
        if (!user) {
            console.log('User not found for ID:', userId); // Debug log
            return res.status(404).json({ message: 'User not found' });
        }

        console.log('Found user with profile picture:', user.profilePicture); // Debug log

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
        const { groupId } = req.params;
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Get current group and check if user is a member/admin
        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is a member of the group
        const isMember = group.members.some(member =>
            member.userId?.toString() === userId || member.toString() === userId
        );

        if (!isMember) {
            return res.status(403).json({ message: 'You are not a member of this group' });
        }

        // Delete old group picture from Cloudinary if it exists
        if (group.profilePicture) {
            await deleteFromCloudinary(group.profilePicture);
        }

        // Get Cloudinary URL from uploaded file
        const imageUrl = req.file.path;

        console.log('Group picture URL:', imageUrl); // Debug log

        // Update group in database with Cloudinary URL
        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { profilePicture: imageUrl },
            { new: true }
        ).populate('members', 'username email profilePicture');

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        if (io) {
            io.to(`group_${groupId}`).emit('group_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                newGroupPicture: imageUrl,
                fullUrl: imageUrl
            });
        }

        res.json({
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
        });

    } catch (error) {
        console.error('Error uploading group picture:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Remove group picture
exports.removeGroupPicture = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is a member of the group
        const isMember = group.members.some(member =>
            member.userId?.toString() === userId || member.toString() === userId
        );

        if (!isMember) {
            return res.status(403).json({ message: 'You are not a member of this group' });
        }

        // Delete group picture from Cloudinary if it exists
        if (group.profilePicture) {
            await deleteFromCloudinary(group.profilePicture);
        }

        // Remove group picture from database
        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $unset: { profilePicture: 1 } },
            { new: true }
        ).populate('members', 'username email profilePicture');

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.to(`group_${groupId}`).emit('group_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                newGroupPicture: null
            });
        }

        res.json({
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
        });
    } catch (error) {
        console.error('Error removing group picture:', error);
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
        const userId = req.user.id; // Use current user, not from params
        const { name, username, about, phone, email } = req.body;

        // Build update object with only provided fields
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

        // Emit socket event for profile update
        const io = req.app.get('io');
        if (io) {
            console.log('🔄 Emitting user_profile_updated event for userId:', updatedUser._id.toString());

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

            console.log('✅ user_profile_updated event emitted successfully');
        } else {
            console.warn('⚠️ Socket.io instance not found');
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