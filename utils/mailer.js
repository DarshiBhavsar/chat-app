// server/utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

const sendResetEmail = async (email, username, resetLink) => {
    const mailOptions = {
        from: `"AAN Chat" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Reset Your Password',
        html: `
            <div style="font-family:Arial,sans-serif;padding:20px;">
                <h2>AAN Chat</h2>
                <p>Hi ${username},</p>
                <p>Click below to reset your password:</p>
                <p>
                    <a href="${resetLink}" 
                       style="background:#4F46E5;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;">
                        Reset Password
                    </a>
                </p>
                <p>Or copy: <code>${resetLink}</code></p>
                <hr>
                <small>This link expires in 24 hours.</small>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
};

module.exports = sendResetEmail;