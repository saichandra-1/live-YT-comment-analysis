const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.FRONTEND_URL}/auth/callback`
);

const scopes = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const getAuthUrl = () => {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
};

const googleCallback = async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    let user = await User.findOne({ where: { googleId: data.id } });
    if (!user) {
      user = await User.create({
        googleId: data.id,
        email: data.email,
        name: data.name,
        picture: data.picture,
      });
    }

    const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/?token=${jwtToken}`);
  } catch (error) {
    console.error('Google Auth Callback Error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
};

module.exports = { getAuthUrl, googleCallback };