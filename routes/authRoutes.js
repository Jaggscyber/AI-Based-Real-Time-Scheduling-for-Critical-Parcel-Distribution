const express = require('express');
const router = express.Router();
const { login, register, getProfile } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/register (customer self-registration)
router.post('/register', register);

// GET /api/auth/profile (protected)
router.get('/profile', authMiddleware, getProfile);

module.exports = router;