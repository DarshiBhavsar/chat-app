const Group = require('../models/group');

// Create a new group
exports.createGroup = async (req, res) => {
    try {
        const { name, description, createdBy, members } = req.body;
        const newGroup = new Group({
            name,
            description,
            creator: createdBy,
            members: members.length ? members : [createdBy]
        });

        const savedGroup = await newGroup.save();
        res.status(201).json(savedGroup);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get all groups
exports.getAllGroups = async (req, res) => {
    try {
        const groups = await Group.find()
            .populate('creator', 'username')
            .populate('members', 'username');
        res.json(groups);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get groups that user is a member of
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
            .populate('creator', 'username')
            .populate('members', 'username');

        res.json(myGroups);
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

        res.json(group);
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
        ).populate('members', 'username email');

        // If group is empty after user leaves, delete it
        if (updatedGroup.members.length === 0) {
            await Group.findByIdAndDelete(groupId);
            return res.json({
                message: 'Group left and deleted (was empty)',
                deleted: true
            });
        }

        res.json({
            message: 'Group left successfully',
            group: updatedGroup
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
        ).populate('members', 'username email');

        res.json(updatedGroup);
    } catch (error) {
        console.error('Error adding member to group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

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

        // Check if requester is the group creator or removing themselves
        if (group.creator.toString() !== requesterId && userId !== requesterId) {
            return res.status(403).json({ message: 'Not authorized to remove this member' });
        }

        const updatedGroup = await Group.findByIdAndUpdate(
            groupId,
            { $pull: { members: userId } },
            { new: true }
        ).populate('members', 'username email');

        // If group is empty, delete it
        if (updatedGroup.members.length === 0) {
            await Group.findByIdAndDelete(groupId);
            return res.json({
                message: 'Member removed and group deleted (was empty)',
                deleted: true
            });
        }

        res.json({
            message: 'Member removed successfully',
            group: updatedGroup
        });
    } catch (error) {
        console.error('Error removing member from group:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};


