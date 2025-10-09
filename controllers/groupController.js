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
const processGroupData = (group, baseUrl) => {
    const creator = processUser(group.creator, baseUrl);
    const members = group.members
        .filter(member => member !== null)
        .map(member => processUser(member, baseUrl))
        .filter(member => member !== null);

    return {
        ...group.toObject(),
        profilePicture: getFullImageUrl(group.profilePicture, baseUrl),
        creator,
        members
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
            profilePicture: profilePicture || null // Add profilePicture field
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
            }))
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
        const groupsWithFullUrls = groups.map(group => processGroupData(group, baseUrl));

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
        const groupsWithFullUrls = myGroups.map(group => processGroupData(group, baseUrl));

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
            }))
        };

        res.json(responseGroup);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Remove user from group
exports.removeUserFromGroup = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if requesting user is the creator or themselves
        if (group.creator.toString() !== req.user.id &&
            req.params.userId !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
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

exports.leaveGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
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
        ).populate('members', 'username email profilePicture');

        // If group is empty after user leaves, delete it
        if (updatedGroup.members.length === 0) {
            // Delete group profile picture if it exists
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

        const responseGroup = {
            ...updatedGroup.toObject(),
            profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl),
            members: updatedGroup.members.map(member => ({
                ...member.toObject(),
                profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
            }))
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

// Add member to group
exports.addMemberToGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        const requesterId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if requester is the group creator or a member
        if (group.creator.toString() !== requesterId && !group.members.includes(requesterId)) {
            return res.status(403).json({ message: 'Not authorized to add members' });
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
            }))
        };

        res.json(responseGroup);
    } catch (error) {
        console.error('Error adding member to group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Remove member from group
// exports.removeMemberFromGroup = async (req, res) => {
//     try {
//         const { groupId } = req.params;
//         const { userId } = req.body;
//         const requesterId = req.user.id;

//         const group = await Group.findById(groupId);

//         if (!group) {
//             return res.status(404).json({ message: 'Group not found' });
//         }

//         if (group.creator.toString() !== requesterId && userId !== requesterId) {
//             return res.status(403).json({ message: 'Not authorized to remove this member' });
//         }

//         const updatedGroup = await Group.findByIdAndUpdate(
//             groupId,
//             { $pull: { members: userId } },
//             { new: true }
//         ).populate('members', 'username email profilePicture')
//             .populate('creator', 'username email profilePicture');

//         if (updatedGroup.members.length === 0) {

//             if (group.profilePicture) {
//                 try {
//                     const filename = path.basename(group.profilePicture);
//                     const imagePath = path.join(__dirname, '..', 'uploads', filename);
//                     await fs.unlink(imagePath);
//                 } catch (error) {
//                     console.log('Group image deletion failed:', error.message);
//                 }
//             }

//             await Group.findByIdAndDelete(groupId);
//             return res.json({
//                 message: 'Member removed and group deleted (was empty)',
//                 deleted: true
//             });
//         }

//         const baseUrl = getBaseUrl(req);

//         const responseGroup = {
//             ...updatedGroup.toObject(),
//             profilePicture: getFullImageUrl(updatedGroup.profilePicture, baseUrl),
//             creator: {
//                 ...updatedGroup.creator.toObject(),
//                 profilePicture: getFullImageUrl(updatedGroup.creator.profilePicture, baseUrl)
//             },
//             members: updatedGroup.members.map(member => ({
//                 ...member.toObject(),
//                 profilePicture: getFullImageUrl(member.profilePicture, baseUrl)
//             }))
//         };

//         res.json({
//             message: 'Member removed successfully',
//             group: responseGroup
//         });
//     } catch (error) {
//         console.error('Error removing member from group:', error);
//         res.status(500).json({ message: 'Server Error', error: error.message });
//     }
// };
// Remove member from group
exports.removeMemberFromGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        const requesterId = req.user.id;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if requester is the group creator (admin)
        if (group.creator.toString() !== requesterId) {
            return res.status(403).json({ message: 'Only group admin can remove members' });
        }

        // Don't allow admin to remove themselves using this endpoint
        if (userId === requesterId) {
            return res.status(400).json({ message: 'Admin cannot remove themselves. Use leave group instead.' });
        }

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $pull: { members: userId } },
            { new: true }
        ).populate('members', 'username email profilePicture')
            .populate('creator', 'username email profilePicture');

        // If group is empty, delete it
        if (updatedGroup.members.length === 0) {
            // Delete group profile picture if it exists
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
            }))
        };

        res.json({
            message: 'Member removed successfully',
            group: responseGroup
        });
    } catch (error) {
        console.error('Error removing member from group:', error);
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

        // Emit socket event to notify all clients
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
                    name: member.username,
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
                    profilePicture: 1
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
                profilePicture: null,
                description: updatedGroup.description,
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

// Get group with picture
exports.getGroupProfile = async (req, res) => {
    try {
        const { groupId } = req.params;

        const group = await Group.findById(groupId)
            .populate('members', 'username email profilePicture about phone')
            .populate('creator', 'username email profilePicture');

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
            profilePicture: fullImageUrl,
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

exports.updateGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { name, description } = req.body;
        const userId = req.user.id;

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if user is a member or creator of the group
        const isMember = group.members.some(member =>
            member.userId?.toString() === userId || member.toString() === userId
        );
        const isCreator = group.creator.toString() === userId;

        if (!isMember && !isCreator) {
            return res.status(403).json({ message: 'You are not authorized to update this group' });
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
            }))
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