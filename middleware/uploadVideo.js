const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Cloudinary storage for videos
const videoStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'chat-app-uploads/videos',
        resource_type: 'video',
        allowed_formats: ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'mkv'],
        // Optional: Add transformations for video optimization
        transformation: [
            { quality: 'auto' }
        ],
        public_id: (req, file) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            return 'video-' + uniqueSuffix;
        }
    }
});

// Filter file types
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/avi',
        'video/mov',
        'video/wmv',
        'video/mkv',
        'video/quicktime'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only video files are allowed.'));
    }
};

const uploadVideo = multer({
    storage: videoStorage,
    fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB (Cloudinary free tier supports up to 100MB)
    }
});

module.exports = uploadVideo;