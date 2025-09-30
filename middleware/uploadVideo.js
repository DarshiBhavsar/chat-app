const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const videoStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'chat-app-uploads/videos',
        resource_type: 'video',
        allowed_formats: ['mp4', 'webm', 'ogg', 'mov'], // Removed less common formats
        public_id: (req, file) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            return 'video-' + uniqueSuffix;
        },
        // Add chunk_size for large files
        chunk_size: 6000000 // 6MB chunks
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/quicktime' // .mov files
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type: ${file.mimetype}. Only MP4, WebM, OGG, and MOV are allowed.`));
    }
};

const uploadVideo = multer({
    storage: videoStorage,
    fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // Reduced to 50MB for better reliability
    }
});

module.exports = uploadVideo;