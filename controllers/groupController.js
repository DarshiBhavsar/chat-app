const Group = require('../models/group');
const fs = require('fs').promises;
const path = require('path');

// Helper function to get base URL
const getBaseUrl = (req) => {
    return `${req.protocol}://${req.get('host')}`;
};

// Helper function to get full image URL
const getFullImageUrl = (relativePath, baseUrl) => {
    if (!relativePath) return null;
    if (relativePath.startsWith('http')) return relativePath;
    return `${baseUrl}${relativePath}`;
};

const processUser = (user, baseUrl) => {
    if (!user) return null;
    return {
        ...user.toObject(),
        profilePicture: getFullImageUrl(user.profilePicture, baseUrl)
    };
};

// Helper function to safely process group data
const processGroupData = (group, baseUrl, currentUserId = null) => {
    const creator = processUser(group.creator, baseUrl);
    const members = group.members
        .filter(member => member !== null)
        .map(member => processUser(member, baseUrl))
        .filter(member => member !== null);

    // CRITICAL: Determine if current user is admin
    const isAdmin = currentUserId ? group.creator._id.toString() === currentUserId.toString() : false;

    return {
        ...group.toObject(),
        profilePicture: getFullImageUrl(group.profilePicture, baseUrl),
        creator,
        members,
        isAdmin, // Add admin status to response
        adminId: group.creator._id.toString() // Explicitly include admin ID
    };
};

