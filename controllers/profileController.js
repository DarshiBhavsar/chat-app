const User = require('../models/user');
const Group = require('../models/group'); // ✅ Add this missing import
const fs = require('fs').promises;
const path = require('path');

// Helper function to get the base URL
const getBaseUrl = (req) => {
    // In development
    if (process.env.NODE_ENV !== 'production') {
        // return 'http://localhost:5000';
        return 'https://socket-application-react-nodejs.onrender.com';
    }
    // In production, use the request protocol and host
    return `${req.protocol}://${req.get('host')}`;
};

// Helper function to convert relative URL to full URL
const getFullImageUrl = (relativePath, baseUrl) => {
    if (!relativePath) return null;
    if (relativePath.startsWith('http')) return relativePath; // Already full URL

    // Remove leading slash if present to avoid double slashes
    const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    return `${baseUrl}/${cleanPath}`;
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
            // Clean up uploaded file if user not found
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
            return res.status(404).json({ message: 'User not found' });
        }

        // Delete old profile picture if it exists
        if (user.profilePicture) {
            try {
                let oldImagePath;
                // Extract filename from any URL format
                const filename = path.basename(user.profilePicture);
                oldImagePath = path.join(__dirname, '..', 'uploads', filename);
                await fs.unlink(oldImagePath);
                console.log('Old profile picture deleted successfully');
            } catch (error) {
                console.log('Old image deletion failed (file might not exist):', error.message);
            }
        }

        // Store relative URL in database for flexibility
        const relativePath = `/uploads/${req.file.filename}`;

        // Get base URL for response
        const baseUrl = getBaseUrl(req);
        const fullImageUrl = getFullImageUrl(relativePath, baseUrl);

        // Update user in database with relative path
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { profilePicture: relativePath },
            { new: true, select: 'username email profilePicture isOnline lastSeen about phone' }
        );

        // Emit socket event with relative path (consistency)
        const io = req.app.get('io');
        if (io) {
            io.emit('profile_picture_updated', {
                userId: updatedUser._id.toString(),
                userName: updatedUser.username,
                userEmail: updatedUser.email,
                newProfilePicture: relativePath,
                fullUrl: fullImageUrl
            });
        }

        // Return full URL to frontend with complete user data
        res.json({
            message: 'Profile picture uploaded successfully',
            url: fullImageUrl, // ✅ Full URL for frontend
            imageUrl: fullImageUrl, // ✅ Alternative key for compatibility
            user: {
                id: updatedUser._id,
                name: updatedUser.username,
                username: updatedUser.username,
                email: updatedUser.email,
                profilePicture: fullImageUrl, // ✅ Full URL for frontend
                about: updatedUser.about,
                phone: updatedUser.phone,
                isOnline: updatedUser.isOnline,
                lastSeen: updatedUser.lastSeen
            }
        });

    } catch (error) {
        console.error('Error uploading profile picture:', error);

        // Clean up uploaded file if database operation fails
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
        }

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

        // Delete profile picture file if it exists
        if (user.profilePicture) {
            try {
                // Extract filename from any URL format
                const filename = path.basename(user.profilePicture);
                const imagePath = path.join(__dirname, '..', 'uploads', filename);
                await fs.unlink(imagePath);
                console.log('Profile picture file deleted successfully');
            } catch (error) {
                console.log('Image deletion failed (file might not exist):', error.message);
            }
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
                profilePicture: null, // ✅ Explicitly null
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

        // Get base URL and convert to full URL
        const baseUrl = getBaseUrl(req);
        const fullImageUrl = getFullImageUrl(user.profilePicture, baseUrl);

        res.json({
            id: user._id,
            name: user.username,
            username: user.username,
            email: user.email,
            profilePicture: fullImageUrl,
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

// Get all users with profile pictures (for user list)
exports.getAllUsers = async (req, res) => {
    try {
        const currentUserId = req.user.id;

        const users = await User.find({ _id: { $ne: currentUserId } })
            .select('username email profilePicture isOnline lastSeen about phone')
            .sort({ username: 1 });

        const baseUrl = getBaseUrl(req);

        const usersWithFormattedPictures = users.map(user => {
            const fullImageUrl = getFullImageUrl(user.profilePicture, baseUrl);

            return {
                id: user._id,
                name: user.username,
                username: user.username,
                email: user.email,
                profilePicture: fullImageUrl,
                about: user.about,
                phone: user.phone,
                online: user.isOnline,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen
            };
        });

        res.json(usersWithFormattedPictures);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ✅ Fixed uploadGroupPicture with proper error handling
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
            // Clean up uploaded file if group not found
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is a member of the group (optional: add admin check)
        const isMember = group.members.some(member =>
            member.userId?.toString() === userId || member.toString() === userId
        );

        if (!isMember) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
            return res.status(403).json({ message: 'You are not a member of this group' });
        }

        // Delete old group picture if it exists
        if (group.profilePicture) {
            try {
                const oldPicture = group.profilePicture;
                const filename = path.basename(oldPicture);
                const oldImagePath = path.join(__dirname, '..', 'uploads', filename);
                await fs.unlink(oldImagePath);
                console.log('Old group picture deleted successfully');
            } catch (error) {
                console.log('Old group image deletion failed (file might not exist):', error.message);
            }
        }

        // Store relative URL in database
        const relativePath = `/uploads/${req.file.filename}`;
        const baseUrl = getBaseUrl(req);
        const fullImageUrl = getFullImageUrl(relativePath, baseUrl);

        // Update group in database with both fields for compatibility
        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            {
                profilePicture: relativePath
            },
            { new: true }
        ).populate('members', 'username email profilePicture');

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        if (io) {
            io.to(`group_${groupId}`).emit('group_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                newGroupPicture: relativePath,
                fullUrl: fullImageUrl
            });
        }

        res.json({
            message: 'Group picture uploaded successfully',
            url: fullImageUrl,
            imageUrl: fullImageUrl,
            group: {
                id: updatedGroup._id,
                name: updatedGroup.name,
                profilePicture: fullImageUrl,
                description: updatedGroup.description,
                members: updatedGroup.members.map(member => ({
                    id: member._id,
                    username: member.username,
                    email: member.email,
                    profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
                }))
            }
        });

    } catch (error) {
        console.error('Error uploading group picture:', error);

        // Clean up uploaded file if database operation fails
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
        }

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

        // Delete group picture file if it exists
        const pictureToDelete = group.profilePicture;
        if (pictureToDelete) {
            try {
                const filename = path.basename(pictureToDelete);
                const imagePath = path.join(__dirname, '..', 'uploads', filename);
                await fs.unlink(imagePath);
                console.log('Group picture file deleted successfully');
            } catch (error) {
                console.log('Group image deletion failed (file might not exist):', error.message);
            }
        }

        // Remove group picture from database
        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            {
                $unset: {
                    profilePicture: 1  // ✅ Remove both for compatibility
                }
            },
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

        const baseUrl = getBaseUrl(req);

        res.json({
            message: 'Group picture removed successfully',
            group: {
                id: updatedGroup._id,
                name: updatedGroup.name,
                profilePicture: null, // ✅ Add for compatibility
                description: updatedGroup.description,
                members: updatedGroup.members.map(member => ({
                    id: member._id,
                    username: member.username,
                    email: member.email,
                    profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
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

        const baseUrl = getBaseUrl(req);
        const groupPicture = group.profilePicture;
        const fullImageUrl = getFullImageUrl(groupPicture, baseUrl);

        res.json({
            id: group._id,
            name: group.name,
            description: group.description,
            profilePicture: fullImageUrl, // ✅ Add for compatibility
            members: group.members.map(member => ({
                id: member._id,
                username: member.username,
                email: member.email,
                about: member.about,
                phone: member.phone,
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            createdAt: group.createdAt
        });
    } catch (error) {
        console.error('Error fetching group profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ✅ Update user profile (name, about, etc.)
exports.updateUserProfile = async (req, res) => {
    try {
        const userId = req.user.id;
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

        const baseUrl = getBaseUrl(req);
        const fullImageUrl = getFullImageUrl(updatedUser.profilePicture, baseUrl);

        // Emit socket event for profile update - FIXED EVENT NAME
        const io = req.app.get('io');
        if (io) {
            console.log('🔄 Emitting user_profile_updated event for userId:', updatedUser._id.toString());

            io.emit('user_profile_updated', {
                userId: updatedUser._id.toString(),
                id: updatedUser._id.toString(), // Include both userId and id for consistency
                name: updatedUser.username,
                username: updatedUser.username,
                email: updatedUser.email,
                about: updatedUser.about,
                phone: updatedUser.phone,
                profilePicture: fullImageUrl
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
                profilePicture: fullImageUrl,
                isOnline: updatedUser.isOnline,
                lastSeen: updatedUser.lastSeen
            }
        });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};