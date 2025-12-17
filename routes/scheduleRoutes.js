const express = require('express');
const router = express.Router();
// Ensure scheduleController exists or this will crash
const { generateSchedule } = require('../controllers/scheduleController');

router.post('/', generateSchedule);

module.exports = router;