// Create a new group
exports.createGroup = async (req, res) => {
    try {
        const { name, description, createdBy, members, profilePicture } = req.body;

        const newGroup = new Group({
            name,
            description,
            creator: createdBy, // Creator is automatically the admin
            members: members.length ? members : [createdBy],
            profilePicture: profilePicture || null
        });

        const savedGroup = await newGroup.save();

        // Populate and return with full image URLs
        const populatedGroup = await Group.findById(savedGroup._id)
            .populate('creator', 'username email profilePicture')
            .populate('members', 'username email profilePicture');

        const baseUrl = getBaseUrl(req);

        const responseGroup = {
            ...populatedGroup.toObject(),
            profilePicture: getFullImageUrl(populatedGroup.profilePicture, baseUrl),
            creator: {
                ...populatedGroup.creator.toObject(),
                profilePicture: getFullImageUrl(populatedGroup.creator.profilePicture, baseUrl)
            },
            members: populatedGroup.members.map(member => ({
                ...member.toObject(),
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            isAdmin: true, // Creator is always admin
            adminId: createdBy
        };

        res.status(201).json(responseGroup);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get all groups
exports.getAllGroups = async (req, res) => {
    try {
        const groups = await Group.find()
            .populate('creator', 'username email profilePicture')
            .populate('members', 'username email profilePicture');

        const baseUrl = getBaseUrl(req);
        const currentUserId = req.user?.id;

        const groupsWithFullUrls = groups.map(group => processGroupData(group, baseUrl, currentUserId));

        res.json(groupsWithFullUrls);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get groups that user is a creator or member of
exports.getUserGroups = async (req, res) => {
    try {
        const userId = req.params.userId;

        if (!userId) {
            return res.status(400).json({ message: 'User ID is required' });
        }

        const myGroups = await Group.find({
            $or: [
                { creator: userId },
                { members: userId }
            ]
        })
            .populate('creator', 'username email profilePicture')
            .populate('members', 'username email profilePicture');

        const baseUrl = getBaseUrl(req);
        const groupsWithFullUrls = myGroups.map(group => processGroupData(group, baseUrl, userId));

        res.json(groupsWithFullUrls);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Add user to group
exports.addUserToGroup = async (req, res) => {
    try {
        const { userId } = req.body;
        const group = await Group.findById(req.params.groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user already in group
        if (group.members.includes(userId)) {
            return res.status(400).json({ message: 'User already in group' });
        }

        group.members.push(userId);
        await group.save();

        // Populate and return with full image URLs
        const updatedGroup = await Group.findById(group._id)
            .populate('creator', 'username email profilePicture')
            .populate('members', 'username email profilePicture');

        const baseUrl = getBaseUrl(req);
        const currentUserId = req.user.id;

        const responseGroup = processGroupData(updatedGroup, baseUrl, currentUserId);

        res.json(responseGroup);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// UPDATED: Remove user from group - ONLY ADMIN CAN DO THIS
exports.removeUserFromGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body; // User to be removed
        const requesterId = req.user.id; // Person making the request

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // CRITICAL: Check if requester is the admin (creator)
        const isAdmin = group.creator.toString() === requesterId;

        // CRITICAL: Allow removal if:
        // 1. Requester is admin (can remove anyone except themselves)
        // 2. User is removing themselves
        if (!isAdmin && userId !== requesterId) {
            return res.status(403).json({
                message: 'Only the group admin can remove members',
                isAdmin: false
            });
        }

        // CRITICAL: Admin cannot remove themselves
        if (isAdmin && userId === requesterId) {
            return res.status(400).json({
                message: 'Admin cannot remove themselves. Transfer admin rights first or delete the group.',
                isAdmin: true
            });
        }

        // Remove the user from members
        group.members = group.members.filter(
            member => member.toString() !== userId
        );

        await group.save();

        // Populate and return updated group
        const updatedGroup = await Group.findById(groupId)
            .populate('creator', 'username email profilePicture')
            .populate('members', 'username email profilePicture');

        // If group is empty after removal (no members left), delete it
        if (updatedGroup.members.length === 0) {
            // Delete group profile picture if exists
            if (group.profilePicture) {
                try {
                    const filename = path.basename(group.profilePicture);
                    const imagePath = path.join(__dirname, '..', 'uploads', filename);
                    await fs.unlink(imagePath);
                } catch (error) {
                    console.log('Group image deletion failed:', error.message);
                }
            }

            await Group.findByIdAndDelete(groupId);
            return res.json({
                message: 'Member removed and group deleted (was empty)',
                deleted: true
            });
        }

        const baseUrl = getBaseUrl(req);
        const responseGroup = processGroupData(updatedGroup, baseUrl, requesterId);

        res.json({
            message: 'Member removed successfully',
            group: responseGroup
        });

    } catch (error) {
        console.error('Error removing member from group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Leave group (user removes themselves)
exports.leaveGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // CRITICAL: Check if user is admin
        const isAdmin = group.creator.toString() === userId;

        if (isAdmin) {
            return res.status(400).json({
                message: 'Admin cannot leave the group. Please transfer admin rights first or delete the group.',
                isAdmin: true
            });
        }

        // Check if user is actually a member
        if (!group.members.includes(userId)) {
            return res.status(400).json({ message: 'You are not a member of this group' });
        }

        // Remove user from group members
        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $pull: { members: userId } },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        // If group is empty, delete it
        if (updatedGroup.members.length === 0) {
            if (group.profilePicture) {
                try {
                    const filename = path.basename(group.profilePicture);
                    const imagePath = path.join(__dirname, '..', 'uploads', filename);
                    await fs.unlink(imagePath);
                } catch (error) {
                    console.log('Group image deletion failed:', error.message);
                }
            }

            await Group.findByIdAndDelete(groupId);
            return res.json({
                message: 'Group left and deleted (was empty)',
                deleted: true
            });
        }

        const baseUrl = getBaseUrl(req);
        const responseGroup = processGroupData(updatedGroup, baseUrl, userId);

        res.json({
            message: 'Group left successfully',
            group: responseGroup
        });
    } catch (error) {
        console.error('Error leaving group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Add member to group - ONLY ADMIN CAN ADD
exports.addMemberToGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        const requesterId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // CRITICAL: Check if requester is admin (creator)
        const isAdmin = group.creator.toString() === requesterId;

        if (!isAdmin) {
            return res.status(403).json({
                message: 'Only the group admin can add members',
                isAdmin: false
            });
        }

        // Check if user is already a member
        if (group.members.includes(userId)) {
            return res.status(400).json({ message: 'User is already a member of this group' });
        }

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $addToSet: { members: userId } },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        const baseUrl = getBaseUrl(req);
        const responseGroup = processGroupData(updatedGroup, baseUrl, requesterId);

        res.json(responseGroup);
    } catch (error) {
        console.error('Error adding member to group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// UPDATED: Remove member from group - DUPLICATE METHOD (keeping for backward compatibility)
exports.removeMemberFromGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        const requesterId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // CRITICAL: Check if requester is admin
        const isAdmin = group.creator.toString() === requesterId;

        // Allow if: admin removing someone OR user removing themselves
        if (!isAdmin && userId !== requesterId) {
            return res.status(403).json({
                message: 'Only the group admin can remove other members',
                isAdmin: false
            });
        }

        // Admin cannot remove themselves
        if (isAdmin && userId === requesterId) {
            return res.status(400).json({
                message: 'Admin cannot remove themselves from the group',
                isAdmin: true
            });
        }

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $pull: { members: userId } },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        // If empty, delete group
        if (updatedGroup.members.length === 0) {
            if (group.profilePicture) {
                try {
                    const filename = path.basename(group.profilePicture);
                    const imagePath = path.join(__dirname, '..', 'uploads', filename);
                    await fs.unlink(imagePath);
                } catch (error) {
                    console.log('Group image deletion failed:', error.message);
                }
            }

            await Group.findByIdAndDelete(groupId);
            return res.json({
                message: 'Member removed and group deleted (was empty)',
                deleted: true
            });
        }

        const baseUrl = getBaseUrl(req);
        const responseGroup = processGroupData(updatedGroup, baseUrl, requesterId);

        res.json({
            message: 'Member removed successfully',
            group: responseGroup
        });

    } catch (error) {
        console.error('Error removing member from group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Upload group picture - ONLY ADMIN OR MEMBERS CAN UPLOAD
exports.uploadGroupPicture = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const group = await Group.findById(groupId);
        if (!group) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is admin or member
        const isAdmin = group.creator.toString() === userId;
        const isMember = group.members.some(member =>
            member.userId?.toString() === userId || member.toString() === userId
        );

        if (!isAdmin && !isMember) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
            return res.status(403).json({
                message: 'Only admin and members can update group picture',
                isAdmin: false
            });
        }

        // Delete old picture
        if (group.profilePicture) {
            try {
                const oldPicture = group.profilePicture;
                const filename = path.basename(oldPicture);
                const oldImagePath = path.join(__dirname, '..', 'uploads', filename);
                await fs.unlink(oldImagePath);
                console.log('Old group picture deleted successfully');
            } catch (error) {
                console.log('Old group image deletion failed:', error.message);
            }
        }

        const relativePath = `/uploads/${req.file.filename}`;
        const baseUrl = getBaseUrl(req);
        const fullImageUrl = getFullImageUrl(relativePath, baseUrl);

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { profilePicture: relativePath },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.to(`group_${groupId}`).emit('group_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                newGroupPicture: relativePath,
                fullUrl: fullImageUrl
            });
        }

        const responseGroup = processGroupData(updatedGroup, baseUrl, userId);

        res.json({
            message: 'Group picture uploaded successfully',
            url: fullImageUrl,
            imageUrl: fullImageUrl,
            group: responseGroup
        });

    } catch (error) {
        console.error('Error uploading group picture:', error);

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

// Remove group picture - ONLY ADMIN OR MEMBERS
exports.removeGroupPicture = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const isAdmin = group.creator.toString() === userId;
        const isMember = group.members.some(member =>
            member.userId?.toString() === userId || member.toString() === userId
        );

        if (!isAdmin && !isMember) {
            return res.status(403).json({
                message: 'Only admin and members can remove group picture',
                isAdmin: false
            });
        }

        const pictureToDelete = group.profilePicture;
        if (pictureToDelete) {
            try {
                const filename = path.basename(pictureToDelete);
                const imagePath = path.join(__dirname, '..', 'uploads', filename);
                await fs.unlink(imagePath);
                console.log('Group picture file deleted successfully');
            } catch (error) {
                console.log('Group image deletion failed:', error.message);
            }
        }

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $unset: { profilePicture: 1 } },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        const io = req.app.get('io');
        if (io) {
            io.to(`group_${groupId}`).emit('group_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                newGroupPicture: null
            });
        }

        const baseUrl = getBaseUrl(req);
        const responseGroup = processGroupData(updatedGroup, baseUrl, userId);

        res.json({
            message: 'Group picture removed successfully',
            group: responseGroup
        });
    } catch (error) {
        console.error('Error removing group picture:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Get group profile
exports.getGroupProfile = async (req, res) => {
    try {
        const { groupId } = req.params;
        const currentUserId = req.user?.id;

        const group = await Group.findById(groupId)
            .populate('members', 'username email profilePicture about phone')
            .populate('creator', 'username email profilePicture');

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const baseUrl = getBaseUrl(req);
        const isAdmin = currentUserId ? group.creator._id.toString() === currentUserId.toString() : false;

        res.json({
            id: group._id,
            name: group.name,
            description: group.description,
            profilePicture: getFullImageUrl(group.profilePicture, baseUrl),
            creator: {
                id: group.creator._id,
                name: group.creator.username,
                email: group.creator.email,
                profilePicture: getFullImageUrl(group.creator.profilePicture, baseUrl)
            },
            members: group.members.map(member => ({
                id: member._id,
                name: member.username,
                email: member.email,
                about: member.about,
                phone: member.phone,
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            createdAt: group.createdAt,
            isAdmin, // Include admin status
            adminId: group.creator._id.toString()
        });
    } catch (error) {
        console.error('Error fetching group profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Update group - ONLY ADMIN CAN UPDATE
exports.updateGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { name, description } = req.body;
        const userId = req.user.id;

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // CRITICAL: Only admin can update group details
        const isAdmin = group.creator.toString() === userId;

        if (!isAdmin) {
            return res.status(403).json({
                message: 'Only the group admin can update group details',
                isAdmin: false
            });
        }

        // Update group fields
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            updateData,
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        const baseUrl = getBaseUrl(req);
        const responseGroup = processGroupData(updatedGroup, baseUrl, userId);

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('group_updated', {
                groupId: updatedGroup._id.toString(),
                name: updatedGroup.name,
                description: updatedGroup.description,
                profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl)
            });
        }

        res.json({
            message: 'Group updated successfully',
            group: responseGroup
        });

    } catch (error) {
        console.error('Error updating group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.updateGroupProfilePicture = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { profilePicture } = req.body;

        const group = await Group.findByIdAndUpdate(
            groupId,
            { profilePicture },
            { new: true }
        );

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const baseUrl = getBaseUrl(req);
        const fullImageUrl = getFullImageUrl(group.profilePicture, baseUrl);

        if (req.io) {
            req.io.emit('group_profile_picture_updated', {
                groupId: group._id.toString(),
                groupName: group.name,
                groupProfilePicture: fullImageUrl
            });
        }

        res.json({
            message: 'Group profile picture updated successfully',
            group: {
                ...group.toObject(),
                profilePicture: fullImageUrl
            }
        });
    } catch (error) {
        console.error('Error updating group profile picture:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};