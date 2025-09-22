const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create story directory if it doesn't exist
const storyDir = path.join(__dirname, '..', 'story');
console.log('Story directory path:', storyDir);

if (!fs.existsSync(storyDir)) {
    fs.mkdirSync(storyDir, { recursive: true });
    console.log('Story directory created');
} else {
    console.log('Story directory already exists');
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        console.log('Multer destination called, saving to:', storyDir);
        cb(null, storyDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const filename = 'status-' + uniqueSuffix + extension;
        console.log('Generated filename:', filename);
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    console.log('File filter called with:', file.mimetype);
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image and video files are allowed!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

module.exports = upload;