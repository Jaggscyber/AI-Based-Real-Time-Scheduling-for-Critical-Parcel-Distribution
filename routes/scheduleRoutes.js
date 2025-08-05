// routes/scheduleRoutes.js
const express = require('express');
const router = express.Router();
const { generateSchedule } = require('../controllers/scheduleController');

router.post('/', generateSchedule);

module.exports = router;