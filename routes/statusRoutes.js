// routes/status.js

const express = require('express');
const router = express.Router();
const statusController = require('../controllers/statusController');
const upload = require('../middleware/statusUpload')
const auth = require('../middleware/authMiddleware');

// Get all statuses
router.get('/', auth, statusController.getAllStatuses);

// Create new status (handles both file and text uploads)
router.post('/upload-status', auth, upload.single('file'), statusController.createStatus);

// Delete status
router.delete('/:statusId', auth, statusController.deleteStatus);

// Mark single status as viewed
router.put('/:statusId/view', auth, statusController.markAsViewed);

// Mark multiple statuses as viewed (bulk operation)
router.put('/bulk-view', auth, statusController.markMultipleAsViewed);

// Get all users
router.get('/users', auth, statusController.getAllUsers);

// Get user's own statuses
router.get('/my-statuses', auth, statusController.getMyStatuses);

// Get specific status by ID
router.get('/:statusId', auth, statusController.getStatusById);

module.exports = router;