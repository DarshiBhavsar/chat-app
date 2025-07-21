const multer = require('multer');
const path = require('path');

// Configure storage for audio files
const audioStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'audio'); // Folder for audio files
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Filter only audio files
const audioFileFilter = (req, file, cb) => {
    const allowedTypes = [
        'audio/mpeg',       // .mp3
        'audio/wav',        // .wav
        'audio/webm',       // .webm
        'audio/ogg',        // .ogg
        'audio/mp4'         // .m4a or similar
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
};

// Set up Multer for audio
const audioUpload = multer({
    storage: audioStorage,
    fileFilter: audioFileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit for audio
    }
});

module.exports = audioUpload;
