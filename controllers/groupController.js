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

// Helper function to safely process group data with admin info
const processGroupData = (group, baseUrl, currentUserId = null) => {
    const creator = processUser(group.creator, baseUrl);
    const members = group.members
        .filter(member => member !== null)
        .map(member => processUser(member, baseUrl))
        .filter(member => member !== null);

    const isAdmin = currentUserId ? group.creator._id.toString() === currentUserId.toString() : false;

    return {
        ...group.toObject(),
        profilePicture: getFullImageUrl(group.profilePicture, baseUrl),
        creator,
        members,
        isAdmin // Add admin flag
    };
};

// Create a new group
exports.createGroup = async (req, res) => {
    try {
        const { name, description, createdBy, members, profilePicture } = req.body;
        const newGroup = new Group({
            name,
            description,
            creator: createdBy,
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
            isAdmin: true // Creator is always admin
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
        const currentUserId = req.user?.id;

        const responseGroup = {
            ...updatedGroup.toObject(),
            profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl),
            creator: {
                ...updatedGroup.creator.toObject(),
                profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
            },
            members: updatedGroup.members.map(member => ({
                ...member.toObject(),
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            isAdmin: currentUserId ? updatedGroup.creator._id.toString() === currentUserId.toString() : false
        };

        res.json(responseGroup);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Remove user from group (legacy - only creator can remove others)
exports.removeUserFromGroup = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if requesting user is the creator or removing themselves
        if (group.creator.toString() !== req.user.id &&
            req.params.userId !== req.user.id) {
            return res.status(403).json({ message: 'Only group admin can remove members' });
        }

        group.members = group.members.filter(
            member => member.toString() !== req.params.userId
        );

        await group.save();
        res.json({ message: 'User removed from group' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Leave group
exports.leaveGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is the creator
        if (group.creator.toString() === userId) {
            return res.status(400).json({ message: 'Group admin cannot leave. Please delete the group or transfer admin rights first.' });
        }

        // Check if user is actually a member of the group
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

        const baseUrl = getBaseUrl(req);

        const responseGroup = {
            ...updatedGroup.toObject(),
            profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl),
            creator: {
                ...updatedGroup.creator.toObject(),
                profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
            },
            members: updatedGroup.members.map(member => ({
                ...member.toObject(),
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            isAdmin: false
        };

        res.json({
            message: 'Group left successfully',
            group: responseGroup
        });
    } catch (error) {
        console.error('Error leaving group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Add member to group (only admin can add)
exports.addMemberToGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        const requesterId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Only group creator (admin) can add members
        if (group.creator.toString() !== requesterId) {
            return res.status(403).json({ message: 'Only group admin can add members' });
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

        const responseGroup = {
            ...updatedGroup.toObject(),
            profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl),
            creator: {
                ...updatedGroup.creator.toObject(),
                profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
            },
            members: updatedGroup.members.map(member => ({
                ...member.toObject(),
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            isAdmin: true
        };

        res.json(responseGroup);
    } catch (error) {
        console.error('Error adding member to group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Remove member from group (only admin can remove)
exports.removeMemberFromGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        const requesterId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Only group creator (admin) can remove members
        if (group.creator.toString() !== requesterId) {
            return res.status(403).json({ message: 'Only group admin can remove members' });
        }

        // Admin cannot remove themselves
        if (userId === requesterId) {
            return res.status(400).json({ message: 'Admin cannot remove themselves. Please delete the group instead.' });
        }

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $pull: { members: userId } },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        const baseUrl = getBaseUrl(req);

        const responseGroup = {
            ...updatedGroup.toObject(),
            profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl),
            creator: {
                ...updatedGroup.creator.toObject(),
                profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
            },
            members: updatedGroup.members.map(member => ({
                ...member.toObject(),
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            isAdmin: true
        };

        // Emit socket event
        if (req.io) {
            req.io.emit('member_removed', {
                groupId: updatedGroup._id.toString(),
                userId,
                removedBy: requesterId
            });
        }

        res.json({
            message: 'Member removed successfully',
            group: responseGroup
        });
    } catch (error) {
        console.error('Error removing member from group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Update group profile picture (only admin)
exports.updateGroupProfilePicture = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { profilePicture } = req.body;
        const requesterId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Only admin can update profile picture
        if (group.creator.toString() !== requesterId) {
            return res.status(403).json({ message: 'Only group admin can update profile picture' });
        }

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { profilePicture },
            { new: true }
        );

        const baseUrl = getBaseUrl(req);
        const fullImageUrl = getFullImageUrl(updatedGroup.profilePicture, baseUrl);

        // Emit socket event to notify all clients
        if (req.io) {
            req.io.emit('group_profile_picture_updated', {
                groupId: updatedGroup._id.toString(),
                groupName: updatedGroup.name,
                groupProfilePicture: fullImageUrl
            });
        }

        res.json({
            message: 'Group profile picture updated successfully',
            group: {
                ...updatedGroup.toObject(),
                profilePicture: fullImageUrl,
                isAdmin: true
            }
        });
    } catch (error) {
        console.error('Error updating group profile picture:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Upload group picture (only admin or members can upload)
exports.uploadGroupPicture = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Get current group and check if user is admin
        const group = await Group.findById(groupId);
        if (!group) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is admin
        const isAdmin = group.creator.toString() === userId;

        if (!isAdmin) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up uploaded file:', unlinkError);
            }
            return res.status(403).json({ message: 'Only group admin can update profile picture' });
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

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { profilePicture: relativePath },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

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
                isAdmin: true,
                creator: {
                    ...updatedGroup.creator.toObject(),
                    profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
                },
                members: updatedGroup.members.map(member => ({
                    id: member._id,
                    name: member.username,
                    email: member.email,
                    profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
                }))
            }
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

// Remove group picture (only admin)
exports.removeGroupPicture = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is admin
        const isAdmin = group.creator.toString() === userId;

        if (!isAdmin) {
            return res.status(403).json({ message: 'Only group admin can remove profile picture' });
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

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $unset: { profilePicture: 1 } },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

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
                profilePicture: null,
                description: updatedGroup.description,
                isAdmin: true,
                creator: {
                    ...updatedGroup.creator.toObject(),
                    profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
                },
                members: updatedGroup.members.map(member => ({
                    id: member._id,
                    name: member.username,
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
        const groupPicture = group.profilePicture;
        const fullImageUrl = getFullImageUrl(groupPicture, baseUrl);
        const isAdmin = currentUserId ? group.creator._id.toString() === currentUserId.toString() : false;

        res.json({
            id: group._id,
            name: group.name,
            description: group.description,
            profilePicture: fullImageUrl,
            isAdmin,
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
            createdAt: group.createdAt
        });
    } catch (error) {
        console.error('Error fetching group profile:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Update group (only admin)
exports.updateGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { name, description } = req.body;
        const userId = req.user.id;

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Only admin can update group
        const isAdmin = group.creator.toString() === userId;

        if (!isAdmin) {
            return res.status(403).json({ message: 'Only group admin can update group details' });
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

        const responseGroup = {
            ...updatedGroup.toObject(),
            profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl),
            creator: {
                ...updatedGroup.creator.toObject(),
                profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
            },
            members: updatedGroup.members.map(member => ({
                ...member.toObject(),
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            })),
            isAdmin: true
        };

        // Emit socket event for real-time updates
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