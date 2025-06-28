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
